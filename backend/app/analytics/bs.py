"""Black-Scholes fiyatlama, Greeks ve olasılık hesapları (numpy gerektirmez)."""
from __future__ import annotations

import math

SQRT2 = math.sqrt(2.0)


def ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / SQRT2))


def npdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _d1d2(S: float, K: float, T: float, r: float, sigma: float, q: float = 0.0) -> tuple[float, float]:
    T = max(T, 1e-6)
    sigma = max(sigma, 1e-4)
    vs = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vs
    return d1, d1 - vs


def price(S: float, K: float, T: float, r: float, sigma: float, cp: str, q: float = 0.0) -> float:
    if T <= 0:
        return max(0.0, S - K) if cp == "C" else max(0.0, K - S)
    d1, d2 = _d1d2(S, K, T, r, sigma, q)
    if cp == "C":
        return S * math.exp(-q * T) * ncdf(d1) - K * math.exp(-r * T) * ncdf(d2)
    return K * math.exp(-r * T) * ncdf(-d2) - S * math.exp(-q * T) * ncdf(-d1)


def greeks(S: float, K: float, T: float, r: float, sigma: float, cp: str, q: float = 0.0) -> dict:
    d1, d2 = _d1d2(S, K, T, r, sigma, q)
    T = max(T, 1e-6)
    sqT = math.sqrt(T)
    disc_q = math.exp(-q * T)
    disc_r = math.exp(-r * T)
    gamma = disc_q * npdf(d1) / (S * sigma * sqT)
    vega = S * disc_q * npdf(d1) * sqT / 100.0
    if cp == "C":
        delta = disc_q * ncdf(d1)
        theta = (-S * disc_q * npdf(d1) * sigma / (2 * sqT) - r * K * disc_r * ncdf(d2) + q * S * disc_q * ncdf(d1)) / 365.0
    else:
        delta = -disc_q * ncdf(-d1)
        theta = (-S * disc_q * npdf(d1) * sigma / (2 * sqT) + r * K * disc_r * ncdf(-d2) - q * S * disc_q * ncdf(-d1)) / 365.0
    return {"delta": delta, "gamma": gamma, "theta": theta, "vega": vega}


def prob_above(S: float, K: float, T: float, sigma: float, mu: float = 0.0) -> float:
    """Lognormal dağılımda vade sonunda fiyatın K üstünde olma olasılığı."""
    if T <= 0:
        return 1.0 if S > K else 0.0
    sigma = max(sigma, 1e-4)
    d2 = (math.log(S / K) + (mu - 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    return ncdf(d2)


def prob_touch(S: float, K: float, T: float, sigma: float) -> float:
    """Vadeye kadar K'ya en az bir kez dokunma olasılığı (yaklaşık = 2 × vade sonu ITM olasılığı)."""
    p_itm = prob_above(S, K, T, sigma) if K > S else 1 - prob_above(S, K, T, sigma)
    return min(1.0, 2 * p_itm)


def implied_vol(target: float, S: float, K: float, T: float, r: float, cp: str, q: float = 0.0) -> float | None:
    """Brent benzeri ikiye bölme ile implied volatility."""
    intrinsic = max(0.0, S - K) if cp == "C" else max(0.0, K - S)
    if target <= intrinsic + 1e-6 or T <= 0:
        return None
    lo, hi = 1e-3, 6.0
    if price(S, K, T, r, hi, cp, q) < target:
        return None
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if price(S, K, T, r, mid, cp, q) > target:
            hi = mid
        else:
            lo = mid
        if hi - lo < 1e-6:
            break
    return 0.5 * (lo + hi)
