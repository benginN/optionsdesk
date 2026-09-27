"""Opsiyon Defteri: işlem kayıtları, kapanış/atanma/roll akışları ve istatistikler."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

from . import db
from .i18n import L
from .analytics.chain import Chain

CLOSED = {"expired", "closed", "assigned", "exercised", "rolled"}


def _d(s: str | None) -> date | None:
    try:
        return date.fromisoformat(s[:10]) if s else None
    except ValueError:
        return None


def trade_pl(t: dict) -> float | None:
    """Kapanmış işlemin opsiyon K/Z'si ($). Açık işlemlerde None."""
    if t["status"] not in CLOSED:
        return None
    qty = t["qty"]
    close = t.get("close_price") or 0.0
    if t["status"] in ("expired", "assigned"):
        close = 0.0
    fees = (t.get("fees") or 0) + (t.get("close_fees") or 0)
    if t["side"] == "sell":
        return (t["open_price"] - close) * 100 * qty - fees
    return (close - t["open_price"]) * 100 * qty - fees


def collateral(t: dict) -> float:
    if t["side"] == "sell" and t["opt_type"] == "P":
        return t["strike"] * 100 * t["qty"]
    if t["side"] == "buy":
        return t["open_price"] * 100 * t["qty"]
    return 0.0  # CC teminatı hissedir


def decorate(t: dict) -> dict:
    out = dict(t)
    pl = trade_pl(t)
    out["pl"] = round(pl, 2) if pl is not None else None
    out["premium_total"] = round(t["open_price"] * 100 * t["qty"], 2)
    out["collateral"] = round(collateral(t), 2)
    od, cd, ed = _d(t["open_date"]), _d(t.get("close_date")), _d(t["expiry"])
    end = cd or date.today()
    held = max((end - od).days, 1) if od else None
    out["days_held"] = held
    out["dte"] = (ed - date.today()).days if ed else None
    if pl is not None and held:
        base = out["collateral"] or (t["strike"] * 100 * t["qty"])
        out["ann_return"] = round(pl / base * 365 / held, 4) if base else None
    return out


def list_decorated() -> list[dict]:
    return [decorate(t) for t in db.list_trades()]


def close_trade(trade_id: int, action: str, price: float | None, when: str | None, fees: float | None,
                roll: dict | None = None, update_holdings: bool = True) -> dict:
    t = db.get_trade(trade_id)
    if not t:
        raise ValueError(L("İşlem bulunamadı", "Trade not found"))
    if t["status"] != "open":
        raise ValueError(L("İşlem zaten kapalı", "Trade is already closed"))
    if action not in CLOSED:
        raise ValueError(L("Geçersiz kapanış tipi", "Invalid close type"))
    when = when or date.today().isoformat()
    changes: dict = {"status": action, "close_date": when, "close_fees": fees or 0}
    if action in ("expired", "assigned"):
        changes["close_price"] = 0.0
    else:
        changes["close_price"] = price if price is not None else 0.0

    shares = 100 * t["qty"]
    if action == "assigned" and t["side"] == "sell":
        h = db.get_holding(t["ticker"])
        if t["opt_type"] == "P":
            # Put ataması: strike'tan hisse alınır
            if update_holdings:
                old_sh = h["shares"] if h else 0
                old_cb = h["cost_basis"] if h else 0
                new_sh = old_sh + shares
                new_cb = (old_sh * old_cb + shares * t["strike"]) / new_sh
                db.upsert_holding(t["ticker"], new_sh, new_cb)
        else:
            # Call ataması: hisse strike'tan satılır
            cb = h["cost_basis"] if h else t["strike"]
            changes["stock_pl"] = round((t["strike"] - cb) * shares, 2)
            if update_holdings and h:
                db.upsert_holding(t["ticker"], h["shares"] - shares, h["cost_basis"])

    updated = db.update_trade(trade_id, changes)
    new_trade = None
    if action == "rolled" and roll:
        new_trade = db.insert_trade({
            "ticker": t["ticker"], "strategy": t["strategy"], "opt_type": roll.get("opt_type") or t["opt_type"],
            "side": t["side"], "strike": float(roll["strike"]), "expiry": roll["expiry"],
            "qty": int(roll.get("qty") or t["qty"]), "open_date": when, "open_price": float(roll["price"]),
            "fees": float(roll.get("fees") or 0), "notes": roll.get("notes"), "rolled_from": trade_id,
        })
    return {"trade": decorate(updated) if updated else None, "new_trade": decorate(new_trade) if new_trade else None}


def stats() -> dict:
    trades = db.list_trades()
    closed = [t for t in trades if t["status"] in CLOSED]
    sells_closed = [t for t in closed if t["side"] == "sell" and t["status"] != "rolled"]
    csp_closed = [t for t in sells_closed if t["opt_type"] == "P"]
    open_ = [t for t in trades if t["status"] == "open"]

    def contracts(ts):
        return sum(t["qty"] for t in ts)

    expired = [t for t in sells_closed if t["status"] == "expired"]
    assigned_csp = [t for t in csp_closed if t["status"] == "assigned"]

    realized = sum(trade_pl(t) or 0 for t in closed)
    stock_pl = sum(t.get("stock_pl") or 0 for t in closed)
    premium_collected = sum(t["open_price"] * 100 * t["qty"] for t in trades if t["side"] == "sell")
    premium_paid = sum(t["open_price"] * 100 * t["qty"] for t in trades if t["side"] == "buy")
    wins = [t for t in closed if (trade_pl(t) or 0) > 0]

    monthly: dict[str, dict] = defaultdict(lambda: {"realized": 0.0, "premium": 0.0, "trades": 0})
    for t in trades:
        m = t["open_date"][:7]
        if t["side"] == "sell":
            monthly[m]["premium"] += t["open_price"] * 100 * t["qty"]
        monthly[m]["trades"] += 1
    for t in closed:
        m = (t.get("close_date") or t["open_date"])[:7]
        monthly[m]["realized"] += trade_pl(t) or 0

    by_ticker: dict[str, dict] = defaultdict(lambda: {"premium": 0.0, "realized": 0.0, "trades": 0, "assigned": 0, "open": 0})
    for t in trades:
        b = by_ticker[t["ticker"]]
        b["trades"] += 1
        if t["side"] == "sell":
            b["premium"] += t["open_price"] * 100 * t["qty"]
        if t["status"] in CLOSED:
            b["realized"] += trade_pl(t) or 0
        if t["status"] == "assigned":
            b["assigned"] += 1
        if t["status"] == "open":
            b["open"] += 1

    def rate(a, b):
        return a / b if b else None

    return {
        "n_trades": len(trades),
        "n_open": len(open_),
        "n_closed": len(closed),
        "premium_collected": round(premium_collected, 2),
        "premium_paid": round(premium_paid, 2),
        "realized": round(realized, 2),
        "stock_pl": round(stock_pl, 2),
        "win_rate": rate(len(wins), len(closed)),
        "expired_rate_contracts": rate(contracts(expired), contracts(sells_closed)),
        "expired_contracts": contracts(expired), "sell_contracts": contracts(sells_closed),
        "expired_rate_positions": rate(len(expired), len(sells_closed)),
        "expired_positions": len(expired), "sell_positions": len(sells_closed),
        "assign_rate_contracts": rate(contracts(assigned_csp), contracts(csp_closed)),
        "assigned_contracts": contracts(assigned_csp), "csp_contracts": contracts(csp_closed),
        "assign_rate_positions": rate(len(assigned_csp), len(csp_closed)),
        "assigned_positions": len(assigned_csp), "csp_positions": len(csp_closed),
        "collateral_in_use": round(sum(collateral(t) for t in open_ if t["side"] == "sell"), 2),
        "open_premium": round(sum(t["open_price"] * 100 * t["qty"] for t in open_ if t["side"] == "sell"), 2),
        "monthly": [{"month": k, **{kk: round(vv, 2) for kk, vv in v.items()}} for k, v in sorted(monthly.items())],
        "by_ticker": sorted(
            [{"ticker": k, **{kk: round(vv, 2) for kk, vv in v.items()}} for k, v in by_ticker.items()],
            key=lambda x: x["premium"], reverse=True,
        ),
    }


def mark_position(t: dict, chain: Chain | None) -> dict:
    """Açık pozisyonu canlı zincirle değerler ve yönetim önerisi üretir."""
    out = decorate(t)
    out["advice"] = []
    if chain is None:
        return out
    exp = _d(t["expiry"])
    out["spot"] = chain.spot
    if exp and exp < chain.as_of.date():
        itm = chain.spot < t["strike"] if t["opt_type"] == "P" else chain.spot > t["strike"]
        out["itm"] = itm
        out["advice"].append(
            L("Vadesi geçti. Hisse strike'ın içinde kaldığı için büyük olasılıkla atandın: 'Atandım' olarak kapat.",
              "Expired. The stock finished in the money, so you were likely assigned: close it as 'Assigned'.")
            if itm else
            L("Vadesi geçti ve hisse strike'ın dışında kaldı: 'Değersiz bitti' olarak kapat.",
              "Expired out of the money: close it as 'Expired worthless'.")
        )
        return out
    o = chain.find(exp, t["opt_type"], t["strike"]) if exp else None
    if not o:
        out["advice"].append(L("Kontrat zincirde bulunamadı (vadesi geçmiş olabilir).", "Contract not found in the chain (it may have expired)."))
        return out
    mark = o.mid
    qty = t["qty"]
    out.update({
        "mark": round(mark, 4), "bid": o.bid, "ask": o.ask, "delta": o.delta, "iv": o.iv,
        "itm": (chain.spot < t["strike"]) if t["opt_type"] == "P" else (chain.spot > t["strike"]),
        "distance": chain.spot / t["strike"] - 1,
    })
    dte = chain.dte(exp)
    out["dte"] = dte
    if t["side"] == "sell":
        unreal = (t["open_price"] - mark) * 100 * qty
        captured = 1 - mark / t["open_price"] if t["open_price"] else None
        out["unrealized"] = round(unreal, 2)
        out["captured"] = captured
        if captured is not None and captured >= 0.5 and dte > 2:
            out["advice"].append(L(f"Primin yüzde {captured*100:.0f} kadarı kazanıldı. Şimdi kapatıp yeni bir kontrat açmak sermayeni daha verimli kullanır (%50 kuralı).",
                                   f"{captured*100:.0f}% of the premium is earned. Closing now and opening a new contract uses your capital more efficiently (50% rule)."))
        if out["itm"] and dte <= 5:
            if t["opt_type"] == "P":
                out["advice"].append(L("Put ITM ve vade yakın: atanmaya hazır ol ya da daha ileri vadeye/aşağı strike'a roll et.",
                                       "Put is in the money near expiry: be ready for assignment, or roll to a later date / lower strike."))
            else:
                out["advice"].append(L("Call ITM ve vade yakın: hisse elinden gidebilir. Tutmak istiyorsan yukarı/ileri roll et.",
                                       "Call is in the money near expiry: your shares may be called away. Roll up/out to keep them."))
        elif out["itm"]:
            out["advice"].append(L("Kontrat ITM. Erken atanma riski düşük olsa da takipte kal.", "Contract is in the money. Early assignment is unlikely, but keep an eye on it."))
        if o.delta is not None and abs(o.delta) >= 0.5 and not out["itm"]:
            out["advice"].append(L("Delta 0.50'ye yaklaştı: fiyat strike'a çok yakın.", "Delta is near 0.50: price is very close to the strike."))
        if dte == 0:
            out["advice"].append(L("Bugün vade sonu.", "Expires today."))
    else:
        unreal = (mark - t["open_price"]) * 100 * qty
        out["unrealized"] = round(unreal, 2)
        out["captured"] = mark / t["open_price"] - 1 if t["open_price"] else None
        if dte < 120 and t["strategy"] == "leaps":
            out["advice"].append(L("Vadeye 120 günden az kaldı: zaman kaybı hızlanıyor, ileri vadeye roll düşünülebilir.",
                                   "Less than 120 days left: time decay is accelerating; consider rolling out."))
    return out
