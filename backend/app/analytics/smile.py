"""Volatilite gülümsemesine yerel uyum.

Her vade için OTM opsiyonların IV'leri log-moneyness'e göre sıralanır. Bir kontratın
'adil' IV'si, kendisi hariç iki yanındaki en fazla 3'er komşu strike'a ağırlıklı doğrusal
regresyonla bulunur (leave-one-out). Böylece kanat eğriliği tek bir polinomla
zorlanmaz; sapma, kontratın *komşularına göre* pahalı ya da ucuz olduğunu gösterir.
"""
from __future__ import annotations

import math
from datetime import date

from .chain import Chain

NEIGHBORS = 3


class SmileFit:
    def __init__(self, chain: Chain):
        self.chain = chain
        self._pts: dict[date, list[tuple[float, float, float, float]]] = {}

    def points(self, exp: date) -> list[tuple[float, float, float, float]]:
        """(log-moneyness, iv, ağırlık, strike) listesi, strike'a göre sıralı."""
        if exp in self._pts:
            return self._pts[exp]
        c = self.chain
        side = c.by_exp.get(exp)
        pts: list[tuple[float, float, float, float]] = []
        if side and c.spot > 0:
            for o in side["P"] + side["C"]:
                otm = (o.cp == "P" and o.strike <= c.spot) or (o.cp == "C" and o.strike > c.spot)
                if not otm or not o.valid_iv or not o.has_market or o.delta is None:
                    continue
                if not 0.03 <= abs(o.delta) <= 0.65 or o.spread_pct > 0.5:
                    continue
                w = 1.0 / (0.02 + o.spread_pct)  # dar spread'li kotasyonlara daha çok güven
                pts.append((math.log(o.strike / c.spot), o.iv, w, o.strike))  # type: ignore[arg-type]
            pts.sort(key=lambda p: p[0])
        self._pts[exp] = pts
        return pts

    def fitted_iv(self, exp: date, strike: float) -> float | None:
        pts = self.points(exp)
        if len(pts) < 4 or self.chain.spot <= 0:
            return None
        k0 = math.log(strike / self.chain.spot)
        # Kendisi hariç, k0'ın solundaki ve sağındaki en yakın komşular
        left = [p for p in pts if p[0] < k0 - 1e-9][-NEIGHBORS:]
        right = [p for p in pts if p[0] > k0 + 1e-9][:NEIGHBORS]
        if not left or not right:
            return None  # Uç noktalarda dış değerleme yapma
        nb = left + right
        sw = sum(p[2] for p in nb)
        mk = sum(p[2] * p[0] for p in nb) / sw
        mv = sum(p[2] * p[1] for p in nb) / sw
        var = sum(p[2] * (p[0] - mk) ** 2 for p in nb)
        slope = sum(p[2] * (p[0] - mk) * (p[1] - mv) for p in nb) / var if var > 0 else 0.0
        return mv + slope * (k0 - mk)

    def residual(self, exp: date, strike: float, iv: float | None) -> float | None:
        if iv is None:
            return None
        f = self.fitted_iv(exp, strike)
        return None if f is None else iv - f
