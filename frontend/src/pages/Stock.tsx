import { useState } from "react";
import { LineChart, StrikeBars } from "../components/Charts";
import ContractIdeas from "../components/ContractIdeas";
import { Bubble, Icon, STRAT_STYLE } from "../components/Icon";
import { Table } from "../components/Table";
import { Card, Disclosure, ErrorBox, Gauge, Info, Pill, RangeBar, SectionHead, Skeleton, Stat, Verdict } from "../components/ui";
import { useApi } from "../lib/api";
import { cls, compact, dateTR, int, num, pct, spct, strike, usd, vol } from "../lib/format";
import { go } from "../lib/router";
import { Strat, explainCandidate, reasons, stratName } from "../lib/story";
import { usePro, useT } from "../prefs";
import { SignalPill } from "./Today";

type T = (a: string, b: string) => string;

function commentary(m: any, d: any, t: T): { icon: string; text: string }[] {
  const out: { icon: string; text: string }[] = [];
  const ivp = m.iv_pos;
  if (ivp != null) {
    out.push({
      icon: "cash",
      text: ivp >= 60
        ? t(`Opsiyonlar pahalı: son bir yıla göre 100 üzerinden ${Math.round(ivp)} seviyesinde. Satanlar için iyi, alanlar için pahalı.`,
          `Options are expensive: priced above ${Math.round(ivp)}% of the past year. Good for sellers, costly for buyers.`)
        : ivp <= 30
          ? t(`Opsiyonlar ucuz: son bir yıla göre 100 üzerinden ${Math.round(ivp)} seviyesinde. Uzun vadeli opsiyon almak için uygun, satmak için zayıf.`,
            `Options are cheap: in the bottom ${Math.max(1, Math.round(ivp))}% of the past year. Good for buying long-dated options, weak for selling.`)
          : t("Opsiyon fiyatları normal seviyede.", "Option prices are at normal levels."),
    });
  }
  if (m.vrp != null) {
    out.push({
      icon: "pulse",
      text: m.vrp >= 1.15
        ? t(`Piyasa, hissenin son 30 günde gerçekte gösterdiğinden yüzde ${Math.round((m.vrp - 1) * 100)} daha fazla oynaklık bekliyor: risk abartılı fiyatlanıyor, prim satana avantaj.`,
          `The market expects ${Math.round((m.vrp - 1) * 100)}% more movement than the stock actually showed over 30 days: risk is overpriced, an edge for sellers.`)
        : m.vrp <= 0.95
          ? t("Hisse, opsiyonların beklediğinden daha fazla oynuyor: prim satmak için risk/ödül zayıf.", "The stock is moving more than options expect: weak risk/reward for selling premium.")
          : t("Beklenen ve gerçekleşen oynaklık dengede.", "Expected and realized volatility are in balance."),
    });
  }
  if (m.skew != null) {
    if (m.skew > 0.15) out.push({ icon: "shield", text: t("Yatırımcılar düşüşe karşı sigorta (put) için ekstra ödüyor; put satıcıları daha zengin prim alıyor.", "Investors are paying extra for downside insurance (puts); put sellers get richer premiums.") });
    else if (m.skew < -0.02) out.push({ icon: "rocket", text: t("Yükseliş opsiyonları (call) daha pahalı: yukarı yönlü spekülatif ilgi var, covered call primleri cömert.", "Upside calls are pricier: there's speculative interest, so covered call premiums are generous.") });
  }
  if (m.term_slope != null && m.term_slope < -0.05) {
    out.push({ icon: "calendar", text: t("Yakın vadeli opsiyonlar uzun vadelilerden pahalı: piyasa yakında bir olay (bilanço, haber) bekliyor.", "Near-term options are pricier than longer ones: the market expects an event soon (earnings, news).") });
  }
  if (d.pc_30?.pcr_volume != null) {
    const p = d.pc_30.pcr_volume;
    if (p > 1.2) out.push({ icon: "alert", text: t(`Bugün put işlemleri call'ların ${num(p, 1)} katı: korunma ya da düşüş beklentisi ağır basıyor.`, `Puts traded ${num(p, 1)}× calls today: hedging or bearish bets dominate.`) });
    else if (p < 0.5) out.push({ icon: "sparkle", text: t("Bugün call işlemleri baskın: iyimser/spekülatif bir akış var.", "Calls dominated trading today: an optimistic/speculative flow.") });
  }
  if (m.rsi14 != null) {
    if (m.rsi14 <= 35) out.push({ icon: "wave", text: t("Hisse son dönemde sert düştü (aşırı satım).", "The stock has sold off hard recently (oversold).") });
    else if (m.rsi14 >= 70) out.push({ icon: "wave", text: t("Hisse son dönemde sert yükseldi (aşırı alım).", "The stock has run up hard recently (overbought).") });
  }
  if (m.days_to_earnings != null && m.days_to_earnings >= 0 && m.days_to_earnings <= 21) {
    out.push({ icon: "calendar", text: t(`Bilanço ${dateTR(m.earnings, true)} (${m.days_to_earnings} gün sonra). Bilanço öncesi opsiyon almak pahalı, satmak ise ani fiyat sıçramasına açık.`,
      `Earnings on ${dateTR(m.earnings, true)} (in ${m.days_to_earnings} days). Buying options before earnings is expensive; selling exposes you to a sudden gap.`) });
  }
  return out;
}

function StrategyBox({ m, s, sym }: { m: any; s: Strat; sym: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const st = STRAT_STYLE[s];
  const why = reasons(m, s, t);
  return (
    <div className="card idea" style={open ? { gridColumn: "1 / -1" } : undefined}>
      <div className="idea-top">
        <div className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
          <Bubble name={st.icon} color={st.color} bg={st.bg} sm />
          <h3 style={{ fontSize: 16 }}>{stratName(s, t)}</h3>
        </div>
        <Verdict s={m.scores?.[s]} parts={m.score_parts?.[s]} />
      </div>
      <p className="idea-sentence">{explainCandidate(sym, m[s], s, t)}</p>
      {why.length > 0 && <div className="chips">{why.map((w) => <Pill key={w.label} tone={w.tone}>{w.label}</Pill>)}</div>}
      <button className={`btn sm ${open ? "primary" : ""}`} style={{ alignSelf: "flex-start" }} onClick={() => setOpen(!open)}>
        {open ? t("Kapat", "Close") : t("Kontratları gör", "View contracts")} <Icon name={open ? "x" : "arrow"} size={15} />
      </button>
      {open && <ContractIdeas ticker={sym} s={s} risk="balanced" horizon="1w" budget={null} noEarnings={false} />}
    </div>
  );
}

function Details({ d, sym, setExp }: { d: any; sym: string; exp?: string | null; setExp: (e: string) => void }) {
  const t = useT();
  const m = d.metrics;
  const g = d.gex;
  const spot = m.price;
  const ivh = (d.iv_history as any[]).filter((x) => x.iv30 != null);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Card>
        <div className="stats-row">
          <Stat k="IV30" info="iv30" v={vol(m.iv30)} d={`IV1Y ${vol(m.iv1y)}`} />
          <Stat k="IV Pos" info="ivpos" v={`${num(m.iv_pos, 0)}${m.iv_pos_source === "hv" ? "≈" : ""}`} d={m.iv_rank != null ? `IV Rank ${num(m.iv_rank, 0)}` : t(`${m.iv_hist_n} gün geçmiş`, `${m.iv_hist_n} days of history`)} />
          <Stat k="HV30" info="hv30" v={vol(m.hv30)} d={`HV10 ${vol(m.hv10)} · 1Y ${vol(m.hv1y)}`} />
          <Stat k="IV/HV" info="vrp" v={num(m.vrp)} />
          <Stat k="Skew" info="skew" v={num(m.skew)} d={`25Δ P ${vol(m.p25)} · C ${vol(m.c25)}`} />
          <Stat k="RSI" info="rsi" v={num(m.rsi14, 0)} d={t(`Zirveden ${spct(m.dd_from_high, 0)}`, `${spct(m.dd_from_high, 0)} from high`)} />
        </div>
      </Card>
      <div className="grid g2">
        <Card title={t("Vade yapısı", "Term structure")} info="term">
          <LineChart height={220} legend={false}
            series={[{ name: "ATM IV", color: "var(--series-1)", points: (d.term as any[]).map((x) => ({ x: x.dte, y: x.iv * 100 })) }]}
            xFmt={(x) => `${Math.round(x)}${t("g", "d")}`} yFmt={(y) => num(y, 0)}
            tipTitle={(x) => { const q = (d.term as any[]).find((z) => z.dte === x); return q ? `${dateTR(q.expiry, true)} · ${x}${t("g", "d")}` : String(x); }} />
        </Card>
        <Card title={t("Volatilite gülümsemesi", "Volatility smile")} info="skew" right={
          <select className="select sm" value={d.selected_expiry || ""} onChange={(e) => setExp(e.target.value)}>
            {(d.expiries as any[]).filter((e) => e.dte >= 1).map((e) => <option key={e.expiry} value={e.expiry}>{dateTR(e.expiry)} · {e.dte}{t("g", "d")}</option>)}
          </select>
        }>
          <LineChart height={220} legend={false}
            series={[{ name: "IV", color: "var(--series-1)", points: (d.smile as any[]).map((q) => ({ x: q.strike, y: q.iv * 100 })) }]}
            vlines={[{ x: spot, label: t("Fiyat", "Price") }]} xFmt={(x) => num(x, x >= 100 ? 0 : 1)} yFmt={(y) => num(y, 0)} />
        </Card>
        <Card title={t("Açık pozisyon (≤60 gün)", "Open interest (≤60 days)")} info="walls" hint={`${t("Put duvarı", "Put wall")} ${num(g.put_wall, 0)} · ${t("Call duvarı", "Call wall")} ${num(g.call_wall, 0)}`}>
          <StrikeBars data={(d.oi_by_strike as any[]).map((r) => ({ x: r.strike, up: r.call_oi, down: r.put_oi }))}
            up={{ name: "Call OI", color: "var(--series-1)" }} down={{ name: "Put OI", color: "var(--series-2)" }}
            spot={spot} fmt={(v) => compact(v)} xFmt={(x) => strike(x)} />
        </Card>
        <Card title={t("Gamma pozisyonu (≤60 gün)", "Gamma exposure (≤60 days)")} info="gex" hint={`${g.total >= 0 ? "+" : "−"}$${compact(Math.abs(g.total))} · ${t("dönüş", "flip")} ${num(g.flip, 1)}`}>
          <StrikeBars data={(g.by_strike as any[]).map((r) => ({ x: r.strike, v: r.gex }))}
            signed={{ pos: "var(--div-pos)", neg: "var(--div-neg)", name: "GEX" }} spot={spot}
            markers={g.flip ? [{ x: g.flip, label: t("dönüş", "flip") }] : []} fmt={(v) => `$${compact(v)}`} xFmt={(x) => strike(x)} />
        </Card>
        {ivh.length >= 2 && (
          <Card title={t("IV geçmişi", "IV history")}>
            <LineChart height={220} series={[
              { name: "IV30", color: "var(--series-1)", points: ivh.map((x, i) => ({ x: i, y: x.iv30 * 100 })) },
              { name: "HV30", color: "var(--series-2)", points: ivh.map((x, i) => ({ x: i, y: x.hv30 != null ? x.hv30 * 100 : null })) },
            ]} xFmt={(i) => dateTR(ivh[Math.round(i)]?.date)} yFmt={(y) => num(y, 0)} />
          </Card>
        )}
        <Card title={t("Vadeye göre beklenen hareket", "Expected move by expiry")} info="em" flush>
          <Table<any> rows={d.expected_moves} rowKey={(r) => r.expiry} compact cols={[
            { key: "e", label: t("Vade", "Expiry"), left: true, render: (r) => `${dateTR(r.expiry)} · ${r.dte}${t("g", "d")}` },
            { key: "iv", label: "ATM IV", render: (r) => vol(r.iv) },
            { key: "m", label: t("Hareket", "Move"), render: (r) => `±${pct(r.move_pct)}` },
            { key: "r", label: t("Aralık", "Range"), render: (r) => <><span className="neg">{num(r.low)}</span> – <span className="pos">{num(r.high)}</span></> },
          ]} />
        </Card>
      </div>
      <Card title={t("Olağandışı işlemler", "Unusual activity")} info="unusual" flush>
        <Table<any> rows={d.unusual} rowKey={(r) => r.symbol} compact empty={t("Bugün olağandışı işlem yok.", "No unusual activity today.")} cols={[
          { key: "c", label: t("Kontrat", "Contract"), left: true, render: (r) => <><strong>{dateTR(r.expiry)} {strike(r.strike)} {r.cp === "C" ? "CALL" : "PUT"}</strong> <span className="muted">· {r.dte}{t("g", "d")}</span></> },
          { key: "v", label: t("Hacim", "Volume"), render: (r) => int(r.volume), sort: (r) => r.volume },
          { key: "o", label: "OI", render: (r) => int(r.oi), sort: (r) => r.oi },
          { key: "p", label: t("Prim", "Premium"), render: (r) => `$${compact(r.premium)}`, sort: (r) => r.premium },
          { key: "s", label: t("Taraf", "Side"), render: (r) => <Pill tone={r.side === "buy" ? "green" : r.side === "sell" ? "red" : undefined}>{r.side === "buy" ? t("alış", "buy") : r.side === "sell" ? t("satış", "sell") : t("orta", "mid")}</Pill> },
        ]} />
      </Card>
      <p className="small muted">{t(`Max pain: `, `Max pain: `)}{(d.max_pain as any[]).map((x) => `${dateTR(x.expiry)} ${strike(x.strike)}`).join(" · ")}<Info k="maxpain" /></p>
      <div><button className="btn sm" onClick={() => go(`/tools?tab=anomalies&tickers=${sym}`)}>{t("Bu hisse için anomali tara", "Scan this stock for anomalies")}</button></div>
    </div>
  );
}

export default function Stock({ sym }: { sym: string }) {
  const t = useT();
  const pro = usePro();
  const [exp, setExp] = useState<string | null>(null);
  const { data: d, error, loading, reload } = useApi<any>(`/ticker/${sym}${exp ? `?expiry=${exp}` : ""}`, [sym]);

  if (loading && !d) return <div className="stack"><Skeleton h={60} /><Skeleton h={220} n={2} cols={2} /><Skeleton h={200} n={3} cols={3} /></div>;
  if (error) return <ErrorBox error={`${sym}: ${error}`} onRetry={reload} />;
  if (!d) return null;
  const m = d.metrics;
  const prices = d.prices as any[];
  const lines = commentary(m, d, t);

  return (
    <div>
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="kicker"><a href="#/ideas" className="row" style={{ gap: 6, color: "inherit" }}><Icon name="bulb" size={15} /> {t("Fikirler", "Ideas")}</a> / {sym}</div>
          <div className="row" style={{ gap: 14, alignItems: "baseline" }}>
            <h1>{sym}</h1>
            {m.name && <span className="display" style={{ fontSize: 22, color: "var(--muted)" }}>{m.name}</span>}
          </div>
          <div className="row mt8" style={{ gap: 12 }}>
            <span className="num" style={{ fontSize: 22, fontWeight: 650 }}>{usd(m.price)}</span>
            <span className={`num ${cls(m.change_pct)}`}>{spct(m.change_pct)}</span>
            {pro && <SignalPill s={m.signal} />}
            {m.earnings && <Pill tone={m.days_to_earnings <= 14 ? "amber" : undefined}><Icon name="calendar" size={13} /> {t("Bilanço", "Earnings")} {dateTR(m.earnings)}</Pill>}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => go(`/tools?tab=lab&ticker=${sym}`)}><Icon name="flask" size={16} /> {t("Laboratuvarda aç", "Open in the lab")}</button>
        </div>
      </div>

      <div className="grid g-note">
        <div className="card">
          <h3 style={{ fontSize: 17, marginBottom: 14 }}>{t(`Opsiyonlar ${sym} hakkında ne söylüyor?`, `What are options saying about ${sym}?`)}</h3>
          <ul className="bullets">{lines.map((l, i) => <li key={i}><Icon name={l.icon} size={18} /> <span>{l.text}</span></li>)}</ul>
        </div>
        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <div className="row" style={{ gap: 6 }}><strong>{t("Önümüzdeki 30 gün için beklenen aralık", "Expected range for the next 30 days")}</strong><Info k="em" /></div>
            {m.em30_low && <RangeBar low={m.em30_low} high={m.em30_high} price={m.price} fmt={(x) => usd(x, x >= 100 ? 0 : 2)} />}
            <p className="small muted mt8">{t(`Opsiyonlara göre fiyat ~%68 olasılıkla bu bantta (±${pct(m.em30_pct)}) kalır.`, `Options imply a ~68% chance the price stays in this band (±${pct(m.em30_pct)}).`)}</p>
          </div>
          <div className="card">
            <div className="row-between"><span className="row" style={{ gap: 6 }}><strong>{t("Opsiyonlar ne kadar pahalı?", "How expensive are options?")}</strong><Info k="ivpos" /></span>
              <span className="num muted">{num(m.iv_pos, 0)}{m.iv_pos_source === "hv" ? "≈" : ""}/100</span></div>
            <div className="mt12"><Gauge value={m.iv_pos} left={t("Ucuz · almak için iyi", "Cheap · good to buy")} right={t("Pahalı · satmak için iyi", "Pricey · good to sell")}
              colors={["var(--violet-bg)", "var(--surface-3)", "var(--green-bg)"]} /></div>
          </div>
        </div>
      </div>

      <div className="section">
        <SectionHead title={t(`${sym} ile ne yapabilirsin?`, `What can you do with ${sym}?`)} sub={t("Her strateji için bugünün en uygun kontratı ve nedenleri.", "Today's best-fitting contract for each strategy, and why.")} />
        <div className="grid g3">
          {(["csp", "cc", "leaps"] as Strat[]).map((s) => <StrategyBox key={s} m={m} s={s} sym={sym} />)}
        </div>
      </div>

      <div className="section">
        <SectionHead title={t("Son bir yıl", "The past year")} sub={t("Kesikli çizgiler: önümüzdeki 30 gün için beklenen aralık.", "Dashed lines: the expected range for the next 30 days.")} />
        <Card>
          <LineChart height={240} legend={false}
            series={[{ name: sym, color: "var(--series-1)", points: prices.map((p, i) => ({ x: i, y: p.close })) }]}
            hlines={[{ y: m.em30_high, label: `+1σ ${num(m.em30_high)}` }, { y: m.em30_low, label: `−1σ ${num(m.em30_low)}` }]}
            xFmt={(i) => dateTR(prices[Math.round(i)]?.date)} yFmt={(y) => num(y, y >= 100 ? 0 : 1)} tipTitle={(i) => dateTR(prices[i]?.date, true)} />
        </Card>
      </div>

      <div className="section">
        {pro ? (
          <>
            <SectionHead title={t("Detaylı analiz", "Detailed analysis")} />
            <Details d={d} sym={sym} exp={exp} setExp={setExp} />
          </>
        ) : (
          <Disclosure summary={t("Detaylı analizi göster (grafikler, açık pozisyon, gamma)", "Show detailed analysis (charts, open interest, gamma)")}>
            <Details d={d} sym={sym} exp={exp} setExp={setExp} />
          </Disclosure>
        )}
      </div>
    </div>
  );
}
