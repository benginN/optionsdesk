import { useState } from "react";
import type { Status } from "../App";
import { LineChart } from "../components/Charts";
import { Bubble, Icon, STRAT_STYLE } from "../components/Icon";
import { Col, Table } from "../components/Table";
import {
  Callout, Card, Empty, ErrorBox, Gauge, Info, Pill, RangeBar, SectionHead, Skeleton, Stat, TickerLink, md, useVerdict,
} from "../components/ui";
import { useApi, usePersisted } from "../lib/api";
import { cls, compact, dateTR, int, num, pct, spct, strike, usd, usd0, vol } from "../lib/format";
import { go, href } from "../lib/router";
import { Strat, stratName, stratPitch } from "../lib/story";
import { usePrefs, usePro, useT } from "../prefs";

function greeting(t: (a: string, b: string) => string) {
  const h = new Date().getHours();
  if (h < 12) return t("Günaydın", "Good morning");
  if (h < 18) return t("İyi günler", "Good afternoon");
  return t("İyi akşamlar", "Good evening");
}

export function SignalPill({ s }: { s?: { code: string; text: string } }) {
  const t = useT();
  if (!s) return null;
  const map: Record<string, [string, string, any]> = {
    sell_put: ["PUT sat", "Sell puts", "green"], sell_call: ["CALL sat", "Sell calls", "green"], sell: ["Opsiyon sat", "Sell options", "green"],
    buy_leaps: ["LEAPS al", "Buy LEAPS", "violet"], buy: ["Uzun vade al", "Buy long-dated", "blue"], neutral: ["Nötr", "Neutral", undefined], none: ["—", "—", undefined],
  };
  const [tr, en, tone] = map[s.code] || [s.code, s.code, undefined];
  return <Pill tone={tone} title={s.text}>{t(tr, en)}</Pill>;
}

function Welcome() {
  const t = useT();
  const { setMode } = usePrefs();
  const [p, setP] = usePersisted("welcome", { done: false });
  if (p.done) return null;
  const pick = (m: "simple" | "pro") => {
    setMode(m);
    setP({ done: true });
  };
  return (
    <div className="card" style={{ marginBottom: 28, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <Bubble name="sparkle" color="var(--accent)" bg="var(--accent-soft)" />
      <div style={{ flex: 1, minWidth: 240 }}>
        <h3 style={{ fontSize: 17 }}>{t("Hoş geldin! Opsiyonlara ne kadar hakimsin?", "Welcome! How familiar are you with options?")}</h3>
        <p className="muted mt4">{t("Siteyi sana göre ayarlayalım. İstediğin zaman sağ üstteki Basit / Uzman düğmesinden değiştirebilirsin.",
          "Let's tailor the site to you. You can switch any time with the Simple / Pro toggle at the top right.")}</p>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => pick("simple")}>{t("Yeniyim, sade anlat", "I'm new, keep it simple")}</button>
        <button className="btn" onClick={() => pick("pro")}>{t("Biliyorum, tüm verileri göster", "I know my way, show everything")}</button>
      </div>
    </div>
  );
}

function StrategyCard({ s, ideas, hasHoldings }: { s: Strat; ideas: any[]; hasHoldings: boolean }) {
  const t = useT();
  const st = STRAT_STYLE[s];
  const verdict = useVerdict();
  const line = (i: any) => {
    const c = i.c;
    if (!c) return "";
    if (s === "leaps") return t(`$${strike(c.strike)} call · ${usd0(c.cost)} (hisse ${usd0(c.stock_cost)})`, `$${strike(c.strike)} call · ${usd0(c.cost)} (stock ${usd0(c.stock_cost)})`);
    return t(`$${strike(c.strike)} ${s === "csp" ? "put" : "call"} · ${usd0(c.premium * 100)} prim · ${c.dte} gün`,
      `$${strike(c.strike)} ${s === "csp" ? "put" : "call"} · ${usd0(c.premium * 100)} premium · ${c.dte} days`);
  };
  return (
    <div className="card hover" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "nowrap" }}>
        <Bubble name={st.icon} color={st.color} bg={st.bg} />
        <div>
          <div className="muted small">{{ csp: t("Nakitim var", "I have cash"), cc: t("Hissem var", "I own shares"), leaps: t("Uzun vadeli düşünüyorum", "I'm thinking long term"), pcs: "", ccs: "" }[s]}</div>
          <h3 style={{ fontSize: 17, marginTop: 2 }}>{stratName(s, t)}</h3>
          <p className="muted mt4" style={{ fontSize: 13.5 }}>{stratPitch(s, t)}</p>
        </div>
      </div>
      {s === "cc" && !hasHoldings && (
        <p className="small ink2" style={{ background: "var(--surface-2)", padding: "10px 12px", borderRadius: 12 }}>
          {t("Hisselerini Portföyüm'e eklersen sana özel öneriler çıkar. Şimdilik genel en iyi adaylar:", "Add your shares under My portfolio for tailored suggestions. For now, the best general candidates:")}
        </p>
      )}
      <ul className="list-plain" style={{ flex: 1 }}>
        {ideas.slice(0, 3).map((i) => (
          <li key={i.ticker} className="row-between" style={{ cursor: "pointer", flexWrap: "nowrap" }} onClick={() => go(`/ideas?s=${s}&t=${i.ticker}`)}>
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}><strong>{i.ticker}</strong><span className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{i.name}</span></div>
              <div className="small ink2">{line(i)}</div>
            </div>
            <span className="pill" style={{ color: `var(--${verdict(i.score).tone})` }}>{verdict(i.score).label}</span>
          </li>
        ))}
        {!ideas.length && <li className="muted small">{t("Bugün kriterlere uyan aday yok.", "No candidates match today.")}</li>}
      </ul>
      <button className="btn" onClick={() => go(`/ideas?s=${s}`)}>{t("Tüm fikirleri gör", "See all ideas")} <Icon name="arrow" size={16} /></button>
    </div>
  );
}

function IndexCard({ b }: { b: any }) {
  const t = useT();
  const pro = usePro();
  const w = b.em_week;
  const pcr = b.pc?.pcr_oi;
  const mood = pcr == null ? null : pcr > 1.6 ? t("Korunma talebi yüksek", "Heavy hedging demand") : pcr < 0.8 ? t("İyimser pozisyonlanma", "Optimistic positioning") : t("Dengeli pozisyonlanma", "Balanced positioning");
  return (
    <Card>
      <div className="row-between" style={{ alignItems: "baseline" }}>
        <a href={href(`/stock/${b.ticker}`)} style={{ color: "inherit" }}><h3 style={{ fontSize: 17 }}>{b.ticker}</h3></a>
        <span className={`num ${cls(b.change_pct)}`}>{usd(b.price)} · {spct(b.change_pct)}</span>
      </div>
      <p className="small muted mt4">{{ SPY: t("S&P 500", "S&P 500"), QQQ: t("Nasdaq 100", "Nasdaq 100"), IWM: t("Russell 2000 (küçük şirketler)", "Russell 2000 (small caps)") }[b.ticker as "SPY"]}</p>
      {w && (
        <>
          <p className="mt12" style={{ fontSize: 14 }}>
            {t(`${dateTR(w.expiry)} vadesine kadar beklenen hareket: `, `Expected move until ${dateTR(w.expiry)}: `)}<strong>±{pct(w.move_pct)}</strong>
          </p>
          <RangeBar low={w.low} high={w.high} price={b.price} fmt={(x) => num(x, 0)} />
        </>
      )}
      <div className="row mt12" style={{ gap: 6 }}>
        {mood && <Pill>{mood}</Pill>}
        <Pill tone={b.gex_total >= 0 ? "green" : "amber"}>
          {b.gex_total >= 0 ? t("Sakin seyir eğilimi", "Tends to stay calm") : t("Oynak seyir eğilimi", "Tends to swing more")}
        </Pill>
      </div>
      {pro && (
        <div className="kv mt16">
          <span className="k">IV30</span><span className="v">{vol(b.iv30)}</span>
          <span className="k row" style={{ gap: 4 }}>Put/Call OI <Info k="pcr" /></span><span className="v">{num(b.pc?.pcr_oi)}</span>
          <span className="k row" style={{ gap: 4 }}>Skew <Info k="skew" /></span><span className="v">{num(b.skew?.skew)}</span>
          <span className="k row" style={{ gap: 4 }}>Max pain <Info k="maxpain" /></span><span className="v">{num(b.max_pain, 0)}</span>
          <span className="k row" style={{ gap: 4 }}>GEX <Info k="gex" /></span><span className="v">{b.gex_total < 0 ? "−" : "+"}${compact(Math.abs(b.gex_total))}</span>
          <span className="k row" style={{ gap: 4 }}>{t("Dönüş", "Flip")} <Info k="flip" /></span><span className="v">{num(b.gex_flip, 1)}</span>
          <span className="k row" style={{ gap: 4 }}>{t("Put / call duvarı", "Put / call wall")} <Info k="walls" /></span><span className="v">{num(b.put_wall, 0)} / {num(b.call_wall, 0)}</span>
        </div>
      )}
    </Card>
  );
}

function sideTone(side: string) {
  return side === "buy" || side === "alış" ? "buy" : side === "sell" || side === "satış" ? "sell" : "mid";
}

function WatchList({ L }: { L: any }) {
  const t = useT();
  const items: { icon: string; tone: string; text: React.ReactNode; to: string }[] = [];
  for (const e of (L.earnings_soon || []).slice(0, 4)) {
    items.push({
      icon: "calendar", tone: "var(--amber)", to: `/stock/${e.ticker}`,
      text: t(
        `**${e.ticker}**${e.name ? ` (${e.name})` : ""} ${dateTR(e.earnings)} tarihinde bilanço açıklıyor. Opsiyonlar bu hafta ±${pct(e.em, 1)} hareket fiyatlıyor; bilanço öncesi opsiyon almak pahalı, satmak ise risklidir.`,
        `**${e.ticker}**${e.name ? ` (${e.name})` : ""} reports earnings on ${dateTR(e.earnings)}. Options price a ±${pct(e.em, 1)} move this week; buying before earnings is expensive, selling is risky.`,
      ) as any,
    });
  }
  for (const u of (L.unusual || []).slice(0, 4)) {
    const side = sideTone(u.side);
    const kind = u.cp === "C" ? "call" : "put";
    const verb = side === "buy" ? t("alım yapıldı", "bought") : side === "sell" ? t("satış yapıldı", "sold") : t("işlem yapıldı", "traded");
    items.push({
      icon: "flame", tone: "var(--red)", to: `/stock/${u.ticker}`,
      text: t(
        `**${u.ticker}** · ${dateTR(u.expiry)} vadeli **$${strike(u.strike)} ${kind}** kontratlarında **$${compact(u.premium)}** tutarında ${verb} (${int(u.volume)} kontrat, açık pozisyonun ${num(u.vol_oi ?? 0, 1)} katı).`,
        `**$${compact(u.premium)}** of **${u.ticker} $${strike(u.strike)} ${kind}s** expiring ${dateTR(u.expiry)} were ${verb} (${int(u.volume)} contracts, ${num(u.vol_oi ?? 0, 1)}× open interest).`,
      ) as any,
    });
  }
  if (!items.length) return null;
  return (
    <ul className="bullets">
      {items.map((it, i) => (
        <li key={i} style={{ cursor: "pointer" }} onClick={() => go(it.to)}>
          <Icon name={it.icon} size={18} style={{ color: it.tone }} />
          <span>{md(it.text as string)}</span>
        </li>
      ))}
    </ul>
  );
}

function NoteTable({ rows }: { rows: any[] }) {
  const t = useT();
  const fmt = (kind: string, v: number | null) => (v == null ? "—" : kind === "vol" ? vol(v, 2) : kind === "int" ? int(v) : num(v, 2));
  return (
    <table className="t">
      <thead><tr><th className="l">{t("Gösterge", "Metric")}</th><th>{t("Önce", "Before")}</th><th>{t("Sonra", "After")}</th><th>{t("Değişim", "Change")}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="l" style={{ fontWeight: 600 }}>
              <span className="row" style={{ gap: 5 }}>{r.label}<Info k={({ iv30: "iv30", iv1y: "iv1y", hv30: "hv30", vrp: "vrp", skew: "skew", pcr_oi: "pcr", put_oi: "oi", call_oi: "oi" } as any)[r.key]} /></span>
            </td>
            <td>{fmt(r.kind, r.before)}</td>
            <td style={{ fontWeight: 600 }}>{fmt(r.kind, r.after)}</td>
            <td className={r.key === "skew" || r.key === "pcr_oi" ? "warn" : cls(r.change)}>{spct(r.change)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProDetails({ d, live }: { d: any; live: any }) {
  const t = useT();
  const n = d.note;
  const L = d.leaders;
  const series = d.series as any[];
  const vix = live?.vix;
  const base = (extra: Col<any>[]): Col<any>[] => [
    { key: "ticker", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} name={r.name} />, sort: (r) => r.ticker },
    { key: "price", label: t("Fiyat", "Price"), render: (r) => usd(r.price), sort: (r) => r.price },
    { key: "chg", label: t("Gün", "Day"), render: (r) => <span className={cls(r.change_pct)}>{spct(r.change_pct)}</span>, sort: (r) => r.change_pct },
    ...extra,
  ];
  const ivp = (r: any) => `${num(r.iv_pos, 0)}${r.iv_pos_source === "hv" ? "≈" : ""}`;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid g-note">
        <Card flush><div style={{ padding: "4px 8px 8px" }}><NoteTable rows={n.rows} /></div></Card>
        <div className="dark-card">
          <div className="label">{t("Günün opsiyon notu", "Today's options note")}</div>
          {n.summary.map((s: string, i: number) => <p key={i}>{md(s)}</p>)}
          <div className="accent">{n.headline}</div>
          <p>{n.conclusion}</p>
          <span className="small" style={{ color: "var(--dark-card-muted)", marginTop: "auto" }}>
            {t(`Medyan günlük değişim ${spct(d.agg.change)} · yükselen hisse oranı ${pct(d.agg.breadth_up, 0)}`, `Median daily change ${spct(d.agg.change)} · share of stocks up ${pct(d.agg.breadth_up, 0)}`)}
          </span>
        </div>
      </div>
      {vix && (
        <Card title={t("VIX ve vade yapısı", "VIX and term structure")} info="vix">
          <div className="stats-row">
            <Stat k="VIX" v={num(vix.vix)} d={spct(vix.vix_chg)} />
            <Stat k="VIX9D" v={num(vix.vix9d)} d={spct(vix.vix9d_chg)} />
            <Stat k="VIX3M" v={num(vix.vix3m)} d={spct(vix.vix3m_chg)} />
            <Stat k="VVIX" v={num(vix.vvix)} d={spct(vix.vvix_chg)} />
            <Stat k={t("SKEW endeksi", "SKEW index")} v={num(vix.skew_index, 1)} />
          </div>
          {vix.vix_series?.length > 0 && (
            <div className="mt16">
              <LineChart height={160} legend={false}
                series={[{ name: "VIX", color: "var(--series-1)", points: vix.vix_series.map((p: any, i: number) => ({ x: i, y: p.close })) }]}
                xFmt={(i) => dateTR(vix.vix_series[Math.round(i)]?.date)} yFmt={(y) => num(y, 0)} tipTitle={(i) => dateTR(vix.vix_series[i]?.date, true)} />
            </div>
          )}
          {live.vix_note && <p className="mt12 small ink2">{live.vix_note}</p>}
        </Card>
      )}
      {series.length > 1 && (
        <Card title={t("Evren medyanı: IV30 ve HV30", "Universe median: IV30 vs HV30")}>
          <LineChart series={[
            { name: "IV30", color: "var(--series-1)", points: series.map((s, i) => ({ x: i, y: s.iv30 != null ? s.iv30 * 100 : null })) },
            { name: "HV30", color: "var(--series-2)", points: series.map((s, i) => ({ x: i, y: s.hv30 != null ? s.hv30 * 100 : null })) },
          ]} xFmt={(i) => dateTR(series[Math.round(i)]?.date)} yFmt={(y) => num(y, 0)} tipTitle={(i) => dateTR(series[i]?.date, true)} />
        </Card>
      )}
      <div className="grid g2">
        {L.iv_up?.length > 0 && (
          <Card title={t("IV'si en çok artanlar", "Biggest IV increases")} flush>
            <Table<any> rows={L.iv_up} rowKey={(r) => r.ticker} compact initialSort="ivc" cols={base([
              { key: "ivc", label: t("IV değişimi", "IV change"), render: (r) => <span className="pos">{spct(r.iv_change, 1)}</span>, sort: (r) => r.iv_change },
            ])} />
          </Card>
        )}
        <Card title={t("Opsiyonları en pahalı hisseler", "Richest options")} info="ivpos" flush>
          <Table<any> rows={L.iv_pos_high} rowKey={(r) => r.ticker} compact cols={base([
            { key: "ivp", label: "IV Pos", render: ivp, sort: (r) => r.iv_pos },
            { key: "sig", label: t("Sinyal", "Signal"), render: (r) => <SignalPill s={r.signal} /> },
          ])} />
        </Card>
        <Card title={t("Opsiyonları en ucuz hisseler", "Cheapest options")} info="ivpos" flush>
          <Table<any> rows={L.iv_pos_low} rowKey={(r) => r.ticker} compact cols={base([
            { key: "ivp", label: "IV Pos", render: ivp, sort: (r) => r.iv_pos },
            { key: "sig", label: t("Sinyal", "Signal"), render: (r) => <SignalPill s={r.signal} /> },
          ])} />
        </Card>
        <Card title={t("Risk primi en yüksek", "Highest risk premium")} info="vrp" flush>
          <Table<any> rows={L.vrp_high} rowKey={(r) => r.ticker} compact cols={base([
            { key: "iv", label: "IV30", render: (r) => vol(r.iv30), sort: (r) => r.iv30 },
            { key: "vrp", label: "IV/HV", render: (r) => num(r.vrp), sort: (r) => r.vrp },
          ])} />
        </Card>
      </div>
      <Card title={t("Olağandışı opsiyon işlemleri", "Unusual options activity")} info="unusual" flush>
        <Table<any> rows={L.unusual} rowKey={(r) => r.symbol} compact cols={[
          { key: "ticker", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} /> },
          { key: "c", label: t("Kontrat", "Contract"), left: true, render: (r) => <span>{dateTR(r.expiry)} <strong>{strike(r.strike)} {r.cp === "C" ? "CALL" : "PUT"}</strong> <span className="muted">({r.dte}d)</span></span> },
          { key: "mny", label: t("Uzaklık", "Moneyness"), render: (r) => spct(r.moneyness, 1), hideSm: true },
          { key: "vol", label: t("Hacim", "Volume"), render: (r) => int(r.volume), sort: (r) => r.volume },
          { key: "oi", label: "OI", render: (r) => int(r.oi), sort: (r) => r.oi, hideSm: true },
          { key: "prem", label: t("Prim", "Premium"), render: (r) => `$${compact(r.premium)}`, sort: (r) => r.premium },
          { key: "side", label: t("Taraf", "Side"), render: (r) => { const s = sideTone(r.side); return <Pill tone={s === "buy" ? "green" : s === "sell" ? "red" : undefined}>{s === "buy" ? t("alış", "buy") : s === "sell" ? t("satış", "sell") : t("orta", "mid")}</Pill>; } },
        ]} />
      </Card>
    </div>
  );
}

export default function Today({ status }: { status: Status | null }) {
  const t = useT();
  const pro = usePro();
  const note = useApi<any>("/market/note", [status?.latest_snapshot]);
  const live = useApi<any>("/market/live");
  const holdings = useApi<any>("/holdings");
  const [showMore, setShowMore] = useState(false);

  if (note.loading && !note.data) {
    return <div className="stack"><Skeleton h={40} /><Skeleton h={150} n={2} cols={2} /><Skeleton h={260} n={3} cols={3} /></div>;
  }
  if (note.error) return <ErrorBox error={note.error} onRetry={note.reload} />;
  const d = note.data;

  if (!d || d.empty) {
    const p = status?.progress;
    return (
      <div className="stack">
        <Welcome />
        <div className="page-head"><div>
          <div className="kicker">{greeting(t)}</div>
          <h1>{t("Veriler hazırlanıyor", "Getting the data ready")}</h1>
          <p className="sub">{t("~200 hissenin opsiyon verisi ilk kez çekiliyor. Ücretsiz veri kaynağının hız sınırı nedeniyle bu 6–10 dakika sürer; sonra her gün otomatik güncellenir.",
            "Fetching option data for ~200 stocks for the first time. Because of the free data source's rate limit this takes 6–10 minutes; after that it refreshes daily on its own.")}</p>
        </div></div>
        {p?.running && (
          <Card>
            <div className="row-between small muted"><span>{p.current ?? "…"}</span><span className="num">{p.done}/{p.total}</span></div>
            <div className="progress mt8"><div style={{ width: `${(p.done / Math.max(1, p.total)) * 100}%` }} /></div>
          </Card>
        )}
        <Callout tone="info">{t("Bu sırada Öğren bölümüne göz atabilir ya da bir hisseyi (ör. SPY) aratıp canlı inceleyebilirsin.", "Meanwhile, browse the Learn section or search a stock (e.g. SPY) to explore it live.")}</Callout>
      </div>
    );
  }

  const story = d.story;
  const moodTxt: Record<string, [string, string]> = {
    calm: ["Piyasa sakin", "A calm market"], normal: ["Piyasa olağan seyrinde", "A normal market"],
    nervous: ["Piyasa tedirgin", "A nervous market"], fear: ["Piyasada korku var", "A fearful market"],
  };
  const premTxt: Record<string, [string, string]> = {
    rich: ["primler zengin", "rich premiums"], fair: ["primler orta seviyede", "fair premiums"], thin: ["primler ince", "thin premiums"],
  };
  const m = moodTxt[story.mood.code];
  const pr = premTxt[story.premium.code];
  const headline = t(`${m[0]}, ${pr[0]}.`, `${m[1]}, ${pr[1]}.`);
  const boards = live.data?.boards || [];
  const hasHoldings = (holdings.data?.holdings || []).some((h: any) => h.shares >= 100);

  return (
    <div>
      <Welcome />
      <div className="page-head">
        <div>
          <div className="kicker"><Icon name="clock" size={15} /> {greeting(t)} · {t(`${dateTR(d.date, true)} kapanışına göre, ${d.agg.n} hisse incelendi`, `Based on the ${dateTR(d.date, true)} close, ${d.agg.n} stocks reviewed`)}</div>
          <h1>{headline}</h1>
        </div>
      </div>

      <div className="grid g-note">
        <div className="card">
          <ul className="bullets">
            {story.lines.map((l: string, i: number) => (
              <li key={i}><Icon name={["pulse", "cash", "wave"][i] || "info"} size={19} /> <span>{l}</span></li>
            ))}
            {d.note?.headline && d.prev_date && <li><Icon name="sparkle" size={19} /> <span>{d.note.headline} {d.note.conclusion}</span></li>}
          </ul>
        </div>
        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <div className="row-between"><span className="row" style={{ gap: 6 }}><strong>{t("Piyasanın ruh hali", "Market mood")}</strong><Info k="vix" /></span><Pill>{story.mood.label}</Pill></div>
            <div className="mt12"><Gauge value={story.mood.score} left={t("Sakin", "Calm")} right={t("Korku", "Fear")} colors={["var(--green-bg)", "var(--amber-bg)", "var(--red-bg)"]} /></div>
          </div>
          <div className="card">
            <div className="row-between"><span className="row" style={{ gap: 6 }}><strong>{t("Prim satıcısı için ortam", "Conditions for premium sellers")}</strong><Info k="vrp" /></span><Pill tone={story.premium.code === "rich" ? "green" : story.premium.code === "thin" ? "amber" : undefined}>{story.premium.label}</Pill></div>
            <div className="mt12"><Gauge value={story.premium.score} left={t("İnce", "Thin")} right={t("Zengin", "Rich")} colors={["var(--surface-3)", "var(--green-bg)", "var(--green)"]} /></div>
          </div>
        </div>
      </div>

      <div className="section">
        <SectionHead title={t("Bugün ne yapabilirsin?", "What can you do today?")}
          sub={t("Durumuna uyan yolu seç. Her fikir, kısa bir açıklama ve riskleriyle birlikte gelir.", "Pick the path that fits you. Every idea comes with a short explanation and its risks.")} />
        <div className="grid g3">
          {(["csp", "cc", "leaps"] as Strat[]).map((s) => <StrategyCard key={s} s={s} ideas={d.ideas?.[s] || []} hasHoldings={hasHoldings} />)}
        </div>
      </div>

      <div className="section">
        <SectionHead title={t("Endeksler bu hafta ne bekliyor?", "What are the indexes pricing this week?")}
          sub={t("Opsiyon fiyatlarından çıkan beklenen aralık: fiyat büyük ihtimalle bu bandın içinde kalır.", "The expected range implied by option prices: the price will most likely stay inside this band.")} />
        {live.loading && !live.data ? <Skeleton h={200} n={3} cols={3} /> : <div className="grid g3">{boards.map((b: any) => <IndexCard key={b.ticker} b={b} />)}</div>}
      </div>

      <div className="section">
        <SectionHead title={t("Göz kulak ol", "Worth watching")} sub={t("Yaklaşan bilançolar ve günün en büyük opsiyon işlemleri.", "Upcoming earnings and the day's largest option trades.")} />
        <div className="card"><WatchList L={d.leaders} /></div>
      </div>

      <div className="section">
        {pro || showMore ? (
          <>
            <SectionHead title={t("Uzman verileri", "Pro data")} sub={t("Günlük değişim tablosu, VIX, liderler ve tüm olağandışı işlemler.", "Daily change table, VIX, leaders and all unusual activity.")} />
            <ProDetails d={d} live={live.data} />
          </>
        ) : (
          <button className="btn" onClick={() => setShowMore(true)}><Icon name="list" size={16} /> {t("Detaylı verileri göster", "Show detailed data")}</button>
        )}
      </div>

      {!live.data && live.error && <div className="mt16"><ErrorBox error={live.error} onRetry={live.reload} /></div>}
      {d.ideas && !d.ideas.csp?.length && !d.ideas.cc?.length && <Empty>{t("Bugün öne çıkan fikir yok.", "No standout ideas today.")}</Empty>}
    </div>
  );
}
