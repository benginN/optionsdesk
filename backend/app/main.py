"""FastAPI uygulaması: API uçları + derlenmiş arayüzün servis edilmesi."""
from __future__ import annotations

import asyncio
import json
import logging
import math
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import date, datetime
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, jobs, journal, plan, services
from .analytics import anomalies, market, metrics, scoring
from .analytics.contracts import PRESETS, Filters, scan_chain
from .config import ET, FRONTEND_DIST
from .data import cboe
from .data.cache import market_is_open, memory
from .data.rates import risk_free_rate
from .i18n import L, lang_var, set_lang

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def clean(o: Any) -> Any:
    """JSON'a uygun olmayan NaN/inf değerlerini None yapar."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    return o


class CleanJSON(JSONResponse):
    def render(self, content: Any) -> bytes:
        return json.dumps(clean(content), ensure_ascii=False, separators=(",", ":")).encode("utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    task = asyncio.create_task(jobs.scheduler())
    yield
    task.cancel()
    await cboe.close_client()


app = FastAPI(title="Opsiyon Masası", lifespan=lifespan, default_response_class=CleanJSON)


class LangMiddleware:
    """X-Lang başlığını (ya da ?lang=) okuyup isteğin dilini ayarlar."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope.get("headers") or [])
            lang = headers.get(b"x-lang", b"").decode() or ""
            if not lang:
                qs = scope.get("query_string", b"").decode()
                for part in qs.split("&"):
                    if part.startswith("lang="):
                        lang = part[5:]
            set_lang(lang)
        await self.app(scope, receive, send)


app.add_middleware(LangMiddleware)


def _err(e: Exception, code: int = 502):
    raise HTTPException(status_code=code, detail=str(e))


# --- Durum ve snapshot -------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/status")
async def status():
    dates = db.snapshot_dates(400)
    return {
        "market_open": market_is_open(),
        "now_et": datetime.now(ET).isoformat(timespec="minutes"),
        "snapshot_count": len(dates),
        "latest_snapshot": dates[0] if dates else None,
        "first_snapshot": dates[-1] if dates else None,
        "universe_size": len(db.get_universe()),
        "progress": jobs.progress,
        "last_run": db.last_run(),
        "rate": await risk_free_rate(),
    }


@app.post("/api/snapshot")
async def start_snapshot():
    if jobs.progress["running"]:
        return jobs.progress

    async def run():
        await jobs.run_snapshot()
        services.invalidate()

    asyncio.create_task(run())
    await asyncio.sleep(0.2)
    return jobs.progress


@app.get("/api/snapshot/progress")
async def snapshot_progress():
    return jobs.progress


# --- Piyasa notu -------------------------------------------------------------

def _name(m: dict) -> str | None:
    return m.get("name") or cboe.company_name(m["ticker"])


def _idea(m: dict, key: str) -> dict:
    return {"ticker": m["ticker"], "name": _name(m), "price": m.get("price"), "change_pct": m.get("change_pct"),
            "score": (m.get("scores") or {}).get(key), "flags": (m.get("flags") or {}).get(key) or [],
            "iv_pos": m.get("iv_pos"), "iv_pos_source": m.get("iv_pos_source"), "em30_pct": m.get("em30_pct"),
            "em30_low": m.get("em30_low"), "em30_high": m.get("em30_high"), "c": m.get(key), "signal": m.get("signal")}


def _top_ideas(rows: dict[str, dict], n: int = 4) -> dict:
    """Bugün sayfası için strateji başına en iyi birkaç fikir (likit, bilançosuz)."""
    out = {}
    for key in ("csp", "cc", "leaps"):
        cands = [
            m for m in rows.values()
            if (m.get("scores") or {}).get(key) is not None and m.get(key)
            and (m[key].get("spread_pct") or 1) <= 0.2 and not (m.get("flags") or {}).get(key)
        ]
        cands.sort(key=lambda m: m["scores"][key], reverse=True)
        out[key] = [_idea(m, key) for m in cands[:n]]
    return out


def _leaders(cur: dict[str, dict], prev: dict[str, dict]) -> dict:
    rows = list(cur.values())

    def slim(m: dict, **extra) -> dict:
        return {"ticker": m["ticker"], "name": _name(m), "price": m.get("price"), "change_pct": m.get("change_pct"),
                "iv30": m.get("iv30"), "iv_pos": m.get("iv_pos"), "iv_pos_source": m.get("iv_pos_source"), "vrp": m.get("vrp"),
                "rsi14": m.get("rsi14"), "signal": m.get("signal"), **extra}

    iv_moves = []
    for t, m in cur.items():
        p = prev.get(t)
        if p and p.get("iv30") and m.get("iv30"):
            iv_moves.append(slim(m, iv_change=m["iv30"] / p["iv30"] - 1, iv_prev=p["iv30"]))
    iv_moves.sort(key=lambda x: x["iv_change"], reverse=True)

    unusual = []
    for m in rows:
        for u in m.get("unusual") or []:
            unusual.append({"ticker": m["ticker"], "spot": m.get("price"), **u})
    unusual.sort(key=lambda u: u.get("premium") or 0, reverse=True)

    today = date.today()
    earnings_soon = sorted(
        [slim(m, earnings=m.get("earnings"), days=m.get("days_to_earnings"), em=m.get("emw_pct"))
         for m in rows if m.get("days_to_earnings") is not None and 0 <= m["days_to_earnings"] <= 7],
        key=lambda x: x["days"],
    )
    signals: dict[str, int] = {}
    for m in rows:
        code = (m.get("signal") or {}).get("code", "none")
        signals[code] = signals.get(code, 0) + 1

    def top(key, n=8, reverse=True, filt=None):
        rs = [m for m in rows if m.get(key) is not None and (filt is None or filt(m))]
        rs.sort(key=lambda m: m[key], reverse=reverse)
        return [slim(m) for m in rs[:n]]

    return {
        "iv_up": iv_moves[:8],
        "iv_down": list(reversed(iv_moves[-8:])),
        "iv_pos_high": top("iv_pos"),
        "iv_pos_low": top("iv_pos", reverse=False),
        "vrp_high": top("vrp", filt=lambda m: (m.get("spread_med") or 1) < 0.15),
        "oversold": top("rsi14", reverse=False, filt=lambda m: m["rsi14"] <= 35),
        "overbought": top("rsi14", filt=lambda m: m["rsi14"] >= 70),
        "unusual": unusual[:20],
        "earnings_soon": earnings_soon[:20],
        "signals": signals,
        "_today": today.isoformat(),
    }


@app.get("/api/market/note")
async def market_note():
    msnaps = db.load_market_snapshots(250)
    if not msnaps:
        return {"empty": True, "progress": jobs.progress}
    cur = msnaps[-1]
    prev = msnaps[-2] if len(msnaps) > 1 else None
    note = market.build_note(cur["agg"], prev["agg"] if prev else None, cur.get("vix"))
    d, rows = services.enriched_snapshot()
    dates = db.snapshot_dates(2)
    prev_rows = db.load_snapshot(dates[1]) if len(dates) > 1 else {}
    series = [{"date": s["date"], **{k: s["agg"].get(k) for k in ("iv30", "hv30", "vrp", "skew", "pcr_oi", "change", "iv1y")},
               "vix": (s.get("vix") or {}).get("vix")} for s in msnaps]
    ivps = sorted(m["iv_pos"] for m in rows.values() if m.get("iv_pos") is not None)
    iv_pos_med = ivps[len(ivps) // 2] if ivps else None
    return {
        "date": cur["date"], "prev_date": prev["date"] if prev else None,
        "agg": cur["agg"], "prev_agg": prev["agg"] if prev else None, "vix": cur.get("vix"),
        "note": note, "story": market.plain_story(cur["agg"], cur.get("vix"), iv_pos_med),
        "iv_pos_median": iv_pos_med, "ideas": _top_ideas(rows),
        "series": series, "leaders": _leaders(rows, prev_rows),
    }


async def _index_board(sym: str) -> dict:
    c = await services.get_chain(sym)
    w = c.expiry_near(7, min_dte=1)
    mth = c.expiry_near(30, min_dte=14)
    first = c.expiries[0] if c.expiries else None
    sk = c.skew(mth) if mth else None
    g = c.gex()
    return {
        "ticker": sym, "price": c.spot, "change_pct": c.change_pct, "iv30": c.iv30_cboe or c.iv_constant(30),
        "as_of": c.as_of.isoformat(),
        "em_week": c.straddle(w) if w else None, "em_month": c.straddle(mth) if mth else None,
        "pc": c.put_call(max_dte=30), "skew": sk,
        "max_pain": c.max_pain(first) if first else None, "max_pain_expiry": first.isoformat() if first else None,
        "gex_total": g["total"], "gex_flip": g["flip"], "call_wall": g["call_wall"], "put_wall": g["put_wall"],
        "term": c.term_structure()[:12],
    }


@app.get("/api/market/live")
async def market_live():
    async def build():
        boards = await asyncio.gather(*[_index_board(s) for s in ("SPY", "QQQ", "IWM")], return_exceptions=True)
        vix = await jobs.fetch_vix()
        return {
            "boards": [b for b in boards if not isinstance(b, Exception)],
            "errors": [str(b) for b in boards if isinstance(b, Exception)],
            "vix": vix, "vix_note": market.build_note({}, None, vix)["vix_note"],
            "market_open": market_is_open(),
        }
    return await memory.get_or_fetch(f"market_live:{lang_var.get()}", 90 if market_is_open() else 900, build)


# --- Hisse tarayıcı -------------------------------------------------------

@app.get("/api/screener")
async def screener():
    d, rows = services.enriched_snapshot()
    out = []
    for m in rows.values():
        r = {k: v for k, v in m.items() if k not in ("unusual",)}
        r["name"] = _name(m)
        out.append(r)
    out.sort(key=lambda r: (r.get("scores") or {}).get("csp") or 0, reverse=True)
    return {"date": d, "rows": out, "iv_history_days": len(db.snapshot_dates(400))}


# --- Hisse detayı -----------------------------------------------------------

@app.get("/api/ticker/{sym}")
async def ticker(sym: str, expiry: str | None = None):
    sym = sym.upper()
    try:
        c = await services.get_chain(sym)
    except Exception as e:
        _err(e, 404)
    try:
        hist_rows = await cboe.history(sym)
    except Exception:
        hist_rows = []
    earn = await services.safe_earnings()
    m = metrics.compute(c, hist_rows, earn.get(sym))
    ivh = [x["iv30"] for x in db.ticker_history(sym, ["iv30"]) if x.get("iv30") is not None]
    m = scoring.enrich(m, ivh)
    exp30 = c.expiry_near(30, min_dte=7)
    sel = date.fromisoformat(expiry) if expiry else exp30
    first4 = c.expiries[:6]
    return {
        "metrics": m,
        "expiries": c.expiry_list(),
        "selected_expiry": sel.isoformat() if sel else None,
        "term": c.term_structure(),
        "expected_moves": c.expected_moves(),
        "skews": [{"expiry": e.isoformat(), "dte": c.dte(e), **(c.skew(e) or {})} for e in c.expiries if c.skew(e)],
        "smile": c.smile(sel) if sel else [],
        "pc_all": c.put_call(), "pc_30": c.put_call(max_dte=30),
        "max_pain": [{"expiry": e.isoformat(), "dte": c.dte(e), "strike": c.max_pain(e)} for e in first4],
        "gex": c.gex(),
        "oi_by_strike": c.oi_by_strike(max_dte=60, band=max(0.1, min(0.35, 2.5 * (m.get("iv30") or 0.3) * math.sqrt(60 / 365)))),
        "unusual": c.unusual(limit=25),
        "liquidity": c.liquidity(),
        "prices": [{"date": r["date"], "close": r["close"]} for r in hist_rows[-260:]],
        "iv_history": db.ticker_history(sym, ["iv30", "hv30", "price", "skew", "vrp"]),
        "rate": c.r,
    }


@app.get("/api/chain/{sym}")
async def chain(sym: str, expiry: str | None = None):
    try:
        c = await services.get_chain(sym.upper())
    except Exception as e:
        _err(e, 404)
    exp = date.fromisoformat(expiry) if expiry else c.expiry_near(30, min_dte=7) or (c.expiries[0] if c.expiries else None)
    return {
        "ticker": c.sym, "spot": c.spot, "change_pct": c.change_pct, "iv30": c.iv30_cboe, "rate": c.r,
        "as_of": c.as_of.isoformat(), "expiries": c.expiry_list(),
        "expiry": exp.isoformat() if exp else None, "dte": c.dte(exp) if exp else None,
        "T": c.T(exp) if exp else None, "rows": c.chain_table(exp) if exp else [],
    }


# --- Kontrat tarayıcı -------------------------------------------------------

_INT_FIELDS = {"dte_min", "dte_max", "min_oi"}
_FLOAT_FIELDS = {"delta_min", "delta_max", "max_spread_pct", "max_capital", "min_premium", "min_strike", "max_width"}
_BOOL_FIELDS = {"exclude_earnings"}


def _filters_from(strategy: str, raw: dict) -> Filters:
    f = replace(PRESETS[strategy])
    for k, v in raw.items():
        if v is None or v == "":
            continue
        try:
            if k in _INT_FIELDS:
                setattr(f, k, int(float(v)))
            elif k in _FLOAT_FIELDS:
                setattr(f, k, float(v))
            elif k in _BOOL_FIELDS:
                setattr(f, k, bool(v))
        except (TypeError, ValueError):
            raise HTTPException(400, L(f"Geçersiz filtre değeri: {k}={v}", f"Invalid filter value: {k}={v}"))
    f.commission = float(db.get_settings().get("commission_per_contract") or 0.65)
    return f


@app.post("/api/scan")
async def scan(body: dict = Body(...)):
    strategy = body.get("strategy", "csp")
    if strategy not in PRESETS:
        raise HTTPException(400, L("Geçersiz strateji", "Invalid strategy"))
    f = _filters_from(strategy, body.get("filters") or {})

    tickers = [t.strip().upper() for t in (body.get("tickers") or []) if t and t.strip()]
    if not tickers:
        top = int(body.get("top") or 25)
        _, rows = services.enriched_snapshot()
        key = "cc" if strategy in ("cc", "ccs") else ("leaps" if strategy == "leaps" else "csp")
        ranked = sorted([m for m in rows.values() if (m.get("scores") or {}).get(key) is not None],
                        key=lambda m: m["scores"][key], reverse=True)
        tickers = [m["ticker"] for m in ranked[:top]]
        if not tickers:
            tickers = ["SPY", "QQQ", "IWM", "AAPL", "AMD", "NVDA", "TSLA", "PLTR", "SOFI", "IREN"]

    holdings = {h["ticker"]: h for h in db.list_holdings()}
    earn = await services.safe_earnings()

    async def one(t: str):
        c = await services.get_chain(t)
        hs = await services.hist_summary(t)
        ctx = {"hv_blend": hs.get("hv_blend"), "earnings": earn.get(t)}
        if t in holdings:
            ctx["cost_basis"] = holdings[t]["cost_basis"]
        return scan_chain(c, strategy, f, ctx)

    results = await services.gather_limited([one(t) for t in tickers], 6)
    rows, errors = [], []
    for t, r in zip(tickers, results):
        if isinstance(r, Exception):
            errors.append(f"{t}: {r}")
        else:
            rows.extend(r)
    rows.sort(key=lambda r: r["score"], reverse=True)
    per_ticker = int(body.get("per_ticker") or 0)
    if per_ticker:
        counts: dict[str, int] = {}
        kept = []
        for r in rows:
            if counts.get(r["ticker"], 0) < per_ticker:
                kept.append(r)
                counts[r["ticker"]] = counts.get(r["ticker"], 0) + 1
        rows = kept
    return {"strategy": strategy, "tickers": tickers, "rows": rows[:400], "total": len(rows), "errors": errors,
            "filters": f.__dict__}


# --- Anomaliler -------------------------------------------------------------

@app.get("/api/anomalies")
async def anomalies_scan(tickers: str = Query("SPY,QQQ,IWM,SPX"), min_profit: float = 0.03):
    syms = [t.strip().upper() for t in tickers.split(",") if t.strip()][:20]
    fee = float(db.get_settings().get("commission_per_contract") or 0.65)

    async def one(t: str):
        c = await services.get_chain(t)
        return await asyncio.to_thread(anomalies.scan, c, fee, min_profit)

    results = await services.gather_limited([one(t) for t in syms], 4)
    out, errors = [], []
    for t, r in zip(syms, results):
        if isinstance(r, Exception):
            errors.append(f"{t}: {r}")
        else:
            out.append(r)
    return {"results": out, "errors": errors, "market_open": market_is_open()}


# --- Defter -----------------------------------------------------------------

@app.get("/api/journal")
async def journal_list():
    return {"trades": journal.list_decorated()}


@app.post("/api/journal")
async def journal_create(t: dict = Body(...)):
    required = ["ticker", "strategy", "opt_type", "side", "strike", "expiry", "qty", "open_date", "open_price"]
    missing = [k for k in required if t.get(k) in (None, "")]
    if missing:
        raise HTTPException(400, L("Eksik alanlar: ", "Missing fields: ") + ", ".join(missing))
    t["strike"] = float(t["strike"])
    t["qty"] = int(t["qty"])
    t["open_price"] = float(t["open_price"])
    return journal.decorate(db.insert_trade(t))


@app.put("/api/journal/{trade_id}")
async def journal_update(trade_id: int, t: dict = Body(...)):
    r = db.update_trade(trade_id, t)
    if not r:
        raise HTTPException(404, L("Bulunamadı", "Not found"))
    return journal.decorate(r)


@app.delete("/api/journal/{trade_id}")
async def journal_delete(trade_id: int):
    db.delete_trade(trade_id)
    return {"ok": True}


@app.post("/api/journal/{trade_id}/close")
async def journal_close(trade_id: int, body: dict = Body(...)):
    try:
        return journal.close_trade(
            trade_id, body.get("action", "closed"),
            float(body["price"]) if body.get("price") not in (None, "") else None,
            body.get("date"), float(body.get("fees") or 0), body.get("roll"),
            bool(body.get("update_holdings", True)),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/journal/stats")
async def journal_stats():
    return journal.stats()


@app.get("/api/journal/open")
async def journal_open():
    open_trades = [t for t in db.list_trades() if t["status"] == "open"]
    tickers = sorted({t["ticker"] for t in open_trades})
    chains = await services.gather_limited([services.get_chain(t) for t in tickers], 6)
    cmap = {t: (c if not isinstance(c, Exception) else None) for t, c in zip(tickers, chains)}
    return {"positions": [journal.mark_position(t, cmap.get(t["ticker"])) for t in open_trades]}


# --- Hisseler, ayarlar, evren -------------------------------------------------

@app.get("/api/holdings")
async def holdings_list():
    hs = db.list_holdings()
    trades = db.list_trades()
    out = []
    quotes = await services.gather_limited([services.get_chain(h["ticker"]) for h in hs], 6)
    for h, q in zip(hs, quotes):
        prem = sum(t["open_price"] * 100 * t["qty"] for t in trades if t["ticker"] == h["ticker"] and t["side"] == "sell")
        opt_pl = sum(journal.trade_pl(t) or 0 for t in trades if t["ticker"] == h["ticker"] and t["status"] in journal.CLOSED)
        price = q.spot if not isinstance(q, Exception) else None
        out.append({
            **h, "price": price,
            "value": price * h["shares"] if price else None,
            "unrealized": (price - h["cost_basis"]) * h["shares"] if price else None,
            "premium_collected": round(prem, 2), "option_realized": round(opt_pl, 2),
            "adjusted_basis": h["cost_basis"] - opt_pl / h["shares"] if h["shares"] else None,
            "lots": int(h["shares"] // 100),
        })
    return {"holdings": out}


@app.post("/api/holdings")
async def holdings_upsert(h: dict = Body(...)):
    if not h.get("ticker"):
        raise HTTPException(400, L("Ticker gerekli", "Ticker is required"))
    db.upsert_holding(h["ticker"], float(h.get("shares") or 0), float(h.get("cost_basis") or 0), h.get("notes"))
    return {"ok": True}


@app.delete("/api/holdings/{ticker}")
async def holdings_delete(ticker: str):
    db.delete_holding(ticker)
    return {"ok": True}


@app.get("/api/settings")
async def settings_get():
    return db.get_settings()


@app.put("/api/settings")
async def settings_put(values: dict = Body(...)):
    return db.update_settings(values)


@app.get("/api/universe")
async def universe_get():
    return {"tickers": db.get_universe()}


@app.put("/api/universe")
async def universe_put(body: dict = Body(...)):
    return {"tickers": db.set_universe(body.get("tickers") or [])}


@app.post("/api/plan")
async def plan_build(body: dict = Body(default={})):
    return await plan.build(body or {})


@app.get("/api/search")
async def search(q: str = ""):
    q = q.strip().upper()
    uni = db.get_universe()
    names = {t: cboe.company_name(t) for t in uni}
    if q:
        hits = [t for t in uni if t.startswith(q)]
        hits += [t for t in uni if t not in hits and q.lower() in (names.get(t) or "").lower()]
    else:
        hits = uni
    return {"results": [{"t": t, "name": names.get(t)} for t in hits[:10]]}


# --- Arayüz -------------------------------------------------------------------

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        f = (FRONTEND_DIST / path).resolve()
        # "../" ile dist klasörünün dışına (ör. data/options.db) çıkılmasın
        if path and f.is_file() and f.is_relative_to(FRONTEND_DIST.resolve()):
            return FileResponse(f)
        # index.html önbelleğe alınmasın ki yeni derlemeler hemen görünsün
        return FileResponse(FRONTEND_DIST / "index.html", headers={"Cache-Control": "no-cache"})
