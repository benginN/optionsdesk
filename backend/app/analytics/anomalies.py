"""Fiyatlama anomalileri ve arbitraj kontrolleri.

Tüm kontroller *işlem yapılabilir* fiyatlarla (alışta ask, satışta bid) ve
komisyon düşülerek yapılır. Veriler 15 dk gecikmeli olduğu için bulunan her
sonuç 'aday'dır; canlı kotasyonla doğrulanmadan işlem yapılmamalıdır.
"""
from __future__ import annotations

import math
from datetime import date

from . import bs
from ..data.cache import market_is_open
from ..i18n import L
from .chain import Chain, Opt
from .smile import SmileFit


def _ok(o: Opt | None, max_spread: float = 0.35, min_oi: int = 10) -> bool:
    """Arbitraj kontrolüne girecek kotasyon: iki yönlü, boyutlu, makul spread'li ve biraz OI'li."""
    return bool(o and o.has_market and o.bid_size > 0 and o.ask_size > 0 and o.spread_pct <= max_spread and o.oi >= min_oi)


def _q(o: Opt) -> dict:
    return {"strike": o.strike, "cp": o.cp, "bid": o.bid, "ask": o.ask, "oi": o.oi, "volume": o.volume,
            "expiry": o.expiry.isoformat()}


def _quality(*opts: Opt) -> str:
    if all(o.oi >= 100 and o.spread_pct <= 0.1 for o in opts):
        return "iyi"
    if all(o.oi >= 10 for o in opts):
        return "orta"
    return "şüpheli"


def _near_strikes(chain: Chain, exp: date, n: int = 40) -> list[float]:
    side = chain.by_exp.get(exp, {})
    strikes = sorted({o.strike for o in side.get("C", [])} & {o.strike for o in side.get("P", [])})
    strikes.sort(key=lambda k: abs(k - chain.spot))
    return sorted(strikes[:n])


def parity(chain: Chain, fee: float, min_profit: float) -> list[dict]:
    out = []
    s_bid = chain.bid or chain.spot
    s_ask = chain.ask or chain.spot
    is_index = chain.security_type == "index"
    if is_index:
        return out  # Endekslerde hisse bacağı alınıp satılamaz
    if not market_is_open():
        # Kapanıştan sonra hisse kotasyonu (seans sonrası) ile opsiyon kotasyonları (16:00/16:15)
        # aynı ana ait değil; hisse bacaklı kontroller yanlış sinyal üretir.
        return out
    for exp in chain.expiries:
        if chain.dte(exp) > 45:
            continue  # Uzun vadede temettü/ödünç maliyeti pariteyi meşru şekilde bozar; box kontrolü yeterli
        T = chain.T(exp)
        disc = math.exp(-chain.r * T)
        # Bilinmeyen temettü/ödünç için pay: yıllık %2 ölçeğinde
        allowance = s_ask * 0.02 * T
        for k in _near_strikes(chain, exp, 30):
            c, p = chain.find(exp, "C", k), chain.find(exp, "P", k)
            if not (_ok(c) and _ok(p)):
                continue
            conv = c.bid - p.ask - s_ask + k * disc - 2 * fee
            rev = s_bid - k * disc - c.ask + p.bid - 2 * fee
            if conv > min_profit:
                out.append({
                    "type": "conversion", "title": "Conversion", "expiry": exp.isoformat(), "dte": chain.dte(exp),
                    "strike": k, "profit": round(conv, 4), "profit_total": round(conv * 100, 2),
                    "legs": [L("Hisse al (100)", "Buy stock (100)"), f"{k:g} CALL {L("sat", "sell")} @ {c.bid}", f"{k:g} PUT {L("al", "buy")} @ {p.ask}"],
                    "quality": _quality(c, p), "conservative": round(c.bid - p.ask - s_ask + k - 2 * fee, 4),
                    "note": L("Faiz dahil. Temettü alırsınız; erken call ataması kârı bozmaz.", "Interest included. You collect dividends; early call assignment does not hurt the profit."),
                })
            if rev > min_profit + allowance:
                out.append({
                    "type": "reversal", "title": "Reversal", "expiry": exp.isoformat(), "dte": chain.dte(exp),
                    "strike": k, "profit": round(rev, 4), "profit_total": round(rev * 100, 2),
                    "legs": [L("Hisse açığa sat (100)", "Short stock (100)"), f"{k:g} CALL {L("al", "buy")} @ {c.ask}", f"{k:g} PUT {L("sat", "sell")} @ {p.bid}"],
                    "quality": _quality(c, p), "conservative": round(s_bid - k - c.ask + p.bid - 2 * fee, 4),
                    "note": L("Temettü ve ödünç (borrow) maliyeti dahil değil. Pahalı putlar genelde yüksek borrow ücretini yansıtır.", "Dividends and borrow costs are not included. Rich puts often reflect a high borrow fee."),
                })
    return out


def boxes(chain: Chain, fee: float, min_profit: float) -> tuple[list[dict], list[dict]]:
    arbs, rates = [], []
    for exp in chain.expiries:
        T = chain.T(exp)
        if chain.dte(exp) < 1:
            continue
        strikes = _near_strikes(chain, exp, 30)
        q = {k: (chain.find(exp, "C", k), chain.find(exp, "P", k)) for k in strikes}
        q = {k: v for k, v in q.items() if _ok(v[0], 0.25) and _ok(v[1], 0.25)}
        ks = sorted(q)
        best_lend = None   # long box: bugün öde, vadede genişlik al → borç verme faizi
        best_borrow = None  # short box: bugün al, vadede genişlik öde → borçlanma faizi
        for i in range(len(ks)):
            for j in range(i + 1, len(ks)):
                k1, k2 = ks[i], ks[j]
                w = k2 - k1
                c1, p1 = q[k1]
                c2, p2 = q[k2]
                cost = c1.ask - c2.bid + p2.ask - p1.bid + 4 * fee
                credit = c1.bid - c2.ask + p2.bid - p1.ask - 4 * fee
                if cost > 0:
                    r_lend = math.log(w / cost) / T if w > cost else -1.0
                    if best_lend is None or r_lend > best_lend[0]:
                        best_lend = (r_lend, k1, k2, cost, w)
                # Short box'ta satılan bacaklardan biri mutlaka ITM'dir; Amerikan tipi opsiyonlarda
                # erken kullanım primi bu 'arbitrajı' açıklar. Sadece Avrupa tipi endekslerde kontrol et.
                if credit > 0 and chain.security_type == "index":
                    if credit >= w:
                        arbs.append({
                            "type": "short_box", "title": L("Short Box (ücretsiz para)", "Short box (free money)"), "expiry": exp.isoformat(),
                            "dte": chain.dte(exp), "strike": k1, "strike2": k2,
                            "profit": round(credit - w, 4), "profit_total": round((credit - w) * 100, 2),
                            "legs": [f"{k1:g} CALL {L("sat", "sell")}", f"{k2:g} CALL {L("al", "buy")}", f"{k1:g} PUT {L("al", "buy")}", f"{k2:g} PUT {L("sat", "sell")}"],
                            "quality": _quality(c1, c2, p1, p2),
                            "note": L("Alınan kredi vade sonu borcundan fazla.", "The credit received exceeds what is owed at expiry."),
                        })
                    else:
                        r_b = math.log(w / credit) / T
                        if best_borrow is None or r_b < best_borrow[0]:
                            best_borrow = (r_b, k1, k2, credit, w)
        if best_lend and best_lend[0] > 0:
            r_lend, k1, k2, cost, w = best_lend
            rates.append({"expiry": exp.isoformat(), "dte": chain.dte(exp), "lend_rate": round(r_lend, 5),
                          "lend_strikes": [k1, k2], "lend_cost": round(cost, 4), "width": w,
                          "borrow_rate": round(best_borrow[0], 5) if best_borrow else None})
            excess = r_lend - chain.r
            if excess > 0.03 and chain.dte(exp) >= 7:
                gain = (w * math.exp(-chain.r * T) - cost)
                if gain > min_profit:
                    arbs.append({
                        "type": "long_box", "title": L("Long Box (yüksek faiz)", "Long box (high rate)"), "expiry": exp.isoformat(),
                        "dte": chain.dte(exp), "strike": k1, "strike2": k2,
                        "profit": round(gain, 4), "profit_total": round(gain * 100, 2),
                        "legs": [f"{k1:g} CALL {L("al", "buy")}", f"{k2:g} CALL {L("sat", "sell")}", f"{k1:g} PUT {L("sat", "sell")}", f"{k2:g} PUT {L("al", "buy")}"],
                        "quality": "orta",
                        "note": L(f"Kutu, risksiz faizin (%{chain.r*100:.2f}) üstünde %{r_lend*100:.2f} yıllık getiri ima ediyor.", f"The box implies {r_lend*100:.2f}% a year, above the risk-free {chain.r*100:.2f}%."),
                    })
    return arbs, rates


def verticals(chain: Chain, fee: float, min_profit: float) -> list[dict]:
    out = []
    for exp in chain.expiries:
        for cp in ("C", "P"):
            opts = [o for o in chain.by_exp[exp][cp] if _ok(o)]
            for i, a in enumerate(opts):
                for b in opts[i + 1:i + 6]:
                    w = b.strike - a.strike
                    if cp == "C":
                        mono = b.bid - a.ask - 2 * fee          # düşük strike call, yüksek strike'tan ucuz
                        width_arb = a.bid - b.ask - w - 2 * fee  # call spread genişlikten pahalı
                    else:
                        mono = a.bid - b.ask - 2 * fee           # yüksek strike put, düşük strike'tan ucuz
                        width_arb = b.bid - a.ask - w - 2 * fee
                    if mono > min_profit:
                        buy, sell = (a, b) if cp == "C" else (b, a)
                        out.append({
                            "type": "monotonicity", "title": L("Monotonluk ihlali", "Monotonicity violation"), "expiry": exp.isoformat(),
                            "dte": chain.dte(exp), "strike": a.strike, "strike2": b.strike,
                            "profit": round(mono, 4), "profit_total": round(mono * 100, 2),
                            "legs": [f"{buy.strike:g} {'CALL' if cp == 'C' else 'PUT'} {L("al", "buy")} @ {buy.ask}",
                                     f"{sell.strike:g} {'CALL' if cp == 'C' else 'PUT'} sat @ {sell.bid}"],
                            "quality": _quality(a, b), "note": L("Daha değerli olması gereken opsiyon daha ucuz; kredi alırsınız ve kayıp imkânsız.", "The option that should be worth more is cheaper; you receive a credit and cannot lose."),
                        })
                    if width_arb > min_profit:
                        out.append({
                            "type": "width", "title": L("Spread genişlik ihlali", "Spread width violation"), "expiry": exp.isoformat(),
                            "dte": chain.dte(exp), "strike": a.strike, "strike2": b.strike,
                            "profit": round(width_arb, 4), "profit_total": round(width_arb * 100, 2),
                            "legs": [L("Kredi spread'i aç", "Open the credit spread"), L(f"Alınan kredi > genişlik ({w:g})", f"Credit > width ({w:g})")],
                            "quality": _quality(a, b), "note": L("Maksimum kayıptan fazla kredi.", "Credit exceeds the maximum loss."),
                        })
    return out


def butterflies(chain: Chain, fee: float, min_profit: float) -> list[dict]:
    out = []
    for exp in chain.expiries:
        for cp in ("C", "P"):
            opts = {o.strike: o for o in chain.by_exp[exp][cp] if _ok(o)}
            ks = sorted(opts)
            for i in range(1, len(ks) - 1):
                k2 = ks[i]
                for step_i in range(1, 4):
                    if i - step_i < 0:
                        break
                    k1 = ks[i - step_i]
                    k3 = k2 + (k2 - k1)
                    if k3 not in opts:
                        continue
                    a, b, c = opts[k1], opts[k2], opts[k3]
                    profit = 2 * b.bid - a.ask - c.ask - 4 * fee
                    if profit > min_profit:
                        out.append({
                            "type": "butterfly", "title": L("Kelebek (konvekslik) ihlali", "Butterfly (convexity) violation"), "expiry": exp.isoformat(),
                            "dte": chain.dte(exp), "strike": k1, "strike2": k2, "strike3": k3,
                            "profit": round(profit, 4), "profit_total": round(profit * 100, 2),
                            "legs": [f"{k1:g} {L("al", "buy")}", f"2× {k2:g} {L("sat", "sell")}", f"{k3:g} {L("al", "buy")}"],
                            "quality": _quality(a, b, c), "note": L("Kelebek kredi ile açılıyor; vade sonu değeri asla negatif olamaz.", "The butterfly opens for a credit; its expiry value can never be negative."),
                        })
    return out


def calendars(chain: Chain, fee: float, min_profit: float) -> list[dict]:
    out = []
    if chain.security_type == "index":
        return out  # Avrupa tipi endeks opsiyonlarında faiz etkisiyle meşru ihlaller olabilir
    for cp in ("C", "P"):
        by_strike: dict[float, list[Opt]] = {}
        for o in chain.options:
            if o.cp == cp and _ok(o) and o.delta is not None and abs(o.delta) < 0.85:
                by_strike.setdefault(o.strike, []).append(o)
        for k, opts in by_strike.items():
            opts.sort(key=lambda o: o.expiry)
            for near, far in zip(opts[:-1], opts[1:]):
                profit = near.bid - far.ask - 2 * fee
                if profit > min_profit:
                    out.append({
                        "type": "calendar", "title": L("Takvim ihlali", "Calendar violation"), "expiry": near.expiry.isoformat(),
                        "expiry2": far.expiry.isoformat(), "dte": chain.dte(near.expiry), "strike": k,
                        "profit": round(profit, 4), "profit_total": round(profit * 100, 2),
                        "legs": [f"{near.expiry:%d.%m} {k:g} {cp} {L("sat", "sell")} @ {near.bid}", f"{far.expiry:%d.%m} {k:g} {cp} {L("al", "buy")} @ {far.ask}"],
                        "quality": _quality(near, far), "note": L("Uzun vadeli Amerikan opsiyon, kısa vadeliden ucuz olamaz.", "A longer-dated American option cannot be cheaper than a shorter one."),
                    })
    return out


def intrinsic(chain: Chain, fee: float, min_profit: float) -> list[dict]:
    out = []
    if chain.security_type == "index" or not market_is_open():
        return out
    s_bid = chain.bid or chain.spot
    s_ask = chain.ask or chain.spot
    for o in chain.options:
        if not (o.ask > 0 and o.ask_size > 0):
            continue
        if o.cp == "C":
            gain = s_bid - o.strike - o.ask - fee
        else:
            gain = o.strike - s_ask - o.ask - fee
        if gain > min_profit:
            out.append({
                "type": "intrinsic", "title": L("İçsel değerin altında", "Below intrinsic value"), "expiry": o.expiry.isoformat(),
                "dte": chain.dte(o.expiry), "strike": o.strike, "profit": round(gain, 4),
                "profit_total": round(gain * 100, 2),
                "legs": [f"{o.strike:g} {'CALL' if o.cp == 'C' else 'PUT'} {L("al", "buy")} @ {o.ask}", L("Hemen kullan (exercise) + hisse ile kapat", "Exercise now and close with stock")],
                "quality": _quality(o), "note": L("Amerikan tipi opsiyon içsel değerinin altında satılıyor.", "An American option is trading below its intrinsic value."),
            })
    return out


def smile_outliers(chain: Chain, min_rel: float = 0.02) -> list[dict]:
    """Aynı vadedeki eğriye göre IV'si göreli olarak ≥%2 sapan likit kontratlar.

    'executable': pahalıysa bid > adil değer, ucuzsa ask < adil değer (spread'e rağmen avantaj var).
    """
    out = []
    fit = SmileFit(chain)
    for exp in chain.expiries:
        dte = chain.dte(exp)
        if dte < 4:
            continue  # vadesi çok yakın kontratlarda IV gürültülüdür
        T = chain.T(exp)
        for o in chain.by_exp[exp]["C"] + chain.by_exp[exp]["P"]:
            if not o.valid_iv or o.delta is None or not o.has_market:
                continue
            if not 0.08 <= abs(o.delta) <= 0.6 or o.oi < 100 or o.spread_pct > 0.15:
                continue
            # Eğri OTM kontratlardan kurulduğu için sadece OTM kontratları karşılaştır
            # (ITM Amerikan opsiyonların IV'sinde erken kullanım primi vardır)
            if (o.cp == "P" and o.strike > chain.spot) or (o.cp == "C" and o.strike < chain.spot):
                continue
            resid = fit.residual(exp, o.strike, o.iv)
            if resid is None:
                continue
            fitted = o.iv - resid  # type: ignore[operator]
            rel = resid / fitted if fitted > 0 else 0
            if abs(rel) < min_rel or abs(resid) < 0.004:
                continue
            fair = bs.price(chain.spot, o.strike, T, chain.r, fitted, o.cp)
            rich = resid > 0
            exec_edge = (o.bid - fair) if rich else (fair - o.ask)
            out.append({
                "type": "smile", "title": L("Pahalı", "Rich") if rich else L("Ucuz", "Cheap"), "expiry": exp.isoformat(), "dte": dte,
                "strike": o.strike, "cp": o.cp, "iv": o.iv, "fitted_iv": round(fitted, 4), "resid": round(resid, 4),
                "rel": round(rel, 4), "mid": round(o.mid, 4), "fair": round(fair, 4),
                "diff_total": round((o.mid - fair) * 100, 2), "exec_edge": round(exec_edge * 100, 2),
                "executable": exec_edge > 0.01,
                "delta": o.delta, "oi": o.oi, "volume": o.volume, "spread_pct": round(o.spread_pct, 4),
                "action": L("Satış adayı (komşularına göre pahalı)", "Sell candidate (rich vs neighbors)") if rich else L("Alış adayı (komşularına göre ucuz)", "Buy candidate (cheap vs neighbors)"),
            })
    out.sort(key=lambda x: (x["executable"], abs(x["rel"])), reverse=True)
    return out[:40]


def scan(chain: Chain, fee_per_contract: float = 0.65, min_profit: float = 0.03) -> dict:
    fee = fee_per_contract / 100.0  # hisse başına
    box_arbs, box_rates = boxes(chain, fee, min_profit)
    arbs = (parity(chain, fee, min_profit) + box_arbs + verticals(chain, fee, min_profit)
            + butterflies(chain, fee, min_profit) + calendars(chain, fee, min_profit)
            + intrinsic(chain, fee, min_profit))
    arbs.sort(key=lambda x: x["profit_total"], reverse=True)
    return {
        "ticker": chain.sym, "spot": chain.spot, "rate": chain.r, "as_of": chain.as_of.isoformat(),
        "is_index": chain.security_type == "index",
        "stock_checks": market_is_open() and chain.security_type != "index",
        "arbitrage": arbs[:60],
        "box_rates": box_rates,
        "smile": smile_outliers(chain),
    }
