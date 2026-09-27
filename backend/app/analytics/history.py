"""Fiyat geçmişinden türetilen metrikler: tarihsel volatilite, RSI, trend, 52 haftalık aralık."""
from __future__ import annotations

import math
import statistics


def log_returns(closes: list[float]) -> list[float]:
    return [math.log(b / a) for a, b in zip(closes[:-1], closes[1:]) if a > 0 and b > 0]


def hv(closes: list[float], window: int) -> float | None:
    """Yıllıklandırılmış close-to-close tarihsel volatilite (ondalık)."""
    rets = log_returns(closes[-(window + 1):])
    if len(rets) < max(5, window // 2):
        return None
    return statistics.pstdev(rets) * math.sqrt(252)


def hv_series(closes: list[float], window: int = 30, length: int = 252) -> list[float]:
    """Son `length` gün için kayan HV serisi (IV Pos tahmini için)."""
    rets = log_returns(closes)
    out = []
    start = max(window, len(rets) - length)
    for i in range(start, len(rets) + 1):
        seg = rets[i - window:i]
        if len(seg) == window:
            out.append(statistics.pstdev(seg) * math.sqrt(252))
    return out


def rsi(closes: list[float], period: int = 14) -> float | None:
    """Wilder RSI."""
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for a, b in zip(closes[:-1], closes[1:]):
        ch = b - a
        gains.append(max(ch, 0.0))
        losses.append(max(-ch, 0.0))
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    for g, l in zip(gains[period:], losses[period:]):
        avg_g = (avg_g * (period - 1) + g) / period
        avg_l = (avg_l * (period - 1) + l) / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - 100 / (1 + rs)


def sma(closes: list[float], n: int) -> float | None:
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def pct_change(closes: list[float], n: int) -> float | None:
    if len(closes) <= n or closes[-n - 1] <= 0:
        return None
    return closes[-1] / closes[-n - 1] - 1


def percentile_rank(values: list[float], x: float) -> float | None:
    if not values:
        return None
    below = sum(1 for v in values if v < x)
    equal = sum(1 for v in values if v == x)
    return 100.0 * (below + 0.5 * equal) / len(values)


def summarize(rows: list[dict]) -> dict:
    """Fiyat geçmişi özetini üretir."""
    closes = [r["close"] for r in rows if r.get("close")]
    if len(closes) < 30:
        return {}
    last = closes[-1]
    year = rows[-252:]
    high52 = max(r["high"] for r in year)
    low52 = min(r["low"] for r in year)
    hv30s = hv_series(closes, 30, 252)
    out = {
        "hv10": hv(closes, 10),
        "hv20": hv(closes, 20),
        "hv30": hv(closes, 30),
        "hv60": hv(closes, 60),
        "hv1y": hv(closes, 252),
        "rsi14": rsi(closes[-200:], 14),
        "sma20": sma(closes, 20),
        "sma50": sma(closes, 50),
        "sma200": sma(closes, 200),
        "high52": high52,
        "low52": low52,
        "dd_from_high": last / high52 - 1 if high52 else None,
        "from_low": last / low52 - 1 if low52 else None,
        "ret_1d": pct_change(closes, 1),
        "ret_5d": pct_change(closes, 5),
        "ret_1m": pct_change(closes, 21),
        "ret_3m": pct_change(closes, 63),
        "ret_1y": pct_change(closes, 252),
        "hv30_min1y": min(hv30s) if hv30s else None,
        "hv30_max1y": max(hv30s) if hv30s else None,
        "hv30_series": hv30s,
        "last_close": last,
        "last_date": rows[-1]["date"],
        "avg_volume20": sum(r["volume"] for r in rows[-20:]) / min(20, len(rows)),
    }
    # Gelecek volatilite tahmini: kısa ve uzun vadeli HV karışımı
    parts = [(out["hv20"], 0.5), (out["hv60"], 0.3), (out["hv1y"], 0.2)]
    avail = [(v, w) for v, w in parts if v]
    out["hv_blend"] = sum(v * w for v, w in avail) / sum(w for _, w in avail) if avail else None
    return out
