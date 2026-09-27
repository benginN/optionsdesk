"""Gerçekçi dolum fiyatı ve kontrat bazlı ortak hesaplamalar."""
from __future__ import annotations

import math

from . import bs
from .chain import Chain, Opt


def fill_sell(o: Opt) -> float:
    """Satışta gerçekçi dolum: bid + spread'in %25'i (dar spread'de mid'e yakın)."""
    if o.has_market:
        return round(o.bid + 0.25 * (o.ask - o.bid), 4)
    return o.bid


def fill_buy(o: Opt) -> float:
    """Alışta gerçekçi dolum: ask − spread'in %25'i."""
    if o.has_market:
        return round(o.ask - 0.25 * (o.ask - o.bid), 4)
    return o.ask


def pop_short(chain: Chain, o: Opt, premium: float, sigma: float | None = None) -> float | None:
    """Kısa opsiyonun vade sonunda kârda kapanma olasılığı (başabaşa göre, risk-nötr lognormal)."""
    sig = sigma or o.iv
    if not sig or chain.spot <= 0:
        return None
    T = chain.T(o.expiry)
    if o.cp == "P":
        be = o.strike - premium
        return bs.prob_above(chain.spot, max(be, 0.01), T, sig, chain.r)
    be = o.strike + premium
    return 1 - bs.prob_above(chain.spot, be, T, sig, chain.r)


def prob_otm(chain: Chain, o: Opt, sigma: float | None = None) -> float | None:
    """Vade sonunda değersiz bitme (OTM) olasılığı."""
    sig = sigma or o.iv
    if not sig:
        return None
    p_above = bs.prob_above(chain.spot, o.strike, chain.T(o.expiry), sig, chain.r)
    return p_above if o.cp == "P" else 1 - p_above


def edge_vs_realized(chain: Chain, o: Opt, premium: float, sigma_real: float | None) -> float | None:
    """Kısa opsiyonun 'gerçekleşen volatilite' ile adil değerine göre fazlası (hisse başına $).

    Pozitif değer: piyasa bu riski geçmiş hareketliliğe göre pahalı fiyatlıyor (satıcı lehine).
    """
    if not sigma_real or sigma_real <= 0:
        return None
    fair = bs.price(chain.spot, o.strike, chain.T(o.expiry), chain.r, sigma_real, o.cp)
    return premium - fair


def sigma_distance(chain: Chain, o: Opt, sigma: float | None) -> float | None:
    """Strike'ın spottan kaç standart sapma uzakta olduğu (vadeye göre)."""
    if not sigma or chain.spot <= 0:
        return None
    sd = sigma * math.sqrt(chain.T(o.expiry))
    return math.log(o.strike / chain.spot) / sd if sd > 0 else None


def closest_delta(opts: list[Opt], target: float) -> Opt | None:
    cands = [o for o in opts if o.delta is not None and o.bid > 0 and o.has_market]
    if not cands:
        return None
    return min(cands, key=lambda o: abs(abs(o.delta) - target))  # type: ignore[arg-type]
