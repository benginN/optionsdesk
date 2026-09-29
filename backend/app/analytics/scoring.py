"""Strateji bazlı hisse skorları (0–100) ve volatilite rejimi sinyalleri.

Skorlar şeffaftır: her bileşen 0–1 arasına normalize edilir, ağırlıklandırılır
ve arayüzde bileşen bileşen gösterilir.
"""
from __future__ import annotations

import math

from ..i18n import L
from . import history as H


def lin(x: float | None, a: float, b: float) -> float | None:
    """x=a → 0, x=b → 1 (a>b ise ters yön), [0,1] aralığına kırpılır."""
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return None
    if a == b:
        return 0.5
    v = (x - a) / (b - a)
    return max(0.0, min(1.0, v))


def iv_position(m: dict, iv_hist: list[float] | None) -> dict:
    iv = m.get("iv30")
    hist = iv_hist or []
    if iv is not None and len(hist) >= 20:
        lo, hi = min(hist), max(hist)
        return {
            "iv_pos": H.percentile_rank(hist, iv),
            "iv_rank": 100 * (iv - lo) / (hi - lo) if hi > lo else 50.0,
            "iv_pos_source": "iv",
            "iv_hist_n": len(hist),
        }
    return {
        "iv_pos": m.get("iv_vs_hv_pct"),
        "iv_rank": None,
        "iv_pos_source": "hv",  # IV geçmişi birikene kadar: IV30'un son 1 yıllık HV30 dağılımındaki yeri
        "iv_hist_n": len(hist),
    }


WEIGHTS = {
    "csp": {"prim": 0.25, "iv": 0.20, "risk_primi": 0.20, "likidite": 0.15, "kurulum": 0.12, "skew": 0.08},
    "cc": {"prim": 0.25, "iv": 0.20, "risk_primi": 0.20, "likidite": 0.15, "kurulum": 0.12, "skew": 0.08},
    "leaps": {"iv_ucuz": 0.30, "maliyet": 0.25, "kurulum": 0.20, "trend": 0.10, "likidite": 0.15},
}


def _weighted(parts: dict[str, float | None], weights: dict[str, float]) -> float | None:
    num = den = 0.0
    for k, w in weights.items():
        v = parts.get(k)
        if v is None:
            continue
        num += v * w
        den += w
    if den < 0.5:
        return None
    return num / den


def _liq(cand: dict | None) -> float | None:
    if not cand:
        return None
    sp = lin(cand.get("spread_pct"), 0.25, 0.02)
    oi = lin(math.log10((cand.get("oi") or 0) + 1), 1.0, 3.5)
    if sp is None:
        return oi
    return 0.7 * sp + 0.3 * (oi or 0)


def _risk_premium(m: dict, cand: dict | None) -> float | None:
    v = lin(m.get("vrp"), 0.8, 1.6)
    e = None
    if cand and cand.get("edge") is not None and cand.get("premium"):
        e = lin(cand["edge"] / cand["premium"], -0.3, 0.5)
    vals = [x for x in (v, e) if x is not None]
    return sum(vals) / len(vals) if vals else None


_SELF = object()   # "adayı satırın kendisinden al" işareti (None = aday yok demek)


def _ann(c: dict, ref_dte: int | None) -> float:
    """Yıllık getiri. ref_dte verilirse o vadeye eşdeğer hale getirilir (× √(gün/ref)):
    prim zamanın karekökü ile büyür, yıllıklandırınca uzun vade yapısal olarak düşük görünür.
    Eşikler ~10 günlük kontrata göre ayarlı; farklı sürelerin skorları böylece aynı ölçekte kalır."""
    a = max(c.get("ann") or 0, 0)
    if ref_dte and c.get("dte"):
        a *= math.sqrt(c["dte"] / ref_dte)
    return a


def score_csp(m: dict, ivp: float | None, c=_SELF, ref_dte: int | None = None) -> tuple[int | None, dict, list[str]]:
    c = m.get("csp") if c is _SELF else c
    flags: list[str] = []
    if not c:
        return None, {}, [L("Uygun vade/strike yok", "No suitable expiry/strike")]
    parts = {
        "prim": lin(math.sqrt(_ann(c, ref_dte)), math.sqrt(0.05), math.sqrt(0.9)),
        "iv": ivp / 100 if ivp is not None else None,
        "risk_primi": _risk_premium(m, c),
        "likidite": _liq(c),
        "kurulum": lin(m.get("rsi14"), 70, 30),
        "skew": lin(m.get("skew"), -0.05, 0.35),
    }
    s = _weighted(parts, WEIGHTS["csp"])
    if s is None:
        return None, parts, flags
    score = 100 * s
    dte_e = m.get("days_to_earnings")
    if dte_e is not None and 0 <= dte_e <= (c.get("dte") or 0):
        # Bilanço IV'si primi şişirir ama gap riski taşır: skoru hem düşür hem sınırla
        score = min(score - 20, 55)
        flags.append(L("Vade içinde bilanço", "Earnings before expiry"))
    if (m.get("price") or 0) < 3:
        score -= 5
        flags.append(L("Düşük fiyatlı hisse", "Low-priced stock"))
    if (m.get("iv30") or 0) > 1.3:
        score -= 6
        flags.append(L("Aşırı yüksek IV (olay riski)", "Extremely high IV (event risk)"))
    if (c.get("spread_pct") or 1) > 0.3:
        score = min(score, 40)
        flags.append(L("Geniş spread", "Wide spread"))
    return int(round(max(0, min(100, score)))), parts, flags


def score_cc(m: dict, ivp: float | None, c=_SELF, ref_dte: int | None = None) -> tuple[int | None, dict, list[str]]:
    c = m.get("cc") if c is _SELF else c
    flags: list[str] = []
    if not c:
        return None, {}, [L("Uygun vade/strike yok", "No suitable expiry/strike")]
    skew = m.get("skew")
    parts = {
        "prim": lin(math.sqrt(_ann(c, ref_dte)), math.sqrt(0.04), math.sqrt(0.7)),
        "iv": ivp / 100 if ivp is not None else None,
        "risk_primi": _risk_premium(m, c),
        "likidite": _liq(c),
        "kurulum": lin(m.get("rsi14"), 35, 75),
        "skew": lin(-skew if skew is not None else None, -0.35, 0.05),
    }
    s = _weighted(parts, WEIGHTS["cc"])
    if s is None:
        return None, parts, flags
    score = 100 * s
    dte_e = m.get("days_to_earnings")
    if dte_e is not None and 0 <= dte_e <= (c.get("dte") or 0):
        score = min(score - 15, 60)
        flags.append(L("Vade içinde bilanço", "Earnings before expiry"))
    if (c.get("spread_pct") or 1) > 0.3:
        score = min(score, 40)
        flags.append(L("Geniş spread", "Wide spread"))
    return int(round(max(0, min(100, score)))), parts, flags


def score_leaps(m: dict, ivp: float | None, c=_SELF) -> tuple[int | None, dict, list[str]]:
    c = m.get("leaps") if c is _SELF else c
    flags: list[str] = []
    if not c:
        return None, {}, [L("1 yıldan uzun vade yok", "No expiry beyond 1 year")]
    price, sma200 = m.get("price"), m.get("sma200")
    rsi_part = lin(m.get("rsi14"), 65, 30)
    dd_part = lin(m.get("dd_from_high"), -0.02, -0.35)
    setup_vals = [x for x in (rsi_part, dd_part) if x is not None]
    parts = {
        "iv_ucuz": 1 - ivp / 100 if ivp is not None else None,
        "maliyet": lin(c.get("extrinsic_pct_yr"), 0.25, 0.04),
        "kurulum": sum(setup_vals) / len(setup_vals) if setup_vals else None,
        "trend": lin(price / sma200 - 1 if price and sma200 else None, -0.3, 0.1),
        "likidite": _liq(c),
    }
    s = _weighted(parts, WEIGHTS["leaps"])
    if s is None:
        return None, parts, flags
    score = 100 * s
    if (c.get("spread_pct") or 1) > 0.25:
        score = min(score, 45)
        flags.append(L("Geniş spread", "Wide spread"))
    return int(round(max(0, min(100, score)))), parts, flags


PRIM_REF_DTE = 10   # metrics._csp_candidate / _cc_candidate hedef vadesi
SCORERS = {"csp": score_csp, "cc": score_cc, "leaps": score_leaps}


def for_preferences(row: dict, horizon: str, risk: str) -> dict:
    """Zenginleştirilmiş satırı Fikirler sayfasındaki süre × risk tercihine göre yeniden kurar:
    örnek kontrat o tercihin adayı olur, skor aynı formülle o kontrattan hesaplanır.
    Adaylar yoksa (eski snapshot) satır olduğu gibi döner, `prefs_applied` False olur."""
    alts = row.get("alts")
    if not alts:
        return {**row, "prefs_applied": False}
    out = dict(row)
    scores, parts, flags = dict(row["scores"]), dict(row["score_parts"]), dict(row["flags"])
    for s in SCORERS:
        if s == "leaps":
            c = alts["leaps"].get(risk)
            scores[s], parts[s], flags[s] = score_leaps(row, row.get("iv_pos"), c)
        else:
            c = alts[s].get(horizon, {}).get(risk)
            scores[s], parts[s], flags[s] = SCORERS[s](row, row.get("iv_pos"), c, ref_dte=PRIM_REF_DTE)
        out[s] = c
    out.update(scores=scores, score_parts=parts, flags=flags, prefs_applied=True)
    return out


def vol_signal(ivp: float | None, rsi: float | None) -> dict:
    """@onestoploss 'Volatiliteye göre doğru opsiyon hamleleri' kuralları."""
    if ivp is None:
        return {"code": "none", "text": L("Veri yetersiz", "Not enough data")}
    high, low = ivp >= 60, ivp <= 30
    ob = rsi is not None and rsi >= 70
    os_ = rsi is not None and rsi <= 35
    if high and ob:
        return {"code": "sell_call", "text": L("IV yüksek + aşırı alım → CALL sat", "High IV + overbought → sell calls")}
    if high and os_:
        return {"code": "sell_put", "text": L("IV yüksek + aşırı satım → PUT sat", "High IV + oversold → sell puts")}
    if high:
        return {"code": "sell", "text": L("IV yüksek → opsiyon sat", "High IV → sell options")}
    if low and os_:
        return {"code": "buy_leaps", "text": L("IV düşük + aşırı satım → LEAPS CALL al", "Low IV + oversold → buy LEAPS calls")}
    if low:
        return {"code": "buy", "text": L("IV düşük → orta/uzun vadeli opsiyon al", "Low IV → buy mid/long-dated options")}
    return {"code": "neutral", "text": L("IV orta seviyede → seçici ol", "IV is middling → be selective")}


def enrich(m: dict, iv_hist: list[float] | None) -> dict:
    """Snapshot metriğine IV Pos, skorlar ve sinyal ekler."""
    out = dict(m)
    ivinfo = iv_position(m, iv_hist)
    out.update(ivinfo)
    ivp = ivinfo["iv_pos"]
    csp, csp_parts, csp_flags = score_csp(m, ivp)
    cc, cc_parts, cc_flags = score_cc(m, ivp)
    lp, lp_parts, lp_flags = score_leaps(m, ivp)
    out["scores"] = {"csp": csp, "cc": cc, "leaps": lp}
    out["score_parts"] = {"csp": csp_parts, "cc": cc_parts, "leaps": lp_parts}
    out["flags"] = {"csp": csp_flags, "cc": cc_flags, "leaps": lp_flags}
    out["signal"] = vol_signal(ivp, m.get("rsi14"))
    return out
