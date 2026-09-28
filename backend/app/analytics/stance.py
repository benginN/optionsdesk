"""Strateji pusulası: piyasanın bugünkü durumuna göre hangi opsiyon stratejisi türü öne çıkıyor.

Belirlenimci kurallar: aynı veriye her zaman aynı cevap, her kararın gerekçesi yazılı. Girdiler:
  trend        SPY'nin 50/200 günlük ortalamaya göre yeri + 20 günlük getirisi
  korku        VIX seviyesi ve son bir yıldaki yüzdeliği
  stres        VIX vade yapısı (VIX/VIX3M) ve VIX'in 5 günlük değişimi
  primler      evren medyanı IV/HV (volatilite risk primi)
  gamma        SPY dealer gamma'sı (GEX işareti) ve gamma dönüş noktası
  ileriye      vade yapısının eğimi, beklenen hareketler, yaklaşan bilançolar

Yatırım tavsiyesi değildir: piyasa rejimini sınıflandırıp her rejimde genelde uyan strateji türünü
ve ayarlarını gösteren bir çerçevedir.
"""
from __future__ import annotations

import math
from datetime import date

from ..i18n import L, lang_var
from . import history as H

# Eşikler tek yerde; "görüş ne zaman değişir" satırları da bunlardan üretilir.
TS_STRESS = 1.00        # VIX/VIX3M ≥ 1: vade yapısı ters döndü (kısa vade korkusu > uzun vade)
TS_TENSE = 0.95         # 0,95–1,00: gerginleşiyor
VIX_SPIKE_5D = 0.25     # VIX 5 işlem gününde ≥ +%25: ani korku
VIX_PCT_LOW = 30        # yıllık yüzdelik < 30: opsiyonlar geçmişine göre ucuz
VIX_PCT_HIGH = 80       # yıllık yüzdelik ≥ 80: korku yüksek
VIX_OFF_PEAK = 0.85     # VIX son 10 günün zirvesinin ≤ %85'inde: korku geri çekiliyor
VRP_RICH = 1.20         # evren medyanı IV/HV ≥ 1,20: primler zengin
VRP_THIN = 1.05         # < 1,05: primler ince
VRP_LEAPS = 1.15        # LEAPS için "opsiyonlar pahalı değil" sınırı

STANCES = ("sell_easy", "sell_careful", "buy_leaps", "defense", "post_fear")

# Duruş başına stratejilerin uygunluğu (0-100). Sonra trend ve gamma'ya göre küçük düzeltme yapılır.
FIT = {
    "sell_easy":    {"csp": 85, "cc": 80, "pcs": 70, "leaps": 40},
    "sell_careful": {"csp": 55, "cc": 70, "pcs": 75, "leaps": 55},
    "buy_leaps":    {"csp": 45, "cc": 60, "pcs": 55, "leaps": 85},
    "defense":      {"csp": 15, "cc": 70, "pcs": 35, "leaps": 25},
    "post_fear":    {"csp": 65, "cc": 55, "pcs": 85, "leaps": 60},
}


def _num(x: float | None, d: int = 1) -> str:
    """Dile göre ondalık ayraç (TR: virgül)."""
    if x is None or not math.isfinite(x):
        return "—"
    s = f"{x:,.{d}f}"
    if lang_var.get() == "en":
        return s
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def _pct(x: float | None, d: int = 0, sign: bool = False) -> str:
    if x is None or not math.isfinite(x):
        return "—"
    v = _num(abs(x) * 100, d)
    sg = ("+" if x >= 0 else "−") if sign else ("−" if x < 0 else "")
    return f"{sg}%{v}" if lang_var.get() != "en" else f"{sg}{v}%"


def _range(a: str, b: str) -> str:
    return f"{a}–{b}"


# --- Alt sinyaller --------------------------------------------------------------------------

def trend_state(closes: list[float], last: float | None = None) -> dict:
    """SPY trendi: fiyat 50/200 günlük ortalamaya göre nerede, son 20 günde ne kadar değişti."""
    if len(closes) < 60:
        return {"code": None}
    px = last or closes[-1]
    s50, s200 = H.sma(closes, 50), H.sma(closes, 200)
    ref20 = closes[-20] if len(closes) >= 20 else None
    r20 = px / ref20 - 1 if ref20 else None
    if s200 and px > s200 and s50 and s50 > s200 and (r20 is None or r20 > -0.03):
        code = "up"
    elif s200 and px < s200 and (r20 is None or r20 < 0.02):
        code = "down"
    else:
        code = "side"
    return {"code": code, "price": px, "sma50": s50, "sma200": s200, "ret20": r20}


def vix_state(vix: dict, vix_closes: list[float]) -> dict:
    v, v3 = vix.get("vix"), vix.get("vix3m")
    ts = v / v3 if v and v3 else None
    ref5 = vix_closes[-5] if len(vix_closes) >= 5 else None
    chg5 = v / ref5 - 1 if v and ref5 else None
    peak10 = max(vix_closes[-10:] + ([v] if v else [])) if vix_closes else None
    off_peak = v / peak10 if v and peak10 else None
    return {"vix": v, "vix3m": v3, "vix6m": vix.get("vix6m"), "pct": vix.get("vix_pct"), "ts": ts,
            "chg5": chg5, "peak10": peak10, "off_peak": off_peak}


# --- Karar -----------------------------------------------------------------------------------

def decide(tr: dict, vx: dict, vrp: float | None, gamma_pos: bool | None) -> tuple[str, list[str]]:
    """Duruşu seçer. Kurallar yukarıdan aşağı denenir; ilk tutan kazanır. Dönen ikinci değer: tetikleyen kural kodları."""
    ts, pct, chg5, off = vx.get("ts"), vx.get("pct"), vx.get("chg5"), vx.get("off_peak")
    trend = tr.get("code")
    stress = ts is not None and ts >= TS_STRESS
    spiking = chg5 is not None and chg5 >= VIX_SPIKE_5D and not (off is not None and off <= VIX_OFF_PEAK)
    high = pct is not None and pct >= VIX_PCT_HIGH
    receding = off is not None and off <= VIX_OFF_PEAK

    if high and receding and ts is not None and ts < TS_TENSE:
        return "post_fear", ["vix_high", "vix_receding", "ts_normal"]
    if stress:
        return "defense", ["ts_inverted"]
    if spiking:
        return "defense", ["vix_spike"]
    if trend == "down" and pct is not None and pct >= 50:
        return "defense", ["trend_down", "vix_elevated"]
    if (pct is not None and pct < VIX_PCT_LOW and (vrp is None or vrp < VRP_LEAPS) and trend == "up"):
        return "buy_leaps", ["vix_low", "vrp_not_rich", "trend_up"]
    if (vrp is not None and vrp >= VRP_RICH and ts is not None and ts < TS_TENSE and gamma_pos and trend != "down"):
        return "sell_easy", ["vrp_rich", "ts_normal", "gamma_pos"]
    return "sell_careful", ["default"]


def _meta(code: str) -> dict:
    return {
        "sell_easy": {
            "emoji": "✅", "label": L("Rahat prim satışı", "Comfortable premium selling"),
            "summary": L("Primler zengin, piyasa sakin ve dealer'lar hareketleri yastıklıyor: prim satıcısı için elverişli bir ortam.",
                         "Premiums are rich, the market is calm and dealers dampen moves: a friendly backdrop for premium sellers."),
            "params": [(L("Delta", "Delta"), _range(_num(0.25, 2), _num(0.30, 2))), (L("Vade", "Expiry"), L("7–21 gün", "7–21 days")),
                       (L("Yapı", "Structure"), L("Nakitle put / covered call", "Cash-secured put / covered call")),
                       (L("Büyüklük", "Size"), L("Normal", "Normal"))],
            "panel": L("0,25–0,30 delta · 7–21 gün · put / covered call", "0.25–0.30 delta · 7–21 days · put / covered call"),
        },
        "sell_careful": {
            "emoji": "🧭", "label": L("Temkinli prim satışı", "Careful premium selling"),
            "summary": L("Prim satmak mümkün ama ortam tek yönlü elverişli değil: strike'ı uzak tut, vadeyi uzat, riski tanımla.",
                         "Selling premium works, but conditions aren't clearly favorable: keep strikes far, go longer, define the risk."),
            "params": [(L("Delta", "Delta"), _range(_num(0.15, 2), _num(0.20, 2))), (L("Vade", "Expiry"), L("30–45 gün", "30–45 days")),
                       (L("Yapı", "Structure"), L("Put kredi spread; çıplak put yalnız sahip olmak istediğin hissede", "Put credit spread; naked puts only on stocks you'd own")),
                       (L("Büyüklük", "Size"), L("Yarım", "Half"))],
            "panel": L("0,15–0,20 delta · 30–45 gün · spread", "0.15–0.20 delta · 30–45 days · spread"),
        },
        "buy_leaps": {
            "emoji": "🚀", "label": L("Opsiyon al (LEAPS)", "Buy options (LEAPS)"),
            "summary": L("Opsiyonlar son bir yıla göre ucuz ve trend yukarı: uzun vadeli call almak görece avantajlı. Prim satacaksan temkinli ayarlarla.",
                         "Options are cheap versus the past year and the trend is up: long-dated calls are relatively attractive. If you sell premium, use careful settings."),
            "params": [(L("Delta", "Delta"), _range(_num(0.70, 2), _num(0.80, 2))), (L("Vade", "Expiry"), L("12+ ay", "12+ months")),
                       (L("Yapı", "Structure"), L("Derin ITM call (LEAPS); prim satışında 0,15–0,20 delta", "Deep ITM call (LEAPS); 0.15–0.20 delta when selling")),
                       (L("Büyüklük", "Size"), L("Kademeli giriş", "Scale in"))],
            "panel": L("LEAPS 0,70–0,80 delta · 12+ ay · satışta 0,15–0,20", "LEAPS 0.70–0.80 delta · 12+ months · sell at 0.15–0.20"),
        },
        "defense": {
            "emoji": "🛡️", "label": L("Savunma", "Defense"),
            "summary": L("Stres işaretleri var: yeni çıplak put açma, elindekini koru, nakit tut. Korku zirve yapıp geri çekilince fırsat doğar.",
                         "Stress signals are on: don't open new naked puts, protect what you hold, keep cash. Opportunity comes once fear peaks and recedes."),
            "params": [(L("Yeni put", "New puts"), L("Açma", "Don't open")), (L("Elindeki hisse", "Shares you hold"), L("Covered call / koruyucu put", "Covered call / protective put")),
                       (L("Yapı", "Structure"), L("Satacaksan yalnız çok uzak, tanımlı riskli spread", "If selling, only far-away, defined-risk spreads")),
                       (L("Büyüklük", "Size"), L("Küçült, nakit tut", "Reduce, hold cash"))],
            "panel": L("yeni çıplak put yok · covered call · nakit", "no new naked puts · covered calls · cash"),
        },
        "post_fear": {
            "emoji": "🌤️", "label": L("Korku sonrası fırsat", "Post-fear opportunity"),
            "summary": L("Korku yüksek ama geri çekiliyor ve vade yapısı normale döndü: primler zengin, prim satıcısı için tarihsel olarak en verimli dönemlerden.",
                         "Fear is high but receding and the term structure has normalized: premiums are rich, historically one of the best windows for sellers."),
            "params": [(L("Delta", "Delta"), _range(_num(0.15, 2), _num(0.20, 2))), (L("Vade", "Expiry"), L("30–45 gün", "30–45 days")),
                       (L("Yapı", "Structure"), L("Put kredi spread, kademeli giriş", "Put credit spreads, scale in")),
                       (L("Büyüklük", "Size"), L("Yarımdan başla", "Start at half"))],
            "panel": L("0,15–0,20 delta · 30–45 gün · spread, kademeli", "0.15–0.20 delta · 30–45 days · spreads, scale in"),
        },
    }[code]


def _fit(code: str, trend: str | None, gamma_pos: bool | None) -> list[dict]:
    base = dict(FIT[code])
    if trend == "down":
        base["csp"] -= 15
        base["leaps"] -= 15
    elif trend == "up":
        base["leaps"] += 5
        base["csp"] += 5
    if gamma_pos is False:
        base["csp"] -= 10
    names = {"csp": L("Nakitle put sat", "Cash-secured put"), "cc": L("Covered call", "Covered call"),
             "pcs": L("Put kredi spread", "Put credit spread"), "leaps": L("LEAPS al", "Buy LEAPS")}
    return [{"key": k, "label": names[k], "score": max(0, min(100, v))} for k, v in sorted(base.items(), key=lambda kv: -kv[1])]


def _signals(tr: dict, vx: dict, vrp: float | None, iv_pos_med: float | None, g: dict | None, earnings: list[dict]) -> list[dict]:
    out = []
    # Trend
    tc = tr.get("code")
    if tc:
        out.append({
            "key": "trend", "label": L("Trend (SPY)", "Trend (SPY)"),
            "value": {"up": L("Yukarı", "Up"), "down": L("Aşağı", "Down"), "side": L("Yatay / karışık", "Sideways / mixed")}[tc],
            "tone": {"up": "green", "down": "red", "side": "amber"}[tc],
            "text": L(f"SPY {_num(tr['price'], 1)} · 50g ort {_num(tr['sma50'], 1)} · 200g ort {_num(tr['sma200'], 1)} · 20 günde {_pct(tr['ret20'], 1, True)}",
                      f"SPY {_num(tr['price'], 1)} · 50d avg {_num(tr['sma50'], 1)} · 200d avg {_num(tr['sma200'], 1)} · 20 days {_pct(tr['ret20'], 1, True)}"),
        })
    # Korku seviyesi
    if vx.get("vix"):
        p = vx.get("pct")
        tone = "green" if p is not None and p < VIX_PCT_LOW else "red" if p is not None and p >= VIX_PCT_HIGH else "amber"
        lvl = (L("Düşük", "Low") if p is not None and p < VIX_PCT_LOW else L("Yüksek", "High") if p is not None and p >= VIX_PCT_HIGH else L("Orta", "Moderate"))
        out.append({
            "key": "vix", "label": L("Korku (VIX)", "Fear (VIX)"), "value": lvl, "tone": tone,
            "text": L(f"VIX {_num(vx['vix'], 1)} · son bir yıla göre 100 üzerinden {_num(p, 0)}",
                      f"VIX {_num(vx['vix'], 1)} · {_num(p, 0)} out of 100 versus the past year"),
        })
    # Stres
    ts = vx.get("ts")
    if ts:
        tone = "red" if ts >= TS_STRESS else "amber" if ts >= TS_TENSE else "green"
        val = L("Ters (stres)", "Inverted (stress)") if ts >= TS_STRESS else L("Gerginleşiyor", "Tightening") if ts >= TS_TENSE else L("Normal", "Normal")
        chg = vx.get("chg5")
        if chg is not None and chg >= VIX_SPIKE_5D:
            tone, val = "red", L("Ani korku", "Fear spike")
        out.append({
            "key": "stress", "label": L("Stres (vade yapısı)", "Stress (term structure)"), "value": val, "tone": tone,
            "text": L(f"VIX/VIX3M {_num(ts, 2)} (1'in üstü ters) · VIX 5 günde {_pct(chg, 0, True)}",
                      f"VIX/VIX3M {_num(ts, 2)} (above 1 = inverted) · VIX {_pct(chg, 0, True)} in 5 days"),
        })
    # Primler
    if vrp:
        tone = "green" if vrp >= VRP_RICH else "amber" if vrp < VRP_THIN else None
        val = L("Zengin", "Rich") if vrp >= VRP_RICH else L("İnce", "Thin") if vrp < VRP_THIN else L("Orta", "Fair")
        out.append({
            "key": "premium", "label": L("Primler (IV/HV)", "Premiums (IV/HV)"), "value": val, "tone": tone,
            "text": L(f"Opsiyonların fiyatladığı oynaklık gerçekleşenin {_num(vrp, 2)} katı · IV Pos medyanı {_num(iv_pos_med, 0)}",
                      f"Implied volatility is {_num(vrp, 2)}× realized · median IV Pos {_num(iv_pos_med, 0)}"),
        })
    # Gamma
    if g and g.get("gex_total") is not None:
        pos = g["gex_total"] > 0
        flip = g.get("gex_flip")
        out.append({
            "key": "gamma", "label": L("Dealer gamma (SPY)", "Dealer gamma (SPY)"),
            "value": L("Pozitif", "Positive") if pos else L("Negatif", "Negative"), "tone": "green" if pos else "amber",
            "text": (L("Dealer'lar hareketleri yastıklıyor (sakinleştirici)", "Dealers dampen moves (calming)") if pos
                     else L("Dealer'lar hareketleri büyütebilir (sert günler olası)", "Dealers may amplify moves (choppy days likely)"))
                    + (L(f" · dönüş noktası {_num(flip, 1)}", f" · flip level {_num(flip, 1)}") if flip else ""),
        })
    # Bilançolar
    names = [e["ticker"] for e in earnings[:6]]
    out.append({
        "key": "earnings", "label": L("Bilançolar (7 gün)", "Earnings (7 days)"),
        "value": str(len(earnings)), "tone": "amber" if earnings else None,
        "text": (L("Bu hisselerde vadeyi bilançonun öncesine koy ya da uzak dur: ", "Keep expiries before these reports or stay away: ") + ", ".join(names))
                if names else L("Evrende yaklaşan bilanço yok.", "No upcoming earnings in the universe."),
    })
    return out


def _outlook(vx: dict, em_week: dict | None, earnings: list[dict]) -> list[str]:
    out = []
    if em_week and em_week.get("move_pct"):
        out.append(L(f"Opsiyonlar SPY için bu hafta ±{_pct(em_week['move_pct'], 1)} hareket fiyatlıyor ({_num(em_week.get('low'), 0)}–{_num(em_week.get('high'), 0)}).",
                     f"Options price a ±{_pct(em_week['move_pct'], 1)} move for SPY this week ({_num(em_week.get('low'), 0)}–{_num(em_week.get('high'), 0)})."))
    v, v3, v6 = vx.get("vix"), vx.get("vix3m"), vx.get("vix6m")
    if v:
        m30 = v / 100 / math.sqrt(12)
        out.append(L(f"Önümüzdeki 30 günde S&P 500 için tipik (1σ) hareket ~±%{_num(m30 * 100, 1)} (VIX {_num(v, 1)} ÷ √12).",
                     f"Typical (1σ) S&P 500 move over the next 30 days: ~±{_num(m30 * 100, 1)}% (VIX {_num(v, 1)} ÷ √12)."))
    if v and v3:
        if v3 > v:
            out.append(L(f"Vade yapısı yukarı eğimli (VIX {_num(v, 1)} → 3 ay {_num(v3, 1)}" + (f" → 6 ay {_num(v6, 1)}" if v6 else "") + "): piyasa ileride bugünden daha fazla oynaklık fiyatlıyor — olağan durum.",
                         f"Term structure slopes up (VIX {_num(v, 1)} → 3m {_num(v3, 1)}" + (f" → 6m {_num(v6, 1)}" if v6 else "") + "): the market prices more volatility later than now — the normal state."))
        else:
            out.append(L(f"Vade yapısı ters (VIX {_num(v, 1)} ≥ 3 ay {_num(v3, 1)}): kısa vadeli korku uzun vadeliden büyük — stres dönemi.",
                         f"Term structure is inverted (VIX {_num(v, 1)} ≥ 3m {_num(v3, 1)}): near-term fear exceeds long-term — a stress period."))
    if earnings:
        out.append(L(f"7 gün içinde {len(earnings)} bilanço var; bu hisselerde beklenen hareket büyür.",
                     f"{len(earnings)} earnings reports within 7 days; expected moves are larger in those names."))
    out.append(L("Makro takvim (Fed, enflasyon verisi) bu hesaba dahil değil; o haftalarda oynaklık artabilir.",
                 "The macro calendar (Fed, inflation data) isn't included here; volatility can rise in those weeks."))
    return out


def _triggers(code: str, tr: dict, vx: dict, vrp: float | None, gamma_pos: bool | None) -> list[str]:
    ts, chg5, pct = vx.get("ts"), vx.get("chg5"), vx.get("pct")
    now = L("şu an", "now")
    gtxt = L("pozitif", "positive") if gamma_pos else L("bilinmiyor", "unknown") if gamma_pos is None else L("negatif", "negative")
    t_def = L(f"VIX/VIX3M {_num(TS_STRESS, 2)}'ı geçerse → Savunma ({now} {_num(ts, 2)})",
              f"VIX/VIX3M above {_num(TS_STRESS, 2)} → Defense ({now} {_num(ts, 2)})")
    t_spike = L(f"VIX 5 günde {_pct(VIX_SPIKE_5D, 0, True)} yükselirse → Savunma ({now} {_pct(chg5, 0, True)})",
                f"VIX up {_pct(VIX_SPIKE_5D, 0, True)} in 5 days → Defense ({now} {_pct(chg5, 0, True)})")
    t_trend = L(f"SPY 200 günlük ortalamanın ({_num(tr.get('sma200'), 1)}) altına inerse → trend aşağı ({now} {_num(tr.get('price'), 1)})",
                f"SPY below its 200-day average ({_num(tr.get('sma200'), 1)}) → downtrend ({now} {_num(tr.get('price'), 1)})")
    t_easy = L(f"IV/HV {_num(VRP_RICH, 2)}'yi geçer, VIX/VIX3M {_num(TS_TENSE, 2)} altında kalır ve gamma pozitife dönerse → Rahat prim satışı ({now} {_num(vrp, 2)} · {gtxt})",
               f"IV/HV above {_num(VRP_RICH, 2)}, VIX/VIX3M below {_num(TS_TENSE, 2)} and gamma turns positive → Comfortable premium selling ({now} {_num(vrp, 2)} · {gtxt})")
    t_leaps_off = L(f"VIX yüzdeliği {VIX_PCT_LOW}'u ya da IV/HV {_num(VRP_LEAPS, 2)}'i geçerse → LEAPS avantajı azalır ({now} {_num(pct, 0)} · {_num(vrp, 2)})",
                    f"VIX percentile above {VIX_PCT_LOW} or IV/HV above {_num(VRP_LEAPS, 2)} → the LEAPS edge fades ({now} {_num(pct, 0)} · {_num(vrp, 2)})")
    t_post = L(f"VIX/VIX3M {_num(TS_TENSE, 2)} altına iner ve VIX 10 günlük zirvesinden %15 geri çekilirse → Korku sonrası fırsat",
               f"VIX/VIX3M back below {_num(TS_TENSE, 2)} and VIX 15% off its 10-day peak → Post-fear opportunity")
    return {
        "sell_easy": [t_def, t_spike, t_trend],
        "sell_careful": [t_def, t_easy, t_trend],
        "buy_leaps": [t_leaps_off, t_def, t_trend],
        "defense": [t_post, t_trend],
        "post_fear": [t_def, t_spike],
    }[code]


def build(spy_rows: list[dict], spy_last: float | None, vix: dict, vix_rows: list[dict], agg: dict | None,
          iv_pos_med: float | None, board: dict | None, earnings: list[dict], today: date | None = None) -> dict:
    """Pusulayı üretir. `vix_rows`/`spy_rows` günlük geçmiş; bugünün (yarım) satırı hesaba katılmaz."""
    today = today or date.today()
    spy_closes = [r["close"] for r in spy_rows if r.get("close") and r["date"] < today.isoformat()]
    vix_closes = [r["close"] for r in vix_rows if r.get("close") and r["date"] < today.isoformat()]
    tr = trend_state(spy_closes, spy_last)
    vx = vix_state(vix or {}, vix_closes)
    vrp = (agg or {}).get("vrp")
    gamma_pos = (board["gex_total"] > 0) if board and board.get("gex_total") is not None else None
    code, rules = decide(tr, vx, vrp, gamma_pos)
    meta = _meta(code)
    trend_note = None
    if code in ("sell_careful", "sell_easy") and tr.get("code") == "down":
        trend_note = L("Trend aşağı: put tarafında strike'ı daha da uzak tut, covered call'a ağırlık ver.",
                       "Downtrend: keep put strikes even further away and lean on covered calls.")
    panel = f"{meta['label']} · {meta['panel']}"
    return {
        "code": code, "emoji": meta["emoji"], "label": meta["label"], "summary": meta["summary"],
        "trend_note": trend_note, "rules": rules,
        "params": [{"k": k, "v": v} for k, v in meta["params"]],
        "panel": panel,
        "fit": _fit(code, tr.get("code"), gamma_pos),
        "signals": _signals(tr, vx, vrp, iv_pos_med, board, earnings),
        "outlook": _outlook(vx, (board or {}).get("em_week"), earnings),
        "triggers": _triggers(code, tr, vx, vrp, gamma_pos),
        "inputs": {"trend": tr, "vix": vx, "vrp": vrp, "iv_pos_median": iv_pos_med, "gamma_pos": gamma_pos,
                   "gex_total": (board or {}).get("gex_total"), "gex_flip": (board or {}).get("gex_flip")},
        "disclaimer": L("Kurallara dayalı bir çerçeve, yatırım tavsiyesi değil. Karar ve risk senin.",
                        "A rules-based framework, not investment advice. The decision and the risk are yours."),
    }
