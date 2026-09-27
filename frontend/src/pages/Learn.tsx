import { useState } from "react";
import { LineChart } from "../components/Charts";
import { Bubble, Icon, STRAT_STYLE } from "../components/Icon";
import { Callout, Card, SectionHead } from "../components/ui";
import { G } from "../lib/glossary";
import { go } from "../lib/router";
import { usePrefs, useT } from "../prefs";

type L = { t: "C" | "P" | "S"; k: number; side: 1 | -1; p: number };

function Mini({ legs }: { legs: L[] }) {
  const t = useT();
  const pts = [];
  for (let S = 60; S <= 140; S += 1) {
    let v = 0;
    for (const l of legs) {
      const intr = l.t === "S" ? S : l.t === "C" ? Math.max(0, S - l.k) : Math.max(0, l.k - S);
      v += l.side * (intr - l.p);
    }
    pts.push({ x: S, y: v });
  }
  return (
    <LineChart height={120} legend={false} zeroFill
      series={[{ name: t("Vade sonu kâr/zarar", "P/L at expiry"), color: "var(--series-1)", points: pts }]}
      vlines={[{ x: 100, label: t("bugün", "today") }]} xFmt={(x) => `$${x}`} yFmt={(y) => y.toFixed(0)} xTicks={[70, 85, 100, 115, 130]}
      tipTitle={(x) => t(`Hisse $${x} olursa`, `If the stock is $${x}`)} />
  );
}

export default function Learn() {
  const t = useT();
  const { lang } = usePrefs();
  const [q, setQ] = useState("");

  const basics = [
    { icon: "rocket", color: "var(--blue)", bg: "var(--blue-bg)", title: t("Call: alma hakkı", "Call: the right to buy"),
      text: t("Bir evi 3 ay içinde bugünkü fiyattan alma hakkı için ev sahibine kapora vermek gibi. Fiyat yükselirse hakkın değerlenir; yükselmezse kaporayı kaybedersin.",
        "Like paying a deposit for the right to buy a house at today's price within 3 months. If prices rise, your right gains value; if not, you lose the deposit.") },
    { icon: "shield", color: "var(--green)", bg: "var(--green-bg)", title: t("Put: satma hakkı (sigorta)", "Put: the right to sell (insurance)"),
      text: t("Arabana kasko yaptırmak gibi. Değeri düşerse sigorta öder. Put satan kişi ise sigortacıdır: prim toplar, kötü bir şey olursa öder.",
        "Like car insurance. If the value drops, the insurance pays. Whoever sells a put is the insurer: they collect premiums and pay out if something bad happens.") },
    { icon: "cash", color: "var(--amber)", bg: "var(--amber-bg)", title: t("Prim: bu hakkın bedeli", "Premium: the price of that right"),
      text: t("Hakkı satan kişi primi hemen peşin alır. Bu sitedeki stratejilerin çoğu bu primi toplamak üzerine kurulu: sen sigortacı olursun.",
        "The seller collects the premium up front. Most strategies on this site are about collecting it — you become the insurer.") },
  ];

  const path = [
    { title: t("Covered call ile başla", "Start with covered calls"), text: t("1–2 hisseyle birkaç ay, 1–2 haftalık vadelerde fiyattan uzak call sat. Kaybetmesi en zor yer.", "For a few months, on 1–2 stocks, sell far-away calls 1–2 weeks out. The hardest place to lose money."), to: "/ideas?s=cc" },
    { title: t("Nakitle put satmayı öğren", "Learn cash-secured puts"), text: t("Sadece almak istediğin hisselerde, 0,20–0,30 delta civarında put sat. Atanmak kötü değil: hisseyi indirimli alırsın.", "Sell ~0.20–0.30 delta puts only on stocks you want to own. Assignment isn't bad: you buy at a discount."), to: "/ideas?s=csp" },
    { title: t("Çarkı çevir (wheel)", "Spin the wheel"), text: t("Put sat → atanırsan hisse al → call sat → hisse giderse tekrar put. Artık mesele yön tahmini değil, döngüyü işletmek.", "Sell puts → if assigned, own the shares → sell calls → if called away, sell puts again. It's no longer about predicting direction."), to: "/portfolio" },
    { title: t("Primle yükselişe ortak ol", "Use premium to ride the upside"), text: t("Toplanan primin bir kısmıyla uzun vadeli call (LEAPS) al; call yazdığın için kaçırdığın yükselişleri telafi et.", "Put part of your premium into long-dated calls (LEAPS) to recover upside you give up by writing calls."), to: "/ideas?s=leaps" },
    { title: t("Volatiliteyi oku", "Read volatility"), text: t("Opsiyonlar pahalıyken sat, ucuzken al. Bugün sayfası bunu her gün senin için özetler.", "Sell options when they're expensive, buy when they're cheap. The Today page sums this up daily."), to: "/" },
  ];

  const rules = [
    [t("Opsiyonlar pahalıyken", "When options are expensive"), t("sat", "sell")],
    [t("Opsiyonlar ucuzken", "When options are cheap"), t("orta/uzun vadeli al", "buy mid/long-dated")],
    [t("Pahalı + hisse çok yükselmiş", "Expensive + stock ran up"), t("call sat", "sell calls")],
    [t("Pahalı + hisse çok düşmüş", "Expensive + stock sold off"), t("put sat", "sell puts")],
    [t("Ucuz + hisse çok düşmüş", "Cheap + stock sold off"), t("LEAPS call al", "buy LEAPS calls")],
  ];

  const strategies: { s: string; name: string; when: string; risk: string; legs: L[] }[] = [
    { s: "csp", name: t("Nakitle put satmak (CSP)", "Cash-secured put"), legs: [{ t: "P", k: 95, side: -1, p: 2 }],
      when: t("Almak istediğin bir hisse var ve opsiyonlar pahalı.", "You want to own a stock and options are expensive."),
      risk: t("Hisse sert düşerse strike'tan almak zorundasın; zarar strike − prim kadar olabilir.", "If the stock drops hard you must buy at the strike; the loss can reach strike − premium.") },
    { s: "cc", name: t("Covered call", "Covered call"), legs: [{ t: "S", k: 0, side: 1, p: 100 }, { t: "C", k: 108, side: -1, p: 1.5 }],
      when: t("Hissen var, kısa vadede sert yükseliş beklemiyorsun.", "You own shares and don't expect a sharp rally soon."),
      risk: t("Hisse strike'ı çok aşarsa yükselişin bir kısmını kaçırırsın.", "If the stock blows past the strike, you miss part of the rally.") },
    { s: "leaps", name: "LEAPS", legs: [{ t: "C", k: 85, side: 1, p: 22 }],
      when: t("Opsiyonlar ucuz ve uzun vadede yükseliş bekliyorsun.", "Options are cheap and you expect long-term upside."),
      risk: t("Hisse strike altında kalırsa opsiyon değersiz biter; zaman değeri her gün erir.", "If the stock stays below the strike the option expires worthless; time value erodes daily.") },
    { s: "pcs", name: t("Put kredi spread", "Put credit spread"), legs: [{ t: "P", k: 95, side: -1, p: 2 }, { t: "P", k: 90, side: 1, p: 0.8 }],
      when: t("CSP mantığı ama daha az sermaye ve sınırlı risk.", "Same idea as a CSP but less capital and capped risk."),
      risk: t("Kazanç/kayıp oranı CSP'den kötü; hisseyi alma seçeneği yok.", "Worse reward/risk than a CSP; no chance to own the shares.") },
  ];

  const pitfalls = [
    [t("Aynı gün biten (0DTE) opsiyonlar", "Same-day (0DTE) options"), t("Dakikalar içinde sıfıra gidebilir. 10 bin doları 155 bine çıkarıp bir günde sıfırlayan örnekler var. Yatırım değil, kumar.", "They can go to zero within minutes. There are stories of $10k turning into $155k and back to zero in a day. Gambling, not investing.")],
    [t("Bilanço öncesi opsiyon almak", "Buying options before earnings"), t("Fiyatlar zirvededir; bilanço sonrası hisse doğru yöne gitse bile para kaybedebilirsin. 'Yağmurda pahalı şemsiye almak gibi.'", "Prices peak beforehand; you can lose money even if the stock moves your way. 'Like buying an umbrella in the rain.'")],
    [t("Kaybı kovalamak", "Chasing losses"), t("Kayıpları telafi için pozisyon büyütmek felakete dönüşür. Pozisyon boyutunu baştan belirle.", "Growing positions to recover losses ends in disaster. Decide your position size up front.")],
    [t("Çok ucuz kontrat avcılığı", "Hunting ultra-cheap contracts"), t("0,06$'lık kontratın %900 yapması istisnadır; çoğu sıfıra gider.", "A $0.06 contract going +900% is the exception; most go to zero.")],
    [t("Düşük prime yükselişi kilitlemek", "Capping your upside for crumbs"), t("Covered call'da riske değecek prim al; prim zayıfsa o hafta yazma.", "With covered calls, only sell for a premium worth the risk; skip weeks when it's thin.")],
    [t("Likit olmayan kontratlar", "Illiquid contracts"), t("Alış-satış farkı geniş kontratlarda gizli maliyet yüksektir.", "Wide bid-ask spreads carry a big hidden cost.")],
  ];

  const terms = Object.values(G).filter((g) => {
    if (!q) return true;
    const hay = (g.t[lang] + g.d[lang]).toLocaleLowerCase(lang === "tr" ? "tr" : "en");
    return hay.includes(q.toLocaleLowerCase(lang === "tr" ? "tr" : "en"));
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker"><Icon name="book" size={15} /> {t("Öğren", "Learn")}</div>
          <h1>{t("Opsiyonları 10 dakikada anla", "Understand options in 10 minutes")}</h1>
          <p className="sub">{t("Jargon yok. Önce temel fikir, sonra adım adım bir yol, en sonda da kaçınman gerekenler.", "No jargon. First the core idea, then a step-by-step path, and finally what to avoid.")}</p>
        </div>
      </div>

      <div className="grid g3">
        {basics.map((b) => (
          <div className="card" key={b.title}>
            <Bubble name={b.icon} color={b.color} bg={b.bg} />
            <h3 style={{ fontSize: 17, marginTop: 14 }}>{b.title}</h3>
            <p className="ink2 mt8" style={{ lineHeight: 1.65 }}>{b.text}</p>
          </div>
        ))}
      </div>

      <div className="section grid g2" style={{ alignItems: "start" }}>
        <div>
          <SectionHead title={t("Adım adım öğrenme yolu", "A step-by-step path")} />
          <div className="card">
            <div className="path">
              {path.map((p, i) => (
                <div className={`path-step ${i === 0 ? "on" : ""}`} key={p.title}>
                  <span className="n">{i + 1}</span>
                  <div>
                    <strong style={{ fontSize: 15.5 }}>{p.title}</strong>
                    <p className="ink2 mt4">{p.text}</p>
                    <button className="link-btn small mt8" onClick={() => go(p.to)}>{t("Dene", "Try it")} <Icon name="arrow" size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <SectionHead title={t("Tek sayfalık kural seti", "The one-page rulebook")} />
          <div className="dark-card">
            {rules.map(([a, b]) => <p key={a}>{a} → <strong>{b}</strong></p>)}
            <div className="accent">{t("Başarı, volatiliteyi doğru okumaktan geçer.", "Success comes from reading volatility right.")}</div>
            <p className="small" style={{ color: "var(--dark-card-muted)" }}>{t("Bu kurallar @onestoploss'un paylaşımlarından derlendi; site her hisse için bunları otomatik uygular.", "Rules compiled from @onestoploss's posts; the site applies them to every stock automatically.")}</p>
          </div>
        </div>
      </div>

      <div className="section">
        <SectionHead title={t("Stratejiler bir bakışta", "Strategies at a glance")} sub={t("Grafik: hisse vade sonunda x ekseninde olursa, hisse başına kâr/zarar.", "Chart: profit/loss per share if the stock ends at the x-axis price.")} />
        <div className="grid g2">
          {strategies.map((s) => {
            const st = STRAT_STYLE[s.s];
            return (
              <div className="card" key={s.s}>
                <div className="row-between">
                  <div className="row" style={{ gap: 10 }}><Bubble name={st.icon} color={st.color} bg={st.bg} sm /><h3 style={{ fontSize: 16 }}>{s.name}</h3></div>
                  {s.s !== "pcs" && <button className="btn sm" onClick={() => go(`/ideas?s=${s.s}`)}>{t("Fikirleri gör", "See ideas")}</button>}
                </div>
                <div className="mt12"><Mini legs={s.legs} /></div>
                <p className="ink2 mt12"><strong>{t("Ne zaman:", "When:")}</strong> {s.when}</p>
                <p className="ink2 mt8"><strong>{t("Risk:", "Risk:")}</strong> {s.risk}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section">
        <SectionHead title={t("Kaçınılacaklar", "What to avoid")} />
        <div className="grid g3">
          {pitfalls.map(([a, b]) => (
            <div className="card soft" key={a}>
              <div className="row" style={{ gap: 8 }}><Icon name="alert" size={17} style={{ color: "var(--red)" }} /><strong>{a}</strong></div>
              <p className="ink2 mt8" style={{ fontSize: 14 }}>{b}</p>
            </div>
          ))}
        </div>
        <div className="mt16">
          <Callout tone="warn">
            {t("Gerçekçi beklenti: sosyal medyadaki \"her hafta %2–3\" sonuçları genellikle kazanan haftalardan seçilir. Prim satışı küçük ve sık kazançlar, seyrek ama büyük kayıplar üretir. Kalıcı avantaj; doğru zamanda satmak, küçük pozisyon ve sahip olmaya razı olduğun hisselerden gelir.",
              "Realistic expectations: social-media \"2–3% every week\" results are usually cherry-picked winning weeks. Selling premium produces small, frequent gains and rare but large losses. The lasting edge comes from selling at the right time, keeping positions small, and sticking to stocks you'd be happy to own.")}
          </Callout>
        </div>
      </div>

      <div className="section">
        <SectionHead title={t("Sözlük", "Glossary")} right={<input className="input sm" style={{ width: 220 }} placeholder={t("Terim ara…", "Search a term…")} value={q} onChange={(e) => setQ(e.target.value)} />} />
        <Card>
          <div className="grid g2" style={{ gap: "18px 32px" }}>
            {terms.map((g) => (
              <div key={g.t.en}>
                <strong>{g.t[lang]}</strong>
                <p className="ink2 small" style={{ lineHeight: 1.6, marginTop: 3 }}>{g.d[lang]}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="section">
        <SectionHead title={t("Veriler nereden geliyor?", "Where does the data come from?")} />
        <Card>
          <ul className="bullets">
            <li><Icon name="pulse" size={18} /><span>{t("CBOE: tüm opsiyon zincirleri, Greeks ve oynaklık (ücretsiz, 15 dk gecikmeli).", "CBOE: every option chain, Greeks and volatility (free, 15-min delayed).")}</span></li>
            <li><Icon name="wave" size={18} /><span>{t("Yahoo: 3 yıllık fiyat geçmişi ve şirket adları.", "Yahoo: 3 years of price history and company names.")}</span></li>
            <li><Icon name="calendar" size={18} /><span>{t("Nasdaq: önümüzdeki 60 günün bilanço takvimi.", "Nasdaq: the earnings calendar for the next 60 days.")}</span></li>
            <li><Icon name="cash" size={18} /><span>{t("FRED: 3 aylık hazine bonosu faizi.", "FRED: the 3-month Treasury bill rate.")}</span></li>
            <li><Icon name="clock" size={18} /><span>{t("Her kapanıştan sonra (16:30 New York) tüm hisselerin verisi kaydedilir; oynaklık geçmişi böyle birikir.", "After each close (4:30 PM New York) data for every stock is saved; that's how volatility history builds up.")}</span></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
