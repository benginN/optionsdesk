"""Kontrat tarayıcı: strateji bazlı tek tek kontratları puanlar.

Stratejiler:
  csp   – Cash-Secured Put (nakit teminatlı put satışı)
  cc    – Covered Call (hisse teminatlı call satışı)
  pcs   – Put Credit Spread (boğa put kredi spread'i)
  ccs   – Call Credit Spread (ayı call kredi spread'i)
  leaps – LEAPS Long Call (uzun vadeli call alımı)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

from . import bs
from .chain import Chain, Opt
from .pricing import edge_vs_realized, fill_buy, fill_sell, pop_short, prob_otm, sigma_distance
from .scoring import lin
from .smile import SmileFit


@dataclass
class Filters:
    dte_min: int = 4
    dte_max: int = 21
    delta_min: float = 0.10
    delta_max: float = 0.35
    min_oi: int = 50
    max_spread_pct: float = 0.20
    max_capital: float | None = None
    min_premium: float = 5.0          # kontrat başına minimum prim ($)
    exclude_earnings: bool = False
    min_strike: float | None = None   # CC için maliyet üstü strike vb.
    max_width: float | None = None    # spread'ler için maksimum genişlik ($)
    commission: float = 0.65
    extra: dict = field(default_factory=dict)


def _r(x, n=4):
    if x is None:
        return None
    if isinstance(x, float) and not math.isfinite(x):
        return None
    return round(x, n)


def _liq_score(o: Opt) -> float:
    sp = lin(o.spread_pct, 0.25, 0.02) or 0.0
    oi = lin(math.log10(o.oi + 1), 1.0, 3.5) or 0.0
    return 0.7 * sp + 0.3 * oi


def _earn_in_window(chain: Chain, exp: date, earnings: dict | None) -> bool:
    if not earnings or not earnings.get("date"):
        return False
    try:
        ed = date.fromisoformat(earnings["date"])
    except ValueError:
        return False
    return chain.as_of.date() <= ed <= exp


def _base(chain: Chain, o: Opt, earn: bool, ctx: dict) -> dict:
    return {
        "ticker": chain.sym, "spot": chain.spot, "expiry": o.expiry.isoformat(), "dte": chain.dte(o.expiry),
        "cp": o.cp, "strike": o.strike, "bid": o.bid, "ask": o.ask, "mid": _r(o.mid),
        "delta": o.delta, "iv": o.iv if o.valid_iv else None, "oi": o.oi, "volume": o.volume,
        "spread_pct": _r(o.spread_pct), "earnings": earn, "earnings_date": (ctx.get("earnings") or {}).get("date"),
        "symbol": o.symbol,
    }


def _short_single(chain: Chain, o: Opt, strategy: str, f: Filters, ctx: dict, smile: SmileFit) -> dict | None:
    prem = fill_sell(o)
    if prem * 100 < f.min_premium:
        return None
    dte = max(chain.dte(o.expiry), 1)
    T = chain.T(o.expiry)
    if strategy == "csp":
        capital = o.strike * 100
        be = o.strike - prem
        yld = prem / o.strike
    else:
        basis = ctx.get("cost_basis") or chain.spot
        capital = chain.spot * 100
        be = basis - prem
        yld = prem / chain.spot
    if f.max_capital and capital > f.max_capital:
        return None
    earn = _earn_in_window(chain, o.expiry, ctx.get("earnings"))
    if f.exclude_earnings and earn:
        return None
    hv = ctx.get("hv_blend")
    pop = pop_short(chain, o, prem)
    p_otm = prob_otm(chain, o)
    edge = edge_vs_realized(chain, o, prem, hv)
    sd = sigma_distance(chain, o, o.iv)
    resid = smile.residual(o.expiry, o.strike, o.iv if o.valid_iv else None)
    ann = yld * 365 / dte
    touch = bs.prob_touch(chain.spot, o.strike, T, o.iv) if o.valid_iv else None

    parts = {
        "getiri": lin(math.sqrt(ann), math.sqrt(0.05), math.sqrt(1.0)),
        "olasilik": lin(pop, 0.55, 0.93),
        "risk_primi": lin(edge / prem if edge is not None and prem else None, -0.3, 0.5),
        "mesafe": lin(abs(sd) if sd is not None else None, 0.3, 1.4),
        "likidite": _liq_score(o),
        "gulumseme": lin(resid, -0.03, 0.05),
    }
    w = {"getiri": 0.25, "olasilik": 0.20, "risk_primi": 0.20, "mesafe": 0.10, "likidite": 0.15, "gulumseme": 0.10}
    num = sum(parts[k] * w[k] for k in w if parts[k] is not None)
    den = sum(w[k] for k in w if parts[k] is not None)
    score = 100 * num / den if den else 0
    if earn:
        score = min(score - 20, 55)
    row = _base(chain, o, earn, ctx)
    row.update({
        "strategy": strategy, "premium": prem, "premium_total": prem * 100, "capital": capital,
        "yield": _r(yld), "ann": _r(ann), "breakeven": _r(be, 3),
        "be_pct": _r(be / chain.spot - 1), "otm_pct": _r(o.strike / chain.spot - 1),
        "pop": _r(pop), "p_otm": _r(p_otm), "p_touch": _r(touch), "edge": _r(edge),
        "sd": _r(sd, 2), "iv_resid": _r(resid), "theta_day": _r(-o.theta * 100, 2) if o.theta else None,
        "score": int(round(max(0, min(100, score)))), "parts": {k: _r(v, 3) for k, v in parts.items()},
    })
    if strategy == "cc" and ctx.get("cost_basis"):
        row["assign_pl"] = _r((o.strike - ctx["cost_basis"] + prem) * 100, 2)
    return row


def _credit_spread(chain: Chain, short: Opt, longs: list[Opt], strategy: str, f: Filters, ctx: dict) -> list[dict]:
    out = []
    credit_fill = fill_sell(short)
    for lg in longs:
        width = abs(short.strike - lg.strike)
        if width <= 0 or (f.max_width and width > f.max_width):
            continue
        if not lg.has_market or lg.spread_pct > max(f.max_spread_pct, 0.35):
            continue
        credit = credit_fill - fill_buy(lg)
        if credit <= 0.02 or credit >= width:
            continue
        max_loss = (width - credit) * 100
        capital = max_loss
        if f.max_capital and capital > f.max_capital:
            continue
        if credit * 100 < f.min_premium:
            continue
        dte = max(chain.dte(short.expiry), 1)
        be = short.strike - credit if strategy == "pcs" else short.strike + credit
        sig = short.iv if short.valid_iv else None
        T = chain.T(short.expiry)
        if sig:
            p_above = bs.prob_above(chain.spot, max(be, 0.01), T, sig, chain.r)
            pop = p_above if strategy == "pcs" else 1 - p_above
        else:
            pop = None
        roc = credit * 100 / max_loss
        earn = _earn_in_window(chain, short.expiry, ctx.get("earnings"))
        if f.exclude_earnings and earn:
            continue
        # Gerçekleşen volatiliteye göre adil spread değeri ile alınan kredinin farkı (satıcı avantajı)
        ev = None
        hv = ctx.get("hv_blend")
        if hv:
            fair = (bs.price(chain.spot, short.strike, T, chain.r, hv, short.cp)
                    - bs.price(chain.spot, lg.strike, T, chain.r, hv, lg.cp))
            ev = (credit - fair) * 100
        parts = {
            "getiri": lin(roc * 365 / dte, 0.2, 4.0),
            "olasilik": lin(pop, 0.55, 0.9),
            "rr": lin(roc, 0.1, 0.5),
            "risk_primi": lin(ev / (credit * 100) if ev is not None else None, -0.3, 0.5),
            "likidite": 0.5 * _liq_score(short) + 0.5 * _liq_score(lg),
        }
        w = {"getiri": 0.20, "olasilik": 0.30, "rr": 0.15, "risk_primi": 0.15, "likidite": 0.20}
        num = sum(parts[k] * w[k] for k in w if parts[k] is not None)
        den = sum(w[k] for k in w if parts[k] is not None)
        score = 100 * num / den if den else 0
        if earn:
            score = min(score - 20, 55)
        row = _base(chain, short, earn, ctx)
        row.update({
            "strategy": strategy, "long_strike": lg.strike, "long_bid": lg.bid, "long_ask": lg.ask,
            "width": width, "premium": _r(credit), "premium_total": _r(credit * 100, 2), "capital": _r(capital, 2),
            "max_loss": _r(max_loss, 2), "yield": _r(roc), "ann": _r(roc * 365 / dte), "breakeven": _r(be, 3),
            "be_pct": _r(be / chain.spot - 1), "otm_pct": _r(short.strike / chain.spot - 1),
            "pop": _r(pop), "ev": _r(ev, 2), "score": int(round(max(0, min(100, score)))),
            "parts": {k: _r(v, 3) for k, v in parts.items()},
        })
        out.append(row)
    return out


def _leaps(chain: Chain, o: Opt, f: Filters, ctx: dict, smile: SmileFit) -> dict | None:
    price = fill_buy(o)
    if price <= 0:
        return None
    cost = price * 100
    if f.max_capital and cost > f.max_capital:
        return None
    T = chain.T(o.expiry)
    intrinsic = max(0.0, chain.spot - o.strike)
    extrinsic = max(0.0, price - intrinsic)
    ext_yr = extrinsic / chain.spot / T if chain.spot and T else None
    be = o.strike + price
    be_move = be / chain.spot - 1
    lev = (o.delta or 0) * chain.spot / price
    resid = smile.residual(o.expiry, o.strike, o.iv if o.valid_iv else None)
    # Senaryolar: vade sonunda hisse +%X olursa opsiyon getirisi
    scen = []
    for mv in (-0.2, 0.0, 0.2, 0.4, 0.6):
        st = chain.spot * (1 + mv)
        val = max(0.0, st - o.strike)
        scen.append({"move": mv, "stock": mv, "option": _r(val / price - 1)})
    parts = {
        "maliyet": lin(ext_yr, 0.25, 0.04),
        "gulumseme": lin(-(resid or 0), -0.03, 0.03) if resid is not None else None,
        "likidite": _liq_score(o),
        "delta": 1 - min(1.0, abs((o.delta or 0) - 0.75) / 0.25),
        "basabas": lin(be_move, 0.5, 0.05),
    }
    w = {"maliyet": 0.35, "gulumseme": 0.15, "likidite": 0.25, "delta": 0.10, "basabas": 0.15}
    num = sum(parts[k] * w[k] for k in w if parts[k] is not None)
    den = sum(w[k] for k in w if parts[k] is not None)
    row = _base(chain, o, False, ctx)
    row.update({
        "strategy": "leaps", "premium": price, "premium_total": cost, "capital": cost,
        "extrinsic": _r(extrinsic), "extrinsic_pct_yr": _r(ext_yr), "breakeven": _r(be, 3), "be_pct": _r(be_move),
        "leverage": _r(lev, 2), "stock_cost": chain.spot * 100, "discount": _r(1 - price / chain.spot),
        "iv_resid": _r(resid), "scenarios": scen,
        "score": int(round(max(0, min(100, 100 * num / den if den else 0)))),
        "parts": {k: _r(v, 3) for k, v in parts.items()},
    })
    return row


def scan_chain(chain: Chain, strategy: str, f: Filters, ctx: dict) -> list[dict]:
    """Tek bir zinciri verilen strateji ve filtrelerle tarar."""
    out: list[dict] = []
    smile = SmileFit(chain)
    for exp in chain.expiries:
        dte = chain.dte(exp)
        if dte < f.dte_min or dte > f.dte_max:
            continue
        side = chain.by_exp[exp]
        if strategy in ("csp", "pcs"):
            opts = side["P"]
        else:
            opts = side["C"]
        for o in opts:
            if o.delta is None or not o.has_market:
                continue
            ad = abs(o.delta)
            if ad < f.delta_min or ad > f.delta_max:
                continue
            if o.oi < f.min_oi or o.spread_pct > f.max_spread_pct:
                continue
            if f.min_strike and o.strike < f.min_strike and strategy in ("cc", "ccs"):
                continue
            if strategy in ("csp", "cc"):
                if (strategy == "csp" and o.strike >= chain.spot) or (strategy == "cc" and o.strike <= chain.spot):
                    continue
                row = _short_single(chain, o, strategy, f, ctx, smile)
                if row:
                    out.append(row)
            elif strategy == "pcs":
                if o.strike >= chain.spot:
                    continue
                longs = [p for p in opts if p.strike < o.strike][-6:]
                out.extend(_credit_spread(chain, o, longs, "pcs", f, ctx))
            elif strategy == "ccs":
                if o.strike <= chain.spot:
                    continue
                longs = [p for p in opts if p.strike > o.strike][:6]
                out.extend(_credit_spread(chain, o, longs, "ccs", f, ctx))
            elif strategy == "leaps":
                row = _leaps(chain, o, f, ctx, smile)
                if row:
                    out.append(row)
    return out


PRESETS = {
    "csp": Filters(dte_min=4, dte_max=21, delta_min=0.10, delta_max=0.35),
    "cc": Filters(dte_min=4, dte_max=21, delta_min=0.08, delta_max=0.30),
    "pcs": Filters(dte_min=7, dte_max=45, delta_min=0.15, delta_max=0.35, min_premium=10),
    "ccs": Filters(dte_min=7, dte_max=45, delta_min=0.15, delta_max=0.35, min_premium=10),
    "leaps": Filters(dte_min=300, dte_max=1000, delta_min=0.55, delta_max=0.90, min_oi=10, max_spread_pct=0.12, min_premium=0),
}
