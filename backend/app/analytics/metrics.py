"""Hisse bazlı günlük metrikler (snapshot'a kaydedilen alanlar)."""
from __future__ import annotations

import math
from datetime import date

from ..data.cboe import company_name
from . import history as H
from .chain import Chain
from .pricing import closest_delta, edge_vs_realized, fill_buy, fill_sell, prob_otm


def _r(x, n=4):
    if x is None:
        return None
    if isinstance(x, float) and not math.isfinite(x):
        return None
    return round(x, n)


def _csp_candidate(c: Chain, hsum: dict, target_dte: int = 10, target_delta: float = 0.25) -> dict | None:
    exps = [e for e in c.expiries if 4 <= c.dte(e) <= 24]
    if not exps:
        return None
    exp = min(exps, key=lambda e: abs(c.dte(e) - target_dte))
    o = closest_delta([p for p in c.by_exp[exp]["P"] if p.strike < c.spot], target_delta)
    if not o:
        return None
    prem = fill_sell(o)
    dte = max(c.dte(exp), 1)
    y = prem / o.strike if o.strike else None
    return {
        "expiry": exp.isoformat(), "dte": dte, "strike": o.strike, "delta": o.delta, "iv": o.iv,
        "bid": o.bid, "ask": o.ask, "premium": prem, "yield": _r(y), "ann": _r(y * 365 / dte if y else None),
        "capital": o.strike * 100, "spread_pct": _r(o.spread_pct), "oi": o.oi,
        "pop": _r(prob_otm(c, o)), "edge": _r(edge_vs_realized(c, o, prem, hsum.get("hv_blend"))),
        "otm_pct": _r(1 - o.strike / c.spot),
    }


def _cc_candidate(c: Chain, hsum: dict, target_dte: int = 10, target_delta: float = 0.20) -> dict | None:
    exps = [e for e in c.expiries if 4 <= c.dte(e) <= 24]
    if not exps:
        return None
    exp = min(exps, key=lambda e: abs(c.dte(e) - target_dte))
    o = closest_delta([x for x in c.by_exp[exp]["C"] if x.strike > c.spot], target_delta)
    if not o:
        return None
    prem = fill_sell(o)
    dte = max(c.dte(exp), 1)
    y = prem / c.spot if c.spot else None
    return {
        "expiry": exp.isoformat(), "dte": dte, "strike": o.strike, "delta": o.delta, "iv": o.iv,
        "bid": o.bid, "ask": o.ask, "premium": prem, "yield": _r(y), "ann": _r(y * 365 / dte if y else None),
        "capital": c.spot * 100, "spread_pct": _r(o.spread_pct), "oi": o.oi,
        "pop": _r(prob_otm(c, o)), "edge": _r(edge_vs_realized(c, o, prem, hsum.get("hv_blend"))),
        "otm_pct": _r(o.strike / c.spot - 1),
    }


def _leaps_candidate(c: Chain, target_days: int = 540, target_delta: float = 0.70) -> dict | None:
    exps = [e for e in c.expiries if c.dte(e) >= 300]
    if not exps:
        return None
    exp = min(exps, key=lambda e: abs(c.dte(e) - target_days))
    o = closest_delta(c.by_exp[exp]["C"], target_delta)
    if not o:
        return None
    price = fill_buy(o)
    intrinsic = max(0.0, c.spot - o.strike)
    extrinsic = max(0.0, price - intrinsic)
    T = c.T(exp)
    be = o.strike + price
    return {
        "expiry": exp.isoformat(), "dte": c.dte(exp), "strike": o.strike, "delta": o.delta, "iv": o.iv,
        "bid": o.bid, "ask": o.ask, "price": price, "cost": price * 100,
        "extrinsic": extrinsic, "extrinsic_pct_yr": _r(extrinsic / c.spot / T if c.spot and T else None),
        "breakeven": be, "be_move": _r(be / c.spot - 1), "leverage": _r((o.delta or 0) * c.spot / price if price else None),
        "stock_cost": c.spot * 100, "discount": _r(1 - price / c.spot if c.spot else None),
        "spread_pct": _r(o.spread_pct), "oi": o.oi,
    }


def compute(chain: Chain, hist_rows: list[dict], earnings: dict | None) -> dict:
    """Bir hissenin snapshot metriklerini üretir."""
    c = chain
    hsum = H.summarize(hist_rows) if hist_rows else {}
    iv30 = c.iv30_cboe or c.iv_constant(30)
    exp30 = c.expiry_near(30, min_dte=7)
    sk = c.skew(exp30) if exp30 else None
    exp_w = c.expiry_near(7, min_dte=2)
    st_w = c.straddle(exp_w) if exp_w else None
    pc = c.put_call()
    liq = c.liquidity()
    hv30 = hsum.get("hv30")
    em30 = iv30 * math.sqrt(30 / 365) if iv30 else None

    earn_date = earnings.get("date") if earnings else None
    days_to_earn = (date.fromisoformat(earn_date) - c.as_of.date()).days if earn_date else None

    hv_series = hsum.get("hv30_series") or []
    iv_vs_hv_pct = H.percentile_rank(hv_series, iv30) if iv30 and hv_series else None

    csp = _csp_candidate(c, hsum)
    cc = _cc_candidate(c, hsum)
    leaps = _leaps_candidate(c)

    front = c.expiry_near(7, min_dte=2)
    iv_front = c.atm_iv(front) if front else None
    iv90 = c.iv_constant(90)

    return {
        "ticker": c.sym,
        "name": company_name(c.sym),
        "as_of": c.as_of.isoformat(),
        "price": _r(c.spot, 4),
        "change_pct": _r(c.change_pct, 5),
        "volume": c.volume,
        "iv30": _r(iv30),
        "iv_front": _r(iv_front),
        "iv90": _r(iv90),
        "iv1y": _r(c.iv_constant(365)),
        "term_slope": _r(iv90 / iv_front - 1 if iv90 and iv_front else None),  # <0: ters (backwardation)
        "hv10": _r(hsum.get("hv10")),
        "hv20": _r(hsum.get("hv20")),
        "hv30": _r(hv30),
        "hv60": _r(hsum.get("hv60")),
        "hv1y": _r(hsum.get("hv1y")),
        "hv_blend": _r(hsum.get("hv_blend")),
        "vrp": _r(iv30 / hv30 if iv30 and hv30 else None),
        "iv_vs_hv_pct": _r(iv_vs_hv_pct, 1),
        "skew": _r(sk["skew"] if sk else None),
        "p25": _r(sk["p25"] if sk else None),
        "c25": _r(sk["c25"] if sk else None),
        "em30_pct": _r(em30),
        "em30_low": _r(c.spot * (1 - em30) if em30 else None, 2),
        "em30_high": _r(c.spot * (1 + em30) if em30 else None, 2),
        "emw_pct": _r(st_w["move_pct"] if st_w else None),
        "emw_expiry": st_w["expiry"] if st_w else None,
        "put_oi": pc["put_oi"], "call_oi": pc["call_oi"],
        "put_vol": pc["put_volume"], "call_vol": pc["call_volume"],
        "pcr_oi": _r(pc["pcr_oi"]), "pcr_vol": _r(pc["pcr_volume"]),
        "opt_premium": _r(pc["call_premium"] + pc["put_premium"], 0),
        "spread_med": _r(liq["median_spread_pct"]),
        "near_oi": liq["near_oi"],
        "rsi14": _r(hsum.get("rsi14"), 2),
        "sma50": _r(hsum.get("sma50"), 2),
        "sma200": _r(hsum.get("sma200"), 2),
        "high52": hsum.get("high52"),
        "low52": hsum.get("low52"),
        "dd_from_high": _r(hsum.get("dd_from_high")),
        "ret_5d": _r(hsum.get("ret_5d")),
        "ret_1m": _r(hsum.get("ret_1m")),
        "ret_3m": _r(hsum.get("ret_3m")),
        "ret_1y": _r(hsum.get("ret_1y")),
        "earnings": earn_date,
        "earnings_time": earnings.get("time") if earnings else None,
        "days_to_earnings": days_to_earn,
        "csp": csp,
        "cc": cc,
        "leaps": leaps,
        "unusual": [
            {k: u.get(k) for k in ("symbol", "expiry", "dte", "cp", "strike", "volume", "oi", "vol_oi",
                                   "premium", "side", "mid", "iv", "delta", "moneyness")}
            for u in c.unusual(limit=5)
        ],
    }
