"""Piyasa geneli opsiyon notu: evren toplamı, VIX vade yapısı ve otomatik Türkçe yorum."""
from __future__ import annotations

import statistics

from ..i18n import L
from . import history as H


def _med(vals):
    v = [x for x in vals if x is not None]
    return statistics.median(v) if v else None


def _sum(vals):
    return sum(x for x in vals if x is not None)


def aggregate(metrics: list[dict]) -> dict:
    """Evrendeki tüm hisselerin metriklerinden piyasa geneli özet."""
    ms = [m for m in metrics if m]
    if not ms:
        return {}
    put_oi = _sum(m.get("put_oi") for m in ms)
    call_oi = _sum(m.get("call_oi") for m in ms)
    put_vol = _sum(m.get("put_vol") for m in ms)
    call_vol = _sum(m.get("call_vol") for m in ms)
    changes = [m.get("change_pct") for m in ms if m.get("change_pct") is not None]
    return {
        "n": len(ms),
        "iv30": _med(m.get("iv30") for m in ms),
        "iv1y": _med(m.get("iv1y") for m in ms),
        "hv30": _med(m.get("hv30") for m in ms),
        "vrp": _med(m.get("vrp") for m in ms),
        "skew": _med(m.get("skew") for m in ms),
        "change": _med(changes),
        "breadth_up": sum(1 for c in changes if c > 0) / len(changes) if changes else None,
        "put_oi": put_oi,
        "call_oi": call_oi,
        "pcr_oi": put_oi / call_oi if call_oi else None,
        "put_vol": put_vol,
        "call_vol": call_vol,
        "pcr_vol": put_vol / call_vol if call_vol else None,
        "em30": _med(m.get("em30_pct") for m in ms),
        "rsi_oversold": sum(1 for m in ms if (m.get("rsi14") or 50) <= 30),
        "rsi_overbought": sum(1 for m in ms if (m.get("rsi14") or 50) >= 70),
        "iv_gt_hv": sum(1 for m in ms if m.get("vrp") and m["vrp"] > 1) / len(ms),
    }


def _chg(a, b):
    if a is None or b is None or a == 0:
        return None
    return b / a - 1


def _dir(x, eps):
    if x is None:
        return 0
    return 1 if x > eps else (-1 if x < -eps else 0)


def pct_txt(x: float, d: int = 1) -> str:
    """Dile göre yüzde yazımı: TR '%2,1' · EN '2.1%'."""
    v = f"{abs(x) * 100:.{d}f}"
    return L(f"%{v.replace('.', ',')}", f"{v}%")


def build_note(cur: dict, prev: dict | None, vix: dict | None = None) -> dict:
    """Önceki ve güncel snapshot toplamından 'Günün Opsiyon Notu' üretir (uzman görünümü)."""
    rows = []
    spec = [
        ("iv30", "IV30", "vol"), ("iv1y", "IV1Y", "vol"), ("hv30", "HV30", "vol"),
        ("vrp", "IV/HV", "ratio"), ("skew", "Skew", "ratio"), ("pcr_oi", "Put/Call OI", "ratio"),
        ("put_oi", "Put OI", "int"), ("call_oi", "Call OI", "int"),
    ]
    for key, label, kind in spec:
        b, a = (prev or {}).get(key), cur.get(key)
        rows.append({"key": key, "label": label, "kind": kind, "before": b, "after": a, "change": _chg(b, a)})

    price_ch = cur.get("change")
    d_iv = _chg((prev or {}).get("iv30"), cur.get("iv30"))
    d_skew = _chg((prev or {}).get("skew"), cur.get("skew"))
    d_put = _chg((prev or {}).get("put_oi"), cur.get("put_oi"))
    vrp = cur.get("vrp")

    p_dir = _dir(price_ch, 0.004)
    iv_dir = _dir(d_iv, 0.01)
    sk_dir = _dir(d_skew, 0.05)

    sentences = []
    parts = []
    if price_ch is not None:
        if p_dir < 0:
            parts.append(L(f"Fiyatlar **{pct_txt(price_ch)} düşerken**", f"While prices **fell {pct_txt(price_ch)}**"))
        elif p_dir > 0:
            parts.append(L(f"Fiyatlar **{pct_txt(price_ch)} yükselirken**", f"While prices **rose {pct_txt(price_ch)}**"))
        else:
            parts.append(L("Fiyatlar yatay seyrederken", "While prices moved sideways"))
    if d_iv is not None:
        parts.append({1: L("IV yükselmiş", "IV rose"), -1: L("IV gerilemiş", "IV fell"), 0: L("IV sabit kalmış", "IV held steady")}[iv_dir])
    if d_skew is not None and sk_dir != 0:
        parts.append(L(f"skew **{pct_txt(d_skew)} {'artmış' if sk_dir > 0 else 'azalmış'}**",
                       f"skew **{'rose' if sk_dir > 0 else 'fell'} {pct_txt(d_skew)}**"))
    if len(parts) > 1:
        sentences.append(", ".join(parts) + ".")
    elif parts and price_ch is not None:
        if p_dir:
            sentences.append(L(f"Fiyatlar medyanda **{pct_txt(price_ch)} {'düştü' if p_dir < 0 else 'yükseldi'}**.",
                               f"The median stock **{'fell' if p_dir < 0 else 'rose'} {pct_txt(price_ch)}**."))
        else:
            sentences.append(L("Fiyatlar yatay seyretti.", "Prices moved sideways."))

    if prev:
        if p_dir < 0 and iv_dir > 0:
            headline = (L("PUT tarafına talep gelmiş.", "Demand is flowing into puts.")
                        if sk_dir >= 0 or (d_put or 0) > 0 else L("Korku fiyatlanıyor.", "Fear is being priced in."))
        elif p_dir < 0 and iv_dir == 0:
            headline = (L("Piyasa aşağı yönde tedirgin.", "The market is nervous about the downside.")
                        if sk_dir > 0 else L("Düşüş sakin karşılanıyor.", "The dip is being taken calmly."))
        elif p_dir < 0 and iv_dir < 0:
            headline = L("Düşüşe rağmen korku fiyatlanmıyor.", "Despite the drop, fear isn't being priced.")
        elif p_dir > 0 and iv_dir < 0:
            headline = L("Rahatlama: risk primi eriyor.", "Relief: the risk premium is melting.")
        elif p_dir > 0 and iv_dir > 0:
            headline = L("Yükselişe volatilite eşlik ediyor; CALL tarafında iştah var.", "Volatility is rising with prices; there's appetite for calls.")
        elif iv_dir > 0:
            headline = L("Fiyat yerinde sayarken volatilite artıyor; bir olay bekleniyor olabilir.", "Volatility is rising while prices stall; an event may be expected.")
        elif iv_dir < 0:
            headline = L("Volatilite sönümleniyor; primler incelmeye başladı.", "Volatility is fading; premiums are getting thinner.")
        else:
            headline = L("Yatay seyir: zaman değeri satıcıların lehine işliyor.", "Sideways market: time decay is working for sellers.")
    else:
        headline = L("İlk kayıt: karşılaştırma için bir sonraki kapanış bekleniyor.", "First record: waiting for the next close to compare.")

    tone = "notr"
    conclusion = ""
    if vrp is not None:
        if vrp >= 1.15:
            conclusion = L("Opsiyonlar gerçekleşen oynaklığa göre pahalı fiyatlanmış. Prim toplayan satıcılar lehine elverişli bir fiyatlama var.",
                           "Options are priced rich versus realized volatility. Conditions favor premium sellers.")
            tone = "satici"
        elif vrp <= 0.95:
            conclusion = L("Opsiyonlar gerçekleşen oynaklığa göre ucuz. Satıcı için risk/ödül zayıf; uzun vadeli alımlar için daha uygun ortam.",
                           "Options are cheap versus realized volatility. Risk/reward is weak for sellers; better conditions for longer-dated buying.")
            tone = "alici"
        else:
            conclusion = L("Fiyatlama dengeli; kontrat seçiminde seçici olmak gerekiyor.", "Pricing is balanced; be selective with contracts.")
        if p_dir < 0 and iv_dir == 0 and vrp >= 1.0:
            conclusion += L(" Fiyat gerilerken IV sabit kaldığı için aynı primi daha aşağıdaki strike'lardan toplamak mümkün.",
                            " With prices lower and IV unchanged, the same premium is available at lower strikes.")

    vix_note = None
    if vix and vix.get("vix"):
        v, v9, v3 = vix.get("vix"), vix.get("vix9d"), vix.get("vix3m")
        bits = []
        if v3:
            ratio = v / v3
            if ratio >= 1.0:
                bits.append(L(f"VIX vade yapısı ters (VIX/VIX3M = {ratio:.2f}): kısa vadeli stres yüksek.",
                              f"VIX term structure is inverted (VIX/VIX3M = {ratio:.2f}): short-term stress is high."))
            elif ratio <= 0.9:
                bits.append(L(f"VIX vade yapısı normal (VIX/VIX3M = {ratio:.2f}): piyasa sakin.",
                              f"VIX term structure is normal (VIX/VIX3M = {ratio:.2f}): the market is calm."))
            else:
                bits.append(L(f"VIX vade yapısı düzleşiyor (VIX/VIX3M = {ratio:.2f}).", f"VIX term structure is flattening (VIX/VIX3M = {ratio:.2f})."))
        if v9 and v and v9 / v > 1.05:
            bits.append(L("VIX9D, VIX'in üstünde: önümüzdeki günlerde bir olay fiyatlanıyor.", "VIX9D is above VIX: an event is priced for the coming days."))
        vix_note = " ".join(bits)

    return {
        "rows": rows, "summary": sentences, "headline": headline, "conclusion": conclusion,
        "tone": tone, "vix_note": vix_note, "price_change": price_ch,
    }


def plain_story(agg: dict, vix: dict | None, iv_pos_med: float | None) -> dict:
    """Yeni başlayanlar için sade dilde piyasa özeti ve iki gösterge (ruh hali, prim ortamı)."""
    vix = vix or {}
    vpct = vix.get("vix_pct")
    ratio = (vix["vix"] / vix["vix3m"]) if vix.get("vix") and vix.get("vix3m") else None

    # Ruh hali: 0 (çok sakin) — 100 (panik)
    if vpct is None:
        mood_score = 50.0
    else:
        mood_score = float(vpct)
        if ratio and ratio >= 1.0:
            mood_score = max(mood_score, 80.0)
    if mood_score < 25:
        mood = ("calm", L("Sakin", "Calm"))
    elif mood_score < 60:
        mood = ("normal", L("Normal", "Normal"))
    elif mood_score < 85:
        mood = ("nervous", L("Tedirgin", "Nervous"))
    else:
        mood = ("fear", L("Korku", "Fearful"))

    # Prim ortamı: satıcı için ne kadar cazip? (IV Pos medyanı + IV/HV)
    vrp = agg.get("vrp")
    parts = []
    if iv_pos_med is not None:
        parts.append(iv_pos_med)
    if vrp is not None:
        parts.append(max(0.0, min(100.0, (vrp - 0.8) / 0.6 * 100)))
    prem_score = sum(parts) / len(parts) if parts else 50.0
    if prem_score >= 62:
        prem = ("rich", L("Zengin", "Rich"))
    elif prem_score >= 40:
        prem = ("fair", L("Orta", "Fair"))
    else:
        prem = ("thin", L("İnce", "Thin"))

    lines = []
    if vix.get("vix"):
        mood_txt = {
            "calm": L("Piyasa sakin", "The market is calm"),
            "normal": L("Piyasada olağan bir tedirginlik var", "The market shows normal caution"),
            "nervous": L("Piyasa tedirgin", "The market is nervous"),
            "fear": L("Piyasada korku hâkim", "Fear dominates the market"),
        }[mood[0]]
        lines.append(L(
            f"{mood_txt}: korku endeksi VIX {vix['vix']:.1f}".replace(".", ",") + f"; son bir yıla göre 100 üzerinden {(vpct or 0):.0f} seviyesinde.",
            f"{mood_txt}: the fear index VIX is at {vix['vix']:.1f}, in the {(vpct or 0):.0f}th percentile of the past year.",
        ))
    lines.append({
        "rich": L("Opsiyonlar pahalı. Prim satanlar (put/call satarak kira toplayanlar) için iyi bir dönem.",
                  "Options are expensive. A good time for premium sellers (those collecting rent by selling puts/calls)."),
        "fair": L("Opsiyon fiyatları normal seviyede. Prim satmak mümkün ama kontrat seçerken seçici ol.",
                  "Option prices are normal. Selling premium works, but be selective."),
        "thin": L("Opsiyonlar ucuz. Prim satarak kazanç her zamankinden düşük; uzun vadeli opsiyon almak için daha uygun bir dönem.",
                  "Options are cheap. Premium income is lower than usual; a better time to buy longer-dated options."),
    }[prem[0]])
    if agg.get("em30"):
        lines.append(L(f"Ortalama bir hisse önümüzdeki 30 günde yaklaşık ±{pct_txt(agg['em30'], 0)} hareket edebilir.",
                       f"A typical stock could move about ±{pct_txt(agg['em30'], 0)} over the next 30 days."))
    return {
        "mood": {"code": mood[0], "label": mood[1], "score": mood_score},
        "premium": {"code": prem[0], "label": prem[1], "score": prem_score},
        "lines": lines,
    }


def vix_block(quotes: dict[str, dict], vix_hist: list[dict] | None) -> dict:
    def px(k):
        q = quotes.get(k) or {}
        return q.get("current_price") or q.get("close")

    def chg(k):
        q = quotes.get(k) or {}
        v = q.get("price_change_percent")
        return v / 100 if v is not None else None

    out = {
        "vix": px("VIX"), "vix9d": px("VIX9D"), "vix3m": px("VIX3M"), "vix6m": px("VIX6M"),
        "vvix": px("VVIX"), "skew_index": px("SKEW"),
        "vix_chg": chg("VIX"), "vix9d_chg": chg("VIX9D"), "vix3m_chg": chg("VIX3M"), "vix6m_chg": chg("VIX6M"),
        "vvix_chg": chg("VVIX"), "skew_index_chg": chg("SKEW"),
    }
    if vix_hist and out["vix"]:
        closes = [r["close"] for r in vix_hist[-252:]]
        out["vix_pct"] = H.percentile_rank(closes, out["vix"])
        out["vix_series"] = [{"date": r["date"], "close": r["close"]} for r in vix_hist[-252:]]
    return out
