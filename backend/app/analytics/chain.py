"""Opsiyon zinciri modeli ve zincir tabanlı analizler.

ATM IV, delta bazlı IV, skew, vade yapısı, beklenen hareket, put/call oranları,
max pain, gamma exposure (GEX) ve olağandışı işlem tespiti burada hesaplanır.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date, datetime, time

from ..config import ET
from ..data.cache import market_is_open
from ..data.cboe import parse_cboe_time
from . import bs

OCC_RE = re.compile(r"^(?P<root>[A-Z0-9.]+?)(?P<date>\d{6})(?P<cp>[CP])(?P<strike>\d{8})$")


def _f(x) -> float:
    try:
        v = float(x)
        return v if math.isfinite(v) else 0.0
    except (TypeError, ValueError):
        return 0.0


@dataclass(slots=True)
class Opt:
    symbol: str
    root: str
    expiry: date
    cp: str
    strike: float
    bid: float
    ask: float
    last: float
    iv: float | None
    delta: float | None
    gamma: float
    theta: float
    vega: float
    oi: int
    volume: int
    bid_size: int
    ask_size: int
    last_trade: str | None
    prev_close: float
    change: float

    @property
    def has_market(self) -> bool:
        return self.bid > 0 and self.ask > 0 and self.ask >= self.bid

    @property
    def mid(self) -> float:
        if self.has_market:
            return (self.bid + self.ask) / 2
        if self.ask > 0:
            return self.ask / 2
        return self.last

    @property
    def spread(self) -> float:
        return self.ask - self.bid if self.has_market else float("nan")

    @property
    def spread_pct(self) -> float:
        m = self.mid
        return (self.ask - self.bid) / m if self.has_market and m > 0 else float("inf")

    @property
    def valid_iv(self) -> bool:
        return self.iv is not None and 0.01 < self.iv < 5.0

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol, "expiry": self.expiry.isoformat(), "cp": self.cp, "strike": self.strike,
            "bid": self.bid, "ask": self.ask, "mid": round(self.mid, 4), "last": self.last,
            "iv": self.iv if self.valid_iv else None, "delta": self.delta, "gamma": self.gamma,
            "theta": self.theta, "vega": self.vega, "oi": self.oi, "volume": self.volume,
            "spread_pct": None if not math.isfinite(self.spread_pct) else round(self.spread_pct, 4),
            "last_trade": self.last_trade, "change": self.change,
        }


def parse_option(o: dict) -> Opt | None:
    m = OCC_RE.match(o.get("option", ""))
    if not m:
        return None
    ds = m.group("date")
    try:
        exp = date(2000 + int(ds[:2]), int(ds[2:4]), int(ds[4:6]))
    except ValueError:
        return None
    iv = _f(o.get("iv"))
    delta = o.get("delta")
    return Opt(
        symbol=o["option"], root=m.group("root"), expiry=exp, cp=m.group("cp"),
        strike=int(m.group("strike")) / 1000.0,
        bid=_f(o.get("bid")), ask=_f(o.get("ask")), last=_f(o.get("last_trade_price")),
        iv=iv if iv > 0 else None, delta=_f(delta) if delta is not None else None,
        gamma=_f(o.get("gamma")), theta=_f(o.get("theta")), vega=_f(o.get("vega")),
        oi=int(_f(o.get("open_interest"))), volume=int(_f(o.get("volume"))),
        bid_size=int(_f(o.get("bid_size"))), ask_size=int(_f(o.get("ask_size"))),
        last_trade=o.get("last_trade_time"), prev_close=_f(o.get("prev_day_close")), change=_f(o.get("change")),
    )


class Chain:
    def __init__(self, raw: dict, r: float = 0.04):
        d = raw["data"]
        self.raw_timestamp = raw.get("timestamp")
        self.sym = (d.get("symbol") or "").lstrip("^_").upper()
        self.r = r
        self.spot = _f(d.get("current_price")) or _f(d.get("close")) or _f(d.get("prev_day_close"))
        self.bid = _f(d.get("bid"))
        self.ask = _f(d.get("ask"))
        self.prev_close = _f(d.get("prev_day_close"))
        self.change_pct = _f(d.get("price_change_percent")) / 100.0
        self.volume = _f(d.get("volume"))
        self.iv30_cboe = _f(d.get("iv30")) / 100.0 or None
        self.security_type = d.get("security_type")
        self.as_of = parse_cboe_time(d.get("last_trade_time")) or datetime.now(ET)
        # Piyasa kapalıyken CBOE'nin hisse bid/ask'ı seans sonrası kotasyondur; opsiyon kotasyonları
        # ise 16:00 kapanışına aittir. Tutarlılık için kapanış fiyatını referans al.
        close = _f(d.get("close"))
        if not market_is_open() and close > 0:
            self.spot = close
            self.bid = self.ask = close

        # Aynı vade/strike/tip için tekrar eden kökler (SPX/SPXW gibi): en likit olanı tut
        best: dict[tuple, Opt] = {}
        for o in d.get("options") or []:
            opt = parse_option(o)
            if not opt or opt.expiry < self.as_of.date():
                continue
            key = (opt.expiry, opt.cp, opt.strike)
            cur = best.get(key)
            if cur is None or (opt.oi + opt.volume) > (cur.oi + cur.volume):
                best[key] = opt
        self.options: list[Opt] = list(best.values())
        self.by_exp: dict[date, dict[str, list[Opt]]] = {}
        for o in self.options:
            self.by_exp.setdefault(o.expiry, {"C": [], "P": []})[o.cp].append(o)
        for e in self.by_exp.values():
            e["C"].sort(key=lambda x: x.strike)
            e["P"].sort(key=lambda x: x.strike)
        self.expiries: list[date] = sorted(self.by_exp)
        self._atm_cache: dict[date, float | None] = {}

    # --- zaman ---------------------------------------------------------

    def T(self, exp: date) -> float:
        exp_dt = datetime.combine(exp, time(16, 0), tzinfo=ET)
        secs = (exp_dt - self.as_of).total_seconds()
        return max(secs, 3600.0) / (365.0 * 86400.0)

    def dte(self, exp: date) -> int:
        return (exp - self.as_of.date()).days

    def expiry_near(self, days: float, min_dte: int = 0) -> date | None:
        cands = [e for e in self.expiries if self.dte(e) >= min_dte]
        if not cands:
            return None
        return min(cands, key=lambda e: abs(self.dte(e) - days))

    # --- volatilite ----------------------------------------------------

    def atm_iv(self, exp: date) -> float | None:
        if exp in self._atm_cache:
            return self._atm_cache[exp]
        side = self.by_exp.get(exp)
        val = None
        if side:
            by_strike: dict[float, list[float]] = {}
            for o in side["C"] + side["P"]:
                if o.valid_iv and (o.bid > 0 or o.oi > 0):
                    by_strike.setdefault(o.strike, []).append(o.iv)  # type: ignore[arg-type]
            strikes = sorted(by_strike)
            below = [k for k in strikes if k <= self.spot]
            above = [k for k in strikes if k >= self.spot]
            if below and above:
                k1, k2 = below[-1], above[0]
                v1 = sum(by_strike[k1]) / len(by_strike[k1])
                v2 = sum(by_strike[k2]) / len(by_strike[k2])
                val = v1 if k1 == k2 else v1 + (v2 - v1) * (self.spot - k1) / (k2 - k1)
            elif strikes:
                k = min(strikes, key=lambda s: abs(s - self.spot))
                val = sum(by_strike[k]) / len(by_strike[k])
        self._atm_cache[exp] = val
        return val

    def iv_at_delta(self, exp: date, target: float, cp: str) -> float | None:
        """|delta| = target olan OTM opsiyonun IV'si (delta'ya göre doğrusal enterpolasyon)."""
        side = self.by_exp.get(exp, {}).get(cp, [])
        pts = sorted(
            (abs(o.delta), o.iv) for o in side
            if o.valid_iv and o.delta is not None and 0.02 < abs(o.delta) < 0.6 and (o.bid > 0 or o.oi > 0)
        )
        if len(pts) < 2:
            return None
        if target <= pts[0][0] or target >= pts[-1][0]:
            return None
        for (d1, v1), (d2, v2) in zip(pts[:-1], pts[1:]):
            if d1 <= target <= d2:
                return v1 if d2 == d1 else v1 + (v2 - v1) * (target - d1) / (d2 - d1)
        return None

    def skew(self, exp: date) -> dict | None:
        atm = self.atm_iv(exp)
        p25 = self.iv_at_delta(exp, 0.25, "P")
        c25 = self.iv_at_delta(exp, 0.25, "C")
        if not atm or p25 is None or c25 is None:
            return None
        return {"atm": atm, "p25": p25, "c25": c25, "rr": p25 - c25, "skew": (p25 - c25) / atm,
                "put_wing": p25 / atm, "call_wing": c25 / atm}

    def term_structure(self, min_dte: int = 1) -> list[dict]:
        out = []
        for e in self.expiries:
            dte = self.dte(e)
            if dte < min_dte:
                continue
            iv = self.atm_iv(e)
            if iv:
                out.append({"expiry": e.isoformat(), "dte": dte, "iv": iv})
        return out

    def iv_constant(self, days: float) -> float | None:
        """Sabit vadeli ATM IV: toplam varyansta doğrusal enterpolasyon."""
        pts = [(self.T(e), self.atm_iv(e)) for e in self.expiries if self.dte(e) >= 3]
        pts = [(t, v) for t, v in pts if v]
        if not pts:
            return None
        tD = days / 365.0
        if tD <= pts[0][0]:
            return pts[0][1]
        if tD >= pts[-1][0]:
            return pts[-1][1]
        for (t1, v1), (t2, v2) in zip(pts[:-1], pts[1:]):
            if t1 <= tD <= t2:
                w1, w2 = v1 * v1 * t1, v2 * v2 * t2
                w = w1 + (w2 - w1) * (tD - t1) / (t2 - t1)
                return math.sqrt(max(w, 1e-8) / tD)
        return None

    # --- beklenen hareket ---------------------------------------------

    def straddle(self, exp: date) -> dict | None:
        side = self.by_exp.get(exp)
        if not side:
            return None
        calls = {o.strike: o for o in side["C"] if o.has_market}
        puts = {o.strike: o for o in side["P"] if o.has_market}
        common = sorted(set(calls) & set(puts), key=lambda k: abs(k - self.spot))
        if not common:
            return None
        k = common[0]
        price = calls[k].mid + puts[k].mid
        return {
            "expiry": exp.isoformat(), "dte": self.dte(exp), "strike": k, "price": price,
            "move_pct": price / self.spot if self.spot else None,
            "low": self.spot - price, "high": self.spot + price,
        }

    def expected_moves(self) -> list[dict]:
        """Yakın vadeler için straddle tabanlı beklenen hareket."""
        out = []
        for e in self.expiries:
            if self.dte(e) < 0:
                continue
            s = self.straddle(e)
            if s:
                s["iv"] = self.atm_iv(e)
                out.append(s)
            if len(out) >= 8:
                break
        return out

    # --- akış ve pozisyonlanma ----------------------------------------

    def put_call(self, max_dte: int | None = None) -> dict:
        cv = pv = coi = poi = 0
        cprem = pprem = 0.0
        for o in self.options:
            if max_dte is not None and self.dte(o.expiry) > max_dte:
                continue
            if o.cp == "C":
                cv += o.volume
                coi += o.oi
                cprem += o.volume * o.mid * 100
            else:
                pv += o.volume
                poi += o.oi
                pprem += o.volume * o.mid * 100
        return {
            "call_volume": cv, "put_volume": pv, "call_oi": coi, "put_oi": poi,
            "call_premium": cprem, "put_premium": pprem,
            "pcr_volume": pv / cv if cv else None, "pcr_oi": poi / coi if coi else None,
            "pcr_premium": pprem / cprem if cprem else None,
        }

    def max_pain(self, exp: date) -> float | None:
        side = self.by_exp.get(exp)
        if not side:
            return None
        calls = [(o.strike, o.oi) for o in side["C"] if o.oi]
        puts = [(o.strike, o.oi) for o in side["P"] if o.oi]
        strikes = sorted({k for k, _ in calls} | {k for k, _ in puts})
        if not strikes:
            return None
        best, best_val = None, float("inf")
        for p in strikes:
            val = sum(oi * max(p - k, 0) for k, oi in calls) + sum(oi * max(k - p, 0) for k, oi in puts)
            if val < best_val:
                best, best_val = p, val
        return best

    def oi_by_strike(self, exp: date | None = None, max_dte: int = 60, band: float = 0.3) -> list[dict]:
        agg: dict[float, dict] = {}
        for o in self.options:
            if exp is not None and o.expiry != exp:
                continue
            if exp is None and self.dte(o.expiry) > max_dte:
                continue
            if abs(o.strike / self.spot - 1) > band:
                continue
            a = agg.setdefault(o.strike, {"strike": o.strike, "call_oi": 0, "put_oi": 0, "call_vol": 0, "put_vol": 0})
            if o.cp == "C":
                a["call_oi"] += o.oi
                a["call_vol"] += o.volume
            else:
                a["put_oi"] += o.oi
                a["put_vol"] += o.volume
        return [agg[k] for k in sorted(agg)]

    def gex(self, max_dte: int = 60, band: float = 0.15) -> dict:
        """Dealer gamma exposure ($ / %1 hareket). Çağrılar +, putlar − varsayımı."""
        by_strike: dict[float, float] = {}
        total = 0.0
        opts = [o for o in self.options if self.dte(o.expiry) <= max_dte and o.oi > 0]
        for o in opts:
            g = o.gamma * o.oi * 100 * self.spot * self.spot * 0.01
            g = g if o.cp == "C" else -g
            total += g
            if abs(o.strike / self.spot - 1) <= band:
                by_strike[o.strike] = by_strike.get(o.strike, 0.0) + g

        # Gamma dönüş noktası: farklı spot seviyelerinde toplam GEX'i yeniden hesapla
        flip = None
        usable = [o for o in opts if o.valid_iv and abs(o.strike / self.spot - 1) < 0.35]
        if usable and len(usable) < 8000:
            grid = [self.spot * (1 + x / 100.0) for x in range(-12, 13)]
            prev = None
            for s in grid:
                tot = 0.0
                for o in usable:
                    T = self.T(o.expiry)
                    d1 = (math.log(s / o.strike) + (self.r + 0.5 * o.iv * o.iv) * T) / (o.iv * math.sqrt(T))  # type: ignore[operator]
                    gm = bs.npdf(d1) / (s * o.iv * math.sqrt(T))  # type: ignore[operator]
                    val = gm * o.oi * 100 * s * s * 0.01
                    tot += val if o.cp == "C" else -val
                if prev is not None and (prev[1] < 0 <= tot or prev[1] > 0 >= tot):
                    s0, v0 = prev
                    flip = s0 + (s - s0) * (0 - v0) / (tot - v0) if tot != v0 else s
                    break
                prev = (s, tot)

        # Duvarlar için bant: ~2 standart sapmalık 30 günlük hareket (%5–%25 arası)
        iv_ref = self.iv30_cboe or self.iv_constant(30) or 0.3
        wall_band = max(0.05, min(0.25, 2 * iv_ref * math.sqrt(30 / 365)))
        near = [o for o in opts if abs(o.strike / self.spot - 1) <= wall_band]
        call_wall = max((o for o in near if o.cp == "C"), key=lambda o: o.oi, default=None)
        put_wall = max((o for o in near if o.cp == "P"), key=lambda o: o.oi, default=None)
        # Aynı strike'taki tüm vadelerin OI'sini topla
        oi_c: dict[float, int] = {}
        oi_p: dict[float, int] = {}
        for o in near:
            (oi_c if o.cp == "C" else oi_p)[o.strike] = (oi_c if o.cp == "C" else oi_p).get(o.strike, 0) + o.oi
        cw = max(oi_c.items(), key=lambda x: x[1])[0] if oi_c else (call_wall.strike if call_wall else None)
        pw = max(oi_p.items(), key=lambda x: x[1])[0] if oi_p else (put_wall.strike if put_wall else None)
        return {
            "total": total,
            "by_strike": [{"strike": k, "gex": v} for k, v in sorted(by_strike.items())],
            "flip": flip,
            "call_wall": cw,
            "put_wall": pw,
        }

    def unusual(self, min_volume: int = 300, min_ratio: float = 1.5, min_premium: float = 25000, limit: int = 25) -> list[dict]:
        out = []
        for o in self.options:
            if o.volume < min_volume:
                continue
            # Derin ITM işlemler genelde temettü/sentetik pozisyon amaçlıdır; yön bilgisi taşımaz
            if abs(o.strike / self.spot - 1) > 0.25 or (o.delta is not None and abs(o.delta) > 0.85):
                continue
            ratio = o.volume / o.oi if o.oi else float("inf")
            premium = o.volume * o.mid * 100
            if ratio < min_ratio or premium < min_premium:
                continue
            side = "mid"  # buy / sell / mid — dil bağımsız kod (snapshot'ta saklanır)
            if o.has_market and o.last > 0:
                sp = o.ask - o.bid
                if o.last >= o.ask - 0.25 * sp:
                    side = "buy"
                elif o.last <= o.bid + 0.25 * sp:
                    side = "sell"
            d = o.to_dict()
            d.update({
                "ticker": self.sym, "dte": self.dte(o.expiry), "vol_oi": None if not math.isfinite(ratio) else ratio,
                "premium": premium, "side": side, "moneyness": o.strike / self.spot - 1,
            })
            out.append(d)
        out.sort(key=lambda x: x["premium"], reverse=True)
        return out[:limit]

    def liquidity(self) -> dict:
        """Yakın vadeli, anlamlı delta aralığındaki kontratların spread ve OI özeti."""
        spreads = []
        oi_total = 0
        for o in self.options:
            dte = self.dte(o.expiry)
            if 5 <= dte <= 45 and o.delta is not None and 0.2 <= abs(o.delta) <= 0.5:
                oi_total += o.oi
                if o.has_market:
                    spreads.append(o.spread_pct)
        spreads.sort()
        med = spreads[len(spreads) // 2] if spreads else None
        return {"median_spread_pct": med, "near_oi": oi_total, "n_quoted": len(spreads)}

    # --- tablo çıktısı -------------------------------------------------

    def expiry_list(self) -> list[dict]:
        return [{"expiry": e.isoformat(), "dte": self.dte(e), "atm_iv": self.atm_iv(e)} for e in self.expiries]

    def chain_table(self, exp: date) -> list[dict]:
        side = self.by_exp.get(exp)
        if not side:
            return []
        rows: dict[float, dict] = {}
        for cp in ("C", "P"):
            for o in side[cp]:
                rows.setdefault(o.strike, {"strike": o.strike})["call" if cp == "C" else "put"] = o.to_dict()
        return [rows[k] for k in sorted(rows)]

    def smile(self, exp: date) -> list[dict]:
        side = self.by_exp.get(exp)
        if not side:
            return []
        out = []
        for o in side["P"]:
            if o.strike <= self.spot and o.valid_iv and (o.bid > 0 or o.oi > 0):
                out.append({"strike": o.strike, "iv": o.iv, "cp": "P", "delta": o.delta})
        for o in side["C"]:
            if o.strike > self.spot and o.valid_iv and (o.bid > 0 or o.oi > 0):
                out.append({"strike": o.strike, "iv": o.iv, "cp": "C", "delta": o.delta})
        return sorted(out, key=lambda x: x["strike"])

    def find(self, exp: date, cp: str, strike: float) -> Opt | None:
        for o in self.by_exp.get(exp, {}).get(cp, []):
            if abs(o.strike - strike) < 1e-6:
                return o
        return None
