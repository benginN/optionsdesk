"""Portföy Planı: nakit ve hisse pozisyonlarına göre somut öneriler.

- Hisseler (≥100 adet): her biri için en iyi covered call kontratları
- Nakit: skoru yüksek hisselerde CSP'lere çeşitlendirilmiş dağılım
- Aşama 5: toplanan primin bir kısmıyla LEAPS (yükselişe ortak olma)
"""
from __future__ import annotations

import math
from dataclasses import replace

from . import db, services
from .i18n import L
from .analytics.contracts import PRESETS, Filters, scan_chain


async def _scan(ticker: str, strategy: str, f: Filters, ctx_extra: dict | None = None) -> list[dict]:
    chain = await services.get_chain(ticker)
    hs = await services.hist_summary(ticker)
    earn = await services.safe_earnings()
    ctx = {"hv_blend": hs.get("hv_blend"), "earnings": earn.get(ticker.upper())}
    if ctx_extra:
        ctx.update(ctx_extra)
    return scan_chain(chain, strategy, f, ctx)


async def build(params: dict) -> dict:
    settings = db.get_settings()
    cash = float(params.get("cash", settings["cash"]) or 0)
    reserve_pct = float(params.get("reserve_pct", settings["cash_reserve_pct"]))
    max_pos_pct = float(params.get("max_position_pct", settings["max_position_pct"]))
    dte_min = int(params.get("dte_min", 4))
    dte_max = int(params.get("dte_max", 16))
    delta_max = float(params.get("delta_max", 0.30))
    cc_above_basis = bool(params.get("cc_above_basis", True))
    exclude_earn = bool(params.get("exclude_earnings", True))
    leaps_share = float(params.get("leaps_share", 50)) / 100
    candidates_n = int(params.get("candidates", 25))
    fee = float(settings.get("commission_per_contract") or 0.65)

    holdings = db.list_holdings()
    notes: list[str] = []

    # --- Covered call önerileri ---
    cc_out = []
    cc_filters = replace(PRESETS["cc"], dte_min=dte_min, dte_max=dte_max, delta_max=min(delta_max, 0.35),
                         exclude_earnings=exclude_earn, commission=fee)
    for h in holdings:
        lots = int(h["shares"] // 100)
        if lots < 1:
            continue
        f = replace(cc_filters, min_strike=h["cost_basis"] if cc_above_basis else None)
        try:
            rows = await _scan(h["ticker"], "cc", f, {"cost_basis": h["cost_basis"]})
        except Exception as e:
            cc_out.append({"ticker": h["ticker"], "lots": lots, "error": str(e), "options": []})
            continue
        rows.sort(key=lambda r: r["score"], reverse=True)
        best = rows[:3]
        for b in best:
            b["qty"] = lots
            b["total_premium"] = round(b["premium"] * 100 * lots, 2)
        cc_out.append({"ticker": h["ticker"], "lots": lots, "shares": h["shares"], "cost_basis": h["cost_basis"],
                       "options": best})

    # --- CSP dağılımı ---
    investable = cash * (1 - reserve_pct / 100)
    max_pos = cash * max_pos_pct / 100
    snap_date, snap = services.current_rows()
    ranked = sorted(
        [m for m in snap.values() if m.get("scores", {}).get("csp") is not None and m.get("csp")],
        key=lambda m: m["scores"]["csp"], reverse=True,
    )
    # Sermayeye sığabilecekleri öne al
    fits = [m for m in ranked if (m["csp"].get("capital") or math.inf) <= max(max_pos, 0) * 1.3]
    tickers = [m["ticker"] for m in fits[:candidates_n]]
    if not snap:
        notes.append(L("Henüz veri yok; CSP adayları için önce verileri güncelle.", "No data yet; refresh the data first to get CSP candidates."))

    csp_filters = replace(PRESETS["csp"], dte_min=dte_min, dte_max=dte_max, delta_max=delta_max,
                          max_capital=max_pos if max_pos > 0 else None, exclude_earnings=exclude_earn, commission=fee)
    results = await services.gather_limited([_scan(t, "csp", csp_filters) for t in tickers], 6)
    best_per: list[dict] = []
    for t, res in zip(tickers, results):
        if isinstance(res, Exception) or not res:
            continue
        res.sort(key=lambda r: r["score"], reverse=True)
        best_per.append(res[0])
    best_per.sort(key=lambda r: r["score"], reverse=True)

    allocations = []
    remaining = investable
    for r in best_per:
        cap = r["capital"]
        if cap > remaining:
            continue
        n = int(min(max_pos, remaining) // cap)
        if n < 1:
            continue
        r = dict(r)
        r["qty"] = n
        r["total_capital"] = round(cap * n, 2)
        r["total_premium"] = round(r["premium"] * 100 * n, 2)
        allocations.append(r)
        remaining -= cap * n
        if remaining < min((x["capital"] for x in best_per), default=math.inf):
            break

    used = investable - remaining
    prem_total = sum(a["total_premium"] for a in allocations)
    cc_prem_total = sum((o["options"][0]["total_premium"] if o.get("options") else 0) for o in cc_out)
    weighted_dte = (sum(a["dte"] * a["total_capital"] for a in allocations) / used) if used else None
    exp_assign = sum((1 - (a.get("p_otm") or 0)) * a["qty"] for a in allocations)

    # --- Aşama 5: primle LEAPS ---
    leaps_out = []
    total_prem = prem_total + cc_prem_total
    leaps_budget = total_prem * leaps_share
    leaps_tickers = [h["ticker"] for h in holdings][:6] + [a["ticker"] for a in allocations][:4]
    seen = set()
    leaps_tickers = [t for t in leaps_tickers if not (t in seen or seen.add(t))]
    lf = replace(PRESETS["leaps"], commission=fee)
    lres = await services.gather_limited([_scan(t, "leaps", lf) for t in leaps_tickers], 6)
    for t, res in zip(leaps_tickers, lres):
        if isinstance(res, Exception) or not res:
            continue
        res.sort(key=lambda r: r["score"], reverse=True)
        b = res[0]
        b["periods_needed"] = round(b["capital"] / leaps_budget, 1) if leaps_budget > 0 else None
        leaps_out.append(b)
    leaps_out.sort(key=lambda r: r["score"], reverse=True)

    return {
        "snapshot_date": snap_date,
        "inputs": {"cash": cash, "reserve_pct": reserve_pct, "max_position_pct": max_pos_pct,
                   "dte_min": dte_min, "dte_max": dte_max, "delta_max": delta_max,
                   "cc_above_basis": cc_above_basis, "exclude_earnings": exclude_earn, "leaps_share": leaps_share * 100},
        "covered_calls": cc_out,
        "csp": {
            "allocations": allocations, "investable": round(investable, 2), "used": round(used, 2),
            "remaining_cash": round(cash - used, 2), "premium_total": round(prem_total, 2),
            "yield_on_used": prem_total / used if used else None,
            "weighted_dte": weighted_dte,
            "expected_assignments": round(exp_assign, 2),
            "candidates_scanned": len(tickers),
        },
        "totals": {"premium": round(total_prem, 2), "cc_premium": round(cc_prem_total, 2), "csp_premium": round(prem_total, 2)},
        "leaps": {"budget": round(leaps_budget, 2), "options": leaps_out[:6]},
        "notes": notes,
    }
