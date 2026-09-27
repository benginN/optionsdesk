// Arayüzdeki "?" ipuçları ve Öğren sayfasındaki sözlük (TR / EN).
type Txt = { tr: string; en: string };
export interface Term { t: Txt; d: Txt }

export const G: Record<string, Term> = {
  option: {
    t: { tr: "Opsiyon", en: "Option" },
    d: {
      tr: "Bir hisseyi belirli bir tarihe kadar belirli bir fiyattan alma (call) ya da satma (put) hakkı. 1 kontrat = 100 hisse. Hakkı satan kişi bugün prim (peşin para) alır; karşılığında yükümlülük üstlenir.",
      en: "The right to buy (call) or sell (put) a stock at a set price until a set date. 1 contract = 100 shares. The seller of that right collects a premium (cash up front) today and takes on the obligation.",
    },
  },
  premium: {
    t: { tr: "Prim", en: "Premium" },
    d: {
      tr: "Opsiyonun fiyatı. Satıcıysan işlem anında hesabına geçen para; alıcıysan ödediğin bedel. Kontrat başına prim = fiyat × 100.",
      en: "The price of an option. As a seller it's the cash that lands in your account right away; as a buyer it's what you pay. Premium per contract = price × 100.",
    },
  },
  strike: {
    t: { tr: "Strike (kullanım fiyatı)", en: "Strike price" },
    d: {
      tr: "Hissenin alınıp satılacağı sabit fiyat. Put satarken 'bu hisseyi bu fiyattan almaya razıyım', call satarken 'bu fiyattan satmaya razıyım' demiş olursun.",
      en: "The fixed price at which shares change hands. Selling a put says 'I'm happy to buy at this price'; selling a call says 'I'm happy to sell at this price'.",
    },
  },
  iv: {
    t: { tr: "IV (ima edilen oynaklık)", en: "IV (implied volatility)" },
    d: {
      tr: "Piyasanın önümüzdeki dönemde hissenin ne kadar oynayacağını tahmin ettiği seviye. IV yüksekse opsiyonlar pahalıdır: satana daha çok prim, alana daha pahalı sigorta.",
      en: "How much the market expects a stock to move. High IV means expensive options: more premium for sellers, pricier insurance for buyers.",
    },
  },
  iv30: {
    t: { tr: "IV30", en: "IV30" },
    d: { tr: "30 günlük ima edilen oynaklık (yıllık, %).", en: "30-day implied volatility (annualized, %)." },
  },
  iv1y: {
    t: { tr: "IV1Y", en: "IV1Y" },
    d: { tr: "1 yıllık vade için ima edilen oynaklık. IV30 bunu aşıyorsa kısa vadede stres var demektir.", en: "Implied volatility for a one-year expiry. If IV30 is above it, there's short-term stress." },
  },
  hv30: {
    t: { tr: "HV30 (gerçekleşen oynaklık)", en: "HV30 (realized volatility)" },
    d: { tr: "Hissenin son 30 günde gerçekte ne kadar oynadığı (yıllık, %).", en: "How much the stock actually moved over the last 30 days (annualized, %)." },
  },
  vrp: {
    t: { tr: "IV/HV (risk primi)", en: "IV/HV (risk premium)" },
    d: {
      tr: "Beklenen oynaklığın gerçekleşene oranı. 1'in üstü: piyasa riski olduğundan pahalı fiyatlıyor, prim satana avantaj. 1'in altı: opsiyonlar ucuz.",
      en: "Expected vs realized volatility. Above 1: the market is overpricing risk, an edge for premium sellers. Below 1: options are cheap.",
    },
  },
  ivpos: {
    t: { tr: "Opsiyonlar ne kadar pahalı? (IV Pos)", en: "How expensive are options? (IV Pos)" },
    d: {
      tr: "Bugünkü IV'nin son bir yıl içindeki yeri (0–100). 80: son bir yılın %80'inden pahalı. Yüksekse satmak, düşükse almak daha mantıklı. İlk 20 gün tahminidir (≈).",
      en: "Where today's IV sits within the past year (0–100). 80 means pricier than 80% of the year. High favors selling, low favors buying. Estimated for the first 20 days (≈).",
    },
  },
  ivrank: {
    t: { tr: "IV Rank", en: "IV Rank" },
    d: { tr: "(IV − yıllık en düşük) ÷ (en yüksek − en düşük).", en: "(IV − 1y low) ÷ (1y high − 1y low)." },
  },
  skew: {
    t: { tr: "Skew", en: "Skew" },
    d: {
      tr: "Aşağı yönlü korumanın (put) yukarı yönlü call'lara göre ne kadar pahalı olduğu. Yükseliyorsa korku artıyor; put satanlar daha zengin prim alır.",
      en: "How pricey downside protection (puts) is versus upside calls. When rising, fear is growing and put sellers get richer premiums.",
    },
  },
  em: {
    t: { tr: "Beklenen aralık", en: "Expected range" },
    d: {
      tr: "Opsiyon fiyatlarının ima ettiği ±1 standart sapmalık hareket. Hisse vadede yaklaşık %68 olasılıkla bu aralıkta kalır.",
      en: "The ±1 standard deviation move implied by option prices. The stock stays in this range about 68% of the time.",
    },
  },
  delta: {
    t: { tr: "Delta", en: "Delta" },
    d: {
      tr: "Hisse 1$ oynayınca opsiyonun kaç $ değiştiği. Kabaca vadede ITM bitme olasılığıdır: 0,25 delta ≈ %25 atanma ihtimali.",
      en: "How much the option moves when the stock moves $1. Roughly the chance of finishing in the money: 0.25 delta ≈ 25% chance of assignment.",
    },
  },
  theta: {
    t: { tr: "Theta (zaman kaybı)", en: "Theta (time decay)" },
    d: { tr: "Opsiyonun her gün kaybettiği değer. Satıcı kazanır, alıcı öder.", en: "Value an option loses each day. Sellers earn it, buyers pay it." },
  },
  gamma: {
    t: { tr: "Gamma", en: "Gamma" },
    d: { tr: "Deltanın hızı. Vadeye yaklaştıkça patlar; 0DTE opsiyonların riskli olmasının sebebi.", en: "How fast delta changes. It explodes near expiry, which is why 0DTE options are so risky." },
  },
  vega: {
    t: { tr: "Vega", en: "Vega" },
    d: { tr: "IV 1 puan değişince opsiyon fiyatının değişimi. Bilanço sonrası IV çöküşü alıcıları vega üzerinden vurur.", en: "Price change for a 1-point move in IV. The post-earnings IV crush hits buyers through vega." },
  },
  pop: {
    t: { tr: "Kâr olasılığı", en: "Chance of profit" },
    d: { tr: "Vadede başabaş noktasının kârlı tarafında kalma olasılığı (IV ile hesaplanır). Garanti değildir.", en: "Probability of finishing on the profitable side of breakeven (from IV). Not a guarantee." },
  },
  potm: {
    t: { tr: "Primin tamamı sende kalma olasılığı", en: "Chance to keep the full premium" },
    d: { tr: "Kontratın değersiz bitme olasılığı: satıcı hiçbir şey yapmadan primin tamamını tutar.", en: "Chance the contract expires worthless: the seller keeps all of the premium without doing anything." },
  },
  ptouch: {
    t: { tr: "Dokunma olasılığı", en: "Chance of touching" },
    d: { tr: "Vadeye kadar fiyatın strike'a en az bir kez değme olasılığı. Yol boyunca stres yaşama ihtimali.", en: "Chance the price touches the strike at least once before expiry — how likely you'll feel some stress along the way." },
  },
  yield: {
    t: { tr: "Prim getirisi", en: "Premium yield" },
    d: { tr: "Alınan prim ÷ ayrılan sermaye. Örnek: 47,5$ put'tan 1,26$ prim = %2,65 (4 günde).", en: "Premium ÷ capital set aside. Example: $1.26 on a $47.50 put = 2.65% (in 4 days)." },
  },
  ann: {
    t: { tr: "Yıllık karşılığı", en: "Annualized" },
    d: { tr: "Getirinin yıla çevrilmiş hali; sadece farklı vadeleri karşılaştırmak içindir, vaat değildir.", en: "The yield scaled to a year — only for comparing expiries, not a promise." },
  },
  edge: {
    t: { tr: "Risk primi", en: "Risk premium" },
    d: {
      tr: "Alınan prim − hissenin geçmiş hareketliliğine göre adil fiyat. Pozitifse piyasa bu riski pahalı fiyatlıyor: satıcı lehine.",
      en: "Premium received − fair value based on the stock's realized movement. Positive means the market is overpricing this risk, in the seller's favor.",
    },
  },
  sd: { t: { tr: "σ mesafe", en: "σ distance" }, d: { tr: "Strike'ın bugünkü fiyattan kaç standart sapma uzakta olduğu.", en: "How many standard deviations the strike is from today's price." } },
  resid: {
    t: { tr: "Gülümseme sapması", en: "Smile deviation" },
    d: { tr: "Kontratın IV'sinin aynı vadedeki komşu strike'lara göre farkı. Pozitif: komşularına göre pahalı.", en: "The contract's IV versus neighboring strikes in the same expiry. Positive: rich versus its neighbors." },
  },
  spread: {
    t: { tr: "Alış-satış farkı (spread)", en: "Bid-ask spread" },
    d: { tr: "Alış ve satış fiyatı arasındaki fark. Geniş spread gizli maliyettir; %10 üstü dikkat, %20 üstü genelde uzak dur.", en: "The gap between bid and ask. A wide spread is a hidden cost; be careful above 10%, usually avoid above 20%." },
  },
  oi: { t: { tr: "Açık pozisyon (OI)", en: "Open interest" }, d: { tr: "Kapanmamış kontrat sayısı; likiditenin göstergesi.", en: "Number of contracts still open — a gauge of liquidity." } },
  pcr: { t: { tr: "Put/Call oranı", en: "Put/call ratio" }, d: { tr: "Put işlemlerinin call'lara oranı. Yüksekse korunma talebi ya da korku var.", en: "Puts traded versus calls. High means demand for protection or fear." } },
  maxpain: { t: { tr: "Max pain", en: "Max pain" }, d: { tr: "Vadede opsiyon alıcılarına en az ödemenin yapıldığı fiyat. Zayıf bir sinyaldir; bağlam için.", en: "Price at which option buyers collect the least at expiry. A weak signal; for context only." } },
  gex: {
    t: { tr: "Gamma pozisyonu (GEX)", en: "Gamma exposure (GEX)" },
    d: { tr: "Piyasa yapıcıların pozisyonunun tahmini. Pozitif: hareketleri söndürürler (sakin piyasa). Negatif: büyütürler.", en: "An estimate of dealer positioning. Positive: they dampen moves (calm). Negative: they amplify them." },
  },
  flip: { t: { tr: "Gamma dönüş noktası", en: "Gamma flip" }, d: { tr: "Toplam GEX'in işaret değiştirdiği fiyat. Altında piyasa daha oynak olabilir.", en: "Price where total GEX changes sign. Below it the market can get choppier." } },
  walls: { t: { tr: "Put / call duvarı", en: "Put / call wall" }, d: { tr: "En çok açık pozisyonun olduğu strike'lar; kısa vadede destek/direnç gibi davranabilir.", en: "Strikes with the most open interest; they can act like support/resistance short term." } },
  rsi: { t: { tr: "RSI", en: "RSI" }, d: { tr: "70 üstü aşırı alım, 30 altı aşırı satım. IV yüksek + aşırı satım → put satmak için iyi zaman.", en: "Above 70 overbought, below 30 oversold. High IV + oversold → a good time to sell puts." } },
  csp: {
    t: { tr: "Cash-secured put", en: "Cash-secured put" },
    d: {
      tr: "Nakdini teminat göstererek put satarsın: 'Bu hisseyi şu fiyattan almaya razıyım, bana bunun için para öde.' Fiyat strike üstünde kalırsa prim senin; altına düşerse hisseyi strike'tan (prim kadar ucuza) alırsın.",
      en: "You sell a put backed by cash: 'I'm willing to buy this stock at this price — pay me for it.' If it stays above the strike you keep the premium; if it drops below, you buy the shares at the strike (effectively cheaper by the premium).",
    },
  },
  cc: {
    t: { tr: "Covered call", en: "Covered call" },
    d: {
      tr: "Elindeki 100 hisse karşılığında call satarsın: 'Şu fiyattan satmaya razıyım.' Fiyat strike altında kalırsa prim senin, hisse de sende; üstüne çıkarsa hisse o fiyattan satılır.",
      en: "You sell a call against 100 shares you own: 'I'd sell at this price.' If it stays below the strike you keep the premium and the shares; if it rises above, your shares are sold at that price.",
    },
  },
  wheel: {
    t: { tr: "Wheel (çark)", en: "The wheel" },
    d: { tr: "Put sat → atanırsan hisseyi al → call sat → hisse giderse tekrar put sat. Her adımda prim toplanır.", en: "Sell puts → if assigned, own the shares → sell calls → if called away, sell puts again. Premium at every step." },
  },
  leaps: {
    t: { tr: "LEAPS", en: "LEAPS" },
    d: { tr: "Vadesi 1 yıldan uzun opsiyonlar. Derin ITM LEAPS call, hisseyi çok daha az sermayeyle 'kiralamak' gibidir.", en: "Options expiring in over a year. A deep in-the-money LEAPS call is like 'renting' the stock for much less capital." },
  },
  pcs: { t: { tr: "Put kredi spread", en: "Put credit spread" }, d: { tr: "Bir put satıp daha aşağıdan bir put almak. Riski sınırlı, daha az teminatlı CSP.", en: "Sell a put and buy a lower one. A cheaper, risk-capped version of a CSP." } },
  ccs: { t: { tr: "Call kredi spread", en: "Call credit spread" }, d: { tr: "Bir call satıp daha yukarıdan call almak. Hisse strike altında kalırsa kredi senin.", en: "Sell a call and buy a higher one. Keep the credit if the stock stays below the strike." } },
  dte: { t: { tr: "Vadeye kalan gün", en: "Days to expiry" }, d: { tr: "Kontratın bitmesine kalan gün sayısı.", en: "Days left until the contract expires." } },
  atm: { t: { tr: "ATM / OTM / ITM", en: "ATM / OTM / ITM" }, d: { tr: "ATM: strike ≈ fiyat. OTM: içsel değeri yok. ITM: içsel değeri var.", en: "ATM: strike ≈ price. OTM: no intrinsic value. ITM: has intrinsic value." } },
  assignment: {
    t: { tr: "Atanma", en: "Assignment" },
    d: { tr: "Sattığın opsiyonun karşı tarafça kullanılması: put'ta hisseyi strike'tan alırsın, call'da strike'tan satarsın.", en: "When the option you sold is exercised: with a put you buy the shares at the strike; with a call you sell them." },
  },
  roll: { t: { tr: "Roll", en: "Roll" }, d: { tr: "Pozisyonu kapatıp aynı anda daha ileri vadeye (ve/veya farklı strike'a) yeniden açmak.", en: "Closing a position and reopening it at a later date (and/or different strike) in one move." } },
  vix: { t: { tr: "VIX (korku endeksi)", en: "VIX (fear index)" }, d: { tr: "S&P 500 opsiyonlarından hesaplanan 30 günlük beklenen oynaklık. Yükseldikçe piyasa daha tedirgindir.", en: "30-day expected volatility from S&P 500 options. The higher it is, the more nervous the market." } },
  term: { t: { tr: "Vade yapısı", en: "Term structure" }, d: { tr: "Farklı vadelerin IV eğrisi. Kısa vade uzun vadeden pahalıysa yakın bir olay fiyatlanıyor.", en: "IV across expiries. Short-dated IV above long-dated means a near-term event is priced." } },
  extrinsic: { t: { tr: "Zaman değeri", en: "Time value" }, d: { tr: "Opsiyon fiyatının içsel değer dışındaki kısmı; LEAPS için ödediğin 'kira'.", en: "The part of an option's price beyond intrinsic value — the 'rent' you pay on a LEAPS." } },
  unusual: { t: { tr: "Olağandışı işlem", en: "Unusual activity" }, d: { tr: "Hacmi açık pozisyonun belirgin üstünde olan büyük işlemler.", en: "Big trades with volume well above open interest." } },
  score: {
    t: { tr: "Skor", en: "Score" },
    d: { tr: "0–100 arası şeffaf puan: prim, opsiyon pahalılığı, risk primi, likidite ve zamanlama birleşimi. Bir sıralama aracıdır, tavsiye değildir.", en: "A transparent 0–100 score blending premium, option richness, risk premium, liquidity and timing. A ranking tool, not advice." },
  },
  fill: { t: { tr: "Gerçekçi fiyat", en: "Realistic fill" }, d: { tr: "Satışta alış fiyatı + farkın %25'i, alışta satış fiyatı − farkın %25'i.", en: "For sells: bid + 25% of the spread; for buys: ask − 25% of the spread." } },
};

export function term(key: string, lang: "tr" | "en"): { t: string; d: string } | undefined {
  const g = G[key];
  return g ? { t: g.t[lang], d: g.d[lang] } : undefined;
}
