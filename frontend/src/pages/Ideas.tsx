import { useEffect, useMemo, useState } from "react";
import ContractIdeas from "../components/ContractIdeas";
import { Bubble, Icon, STRAT_STYLE } from "../components/Icon";
import Scanner from "../components/Scanner";
import { Col, Table } from "../components/Table";
import { Callout, Card, Disclosure, Empty, ErrorBox, Pill, Seg, SectionHead, Skeleton, Step, TickerLink, Toggle, Verdict } from "../components/ui";
import { useApi, usePersisted } from "../lib/api";
import { cls, dateTR, num, pct, spct, strike, usd, usd0, vol } from "../lib/format";
import { go } from "../lib/router";
import { Horizon, Risk, Strat, explainCandidate, reasons, stratName, stratPitch } from "../lib/story";
import { usePro, useT } from "../prefs";
import { SignalPill } from "./Today";

const BUDGETS = ["0", "2000", "5000", "10000", "25000"];

function capitalOf(r: any, s: Strat): number | null {
  if (s === "csp") return r.csp?.capital ?? null;
  if (s === "cc") return r.cc?.capital ?? null;
  return r.leaps?.cost ?? null;
}

function IdeaCard({ r, s, open, onToggle, prefs }: { r: any; s: Strat; open: boolean; onToggle: () => void; prefs: any }) {
  const t = useT();
  const why = reasons(r, s, t);
  return (
    <div className="card idea" id={`idea-${r.ticker}`} style={open ? { gridColumn: "1 / -1" } : undefined}>
      <div className="idea-top">
        <div style={{ minWidth: 0 }}>
          <a href={`#/stock/${r.ticker}`} style={{ color: "inherit" }}>
            <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
              <h3 style={{ fontSize: 19 }}>{r.ticker}</h3>
              <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{r.name}</span>
            </div>
          </a>
          <div className="small mt4">
            <span className="num" style={{ fontWeight: 600 }}>{usd(r.price)}</span> <span className={cls(r.change_pct)}>{spct(r.change_pct)}</span>
            {r.em30_low && <span className="muted"> · {t("30 günde beklenen", "30-day range")} {usd(r.em30_low, 0)}–{usd(r.em30_high, 0)}</span>}
          </div>
        </div>
        <Verdict s={r.scores?.[s]} parts={r.score_parts?.[s]} />
      </div>
      <p className="idea-sentence">{explainCandidate(r.ticker, r[s], s, t)}</p>
      {why.length > 0 && <div className="chips">{why.map((w) => <Pill key={w.label} tone={w.tone}>{w.label}</Pill>)}</div>}
      <div className="row-between">
        <button className={`btn sm ${open ? "primary" : ""}`} onClick={onToggle}>
          {open ? t("Kapat", "Close") : t("Kontratları gör", "View contracts")} <Icon name={open ? "x" : "arrow"} size={15} />
        </button>
        <a className="link-btn small" href={`#/stock/${r.ticker}`}>{t("Hisse analizi", "Stock analysis")} <Icon name="chevron" size={14} /></a>
      </div>
      {open && (
        <div className="mt8">
          <ContractIdeas ticker={r.ticker} s={s} risk={prefs.risk} horizon={prefs.horizon} budget={prefs.budget} noEarnings={prefs.noEarn} />
        </div>
      )}
    </div>
  );
}

export default function Ideas({ query }: { query: URLSearchParams }) {
  const t = useT();
  const pro = usePro();
  const { data, error, loading, reload } = useApi<any>("/screener");
  const [p, setP] = usePersisted("ideas", { s: "csp" as Strat, budget: "0", risk: "balanced" as Risk, horizon: "1w" as Horizon, noEarn: true, view: "cards" as "cards" | "table" });
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(12);
  const qs = query.get("s") as Strat | null;
  const qt = query.get("t");

  useEffect(() => {
    if (qs && qs !== p.s && ["csp", "cc", "leaps"].includes(qs)) setP({ ...p, s: qs });
    if (qt) setOpen(qt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, qt]);

  // Adresle gelen hisseye, veri yüklendikten sonra kaydır
  useEffect(() => {
    if (!qt || !data) return;
    const tm = window.setTimeout(() => document.getElementById(`idea-${qt}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => window.clearTimeout(tm);
  }, [qt, data]);

  const s = p.s;
  const budget = Number(p.budget) || null;

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    const list = (data.rows as any[])
      .filter((r) => r.scores?.[s] != null && r[s])
      .filter((r) => !budget || (capitalOf(r, s) ?? Infinity) <= budget)
      .filter((r) => (r[s]?.spread_pct ?? 1) <= 0.2)
      .filter((r) => !p.noEarn || !(r.days_to_earnings != null && r.days_to_earnings >= 0 && r.days_to_earnings <= (s === "leaps" ? 0 : r[s]?.dte ?? 0)))
      .sort((a, b) => (b.scores[s] ?? 0) - (a.scores[s] ?? 0));
    // Adresle gelen hisse listede yoksa başa ekle
    if (qt) {
      const i = list.findIndex((r) => r.ticker === qt);
      const item = i >= 0 ? list.splice(i, 1)[0] : (data.rows as any[]).find((r) => r.ticker === qt && r[s]);
      if (item) list.unshift(item);
    }
    return list;
  }, [data, s, budget, p.noEarn, qt]);

  const riskHelp: Record<Risk, string> = {
    cautious: t("Strike fiyattan uzak: prim daha az, atanma ihtimali ~%10–20.", "Strike far from price: less premium, ~10–20% chance of assignment."),
    balanced: t("Orta mesafe: makul prim, atanma ihtimali ~%15–30. Çoğu satıcı burada işlem yapar.", "Middle distance: decent premium, ~15–30% chance of assignment. Where most sellers trade."),
    bold: t("Fiyata yakın: prim yüksek, atanma ihtimali ~%25–40.", "Close to price: high premium, ~25–40% chance of assignment."),
  };
  const leapsRiskHelp: Record<Risk, string> = {
    cautious: t("Derin ITM: hisseye en yakın davranış, daha pahalı ama daha güvenli.", "Deep in the money: behaves most like the stock; pricier but safer."),
    balanced: t("Denge: makul kaldıraç ve makul zaman maliyeti.", "Balanced: reasonable leverage and time cost."),
    bold: t("ATM'ye yakın: ucuz ve yüksek kaldıraçlı, ama değersiz bitme riski daha yüksek.", "Near the money: cheap and leveraged, but more likely to expire worthless."),
  };

  const tableCols: Col<any>[] = [
    { key: "ticker", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} name={r.name} />, sort: (r) => r.ticker },
    { key: "price", label: t("Fiyat", "Price"), render: (r) => <>{usd(r.price)}<div className={`small ${cls(r.change_pct)}`}>{spct(r.change_pct)}</div></>, sort: (r) => r.price },
    { key: "em", label: t("30g aralık", "30d range"), info: "em", render: (r) => <>±{pct(r.em30_pct)}<div className="small muted">{num(r.em30_low)}–{num(r.em30_high)}</div></>, sort: (r) => r.em30_pct },
    { key: "iv", label: "IV30", info: "iv30", render: (r) => vol(r.iv30), sort: (r) => r.iv30 },
    { key: "ivp", label: "IV Pos", info: "ivpos", render: (r) => `${num(r.iv_pos, 0)}${r.iv_pos_source === "hv" ? "≈" : ""}`, sort: (r) => r.iv_pos },
    { key: "vrp", label: "IV/HV", info: "vrp", render: (r) => num(r.vrp), sort: (r) => r.vrp, hideSm: true },
    { key: "rsi", label: "RSI", info: "rsi", render: (r) => num(r.rsi14, 0), sort: (r) => r.rsi14, hideSm: true },
    { key: "skew", label: "Skew", info: "skew", render: (r) => num(r.skew), sort: (r) => r.skew, hideSm: true },
    {
      key: "cand", label: t("Örnek kontrat", "Sample contract"), left: true, sort: (r) => (s === "leaps" ? r.leaps?.extrinsic_pct_yr : r[s]?.ann),
      render: (r) => {
        const c = r[s];
        if (!c) return "—";
        return s === "leaps"
          ? <>{dateTR(c.expiry)} <strong>{strike(c.strike)}C</strong> · {usd0(c.cost)}<div className="small muted">{pct(c.extrinsic_pct_yr)}/{t("yıl", "yr")}</div></>
          : <>{dateTR(c.expiry)} <strong>{strike(c.strike)}{s === "csp" ? "P" : "C"}</strong> @ {num(c.premium)}<div className="small muted">{pct(c.yield, 2)} · Δ {num(Math.abs(c.delta), 2)}</div></>;
      },
    },
    { key: "cap", label: t("Sermaye", "Capital"), render: (r) => usd0(capitalOf(r, s)), sort: (r) => capitalOf(r, s), hideSm: true },
    { key: "sig", label: t("Sinyal", "Signal"), render: (r) => <SignalPill s={r.signal} />, hideSm: true },
    { key: "score", label: t("Skor", "Score"), render: (r) => <Verdict s={r.scores?.[s]} parts={r.score_parts?.[s]} />, sort: (r) => r.scores?.[s] },
  ];

  const prefs = { risk: p.risk, horizon: p.horizon, budget, noEarn: p.noEarn };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker"><Icon name="bulb" size={15} /> {t("Fikirler", "Ideas")}</div>
          <h1>{t("Sana uygun opsiyon fikirleri", "Option ideas that fit you")}</h1>
          <p className="sub">{t("Ne yapmak istediğini seç, tercihlerini belirle; ~200 likit hisse arasından en uygun olanları sade bir dille anlatalım.",
            "Choose what you want to do and set your preferences; we'll pick the best fits from ~200 liquid stocks and explain them plainly.")}</p>
        </div>
      </div>

      <Step n={1}>{t("Ne yapmak istiyorsun?", "What do you want to do?")}</Step>
      <div className="grid g3">
        {(["csp", "cc", "leaps"] as Strat[]).map((k) => {
          const st = STRAT_STYLE[k];
          return (
            <button key={k} className={`choice ${s === k ? "on" : ""}`} onClick={() => { setP({ ...p, s: k }); setOpen(null); setLimit(12); }}>
              <Bubble name={st.icon} color={st.color} bg={st.bg} sm />
              <span>
                <div className="t">{stratName(k, t)}</div>
                <div className="d">{stratPitch(k, t)}</div>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt24">
        <Step n={2}>{t("Tercihlerin", "Your preferences")}</Step>
        <div className="card">
          <div className="grid g3" style={{ gap: 22 }}>
            <div className="field">
              <label>{t("İşlem başına bütçe", "Budget per trade")}</label>
              <Seg value={p.budget} onChange={(v) => setP({ ...p, budget: v })}
                options={BUDGETS.map((b) => ({ v: b, l: b === "0" ? t("Hepsi", "Any") : `$${Number(b) / 1000}k` }))} />
              <span className="help">{s === "csp" ? t("En fazla bu kadar nakit bağlansın (put için strike × 100).", "At most this much cash tied up (strike × 100 for a put).")
                : s === "cc" ? t("Covered call için 100 hisse gerekir.", "A covered call needs 100 shares.") : t("Bir LEAPS kontratının maliyeti.", "The cost of one LEAPS contract.")}</span>
            </div>
            <div className="field">
              <label>{t("Risk tercihin", "Your risk appetite")}</label>
              <Seg value={p.risk} onChange={(v) => setP({ ...p, risk: v })}
                options={[{ v: "cautious", l: t("Temkinli", "Cautious") }, { v: "balanced", l: t("Dengeli", "Balanced") }, { v: "bold", l: t("Cesur", "Bold") }]} />
              <span className="help">{(s === "leaps" ? leapsRiskHelp : riskHelp)[p.risk]}</span>
            </div>
            {s !== "leaps" ? (
              <div className="field">
                <label>{t("Süre", "Timeframe")}</label>
                <Seg value={p.horizon} onChange={(v) => setP({ ...p, horizon: v })}
                  options={[{ v: "1w", l: t("1 hafta", "1 week") }, { v: "2w", l: t("2 hafta", "2 weeks") }, { v: "1m", l: t("1 ay", "1 month") }]} />
                <Toggle checked={p.noEarn} onChange={(v) => setP({ ...p, noEarn: v })} label={<span className="small">{t("Bilanço dönemlerini atla", "Skip earnings periods")}</span>} />
              </div>
            ) : (
              <div className="field">
                <label>{t("Süre", "Timeframe")}</label>
                <p className="small ink2">{t("LEAPS için 1–2,5 yıl vadeli kontratlara bakıyoruz; zaman senin tarafında olsun.", "For LEAPS we look at 1–2.5 year expiries, so time is on your side.")}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt24">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <Step n={3}>{t("Fikirler", "Ideas")} {rows.length > 0 && <span className="muted" style={{ fontWeight: 500 }}>· {rows.length}</span>}</Step>
          {pro && <Seg sm value={p.view} onChange={(v) => setP({ ...p, view: v })} options={[{ v: "cards", l: t("Kartlar", "Cards") }, { v: "table", l: t("Tablo", "Table") }]} />}
        </div>
        {data && data.iv_history_days < 20 && pro && (
          <div className="mb"><Callout tone="info">{t(`IV geçmişi birikiyor (${data.iv_history_days}/20 gün). O zamana kadar "opsiyonlar ne kadar pahalı" ölçüsü tahminidir (≈).`,
            `IV history is building (${data.iv_history_days}/20 days). Until then, the "how expensive are options" measure is an estimate (≈).`)}</Callout><div className="mt16" /></div>
        )}
        {loading && !data ? <Skeleton h={220} n={4} cols={2} /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.rows?.length ? (
          <Card><Empty title={t("Henüz veri yok", "No data yet")}>{t("Sağ üstteki yenile düğmesiyle ilk taramayı başlat.", "Start the first scan with the refresh button at the top right.")}</Empty></Card>
        ) : pro && p.view === "table" ? (
          <Card flush><Table<any> rows={rows} cols={tableCols} rowKey={(r) => r.ticker} initialSort="score" maxRows={60} onRowClick={(r) => go(`/stock/${r.ticker}`)} /></Card>
        ) : rows.length === 0 ? (
          <Card><Empty title={t("Bu tercihlere uyan fikir yok", "No ideas match these preferences")}>{t("Bütçeyi artırmayı ya da bilanço filtresini kapatmayı dene.", "Try a bigger budget or turning off the earnings filter.")}</Empty></Card>
        ) : (
          <>
            <div className="grid g2">
              {rows.slice(0, limit).map((r) => (
                <IdeaCard key={r.ticker} r={r} s={s} open={open === r.ticker} prefs={prefs} onToggle={() => setOpen(open === r.ticker ? null : r.ticker)} />
              ))}
            </div>
            {rows.length > limit && (
              <div style={{ textAlign: "center" }} className="mt16">
                <button className="btn" onClick={() => setLimit(limit + 12)}>{t("Daha fazla göster", "Show more")}</button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="section">
        <Callout tone="warn">
          {t("Bunlar bir sıralama aracıdır, tavsiye değildir. Sadece sahip olmaya razı olduğun hisselerde put sat, pozisyonlarını küçük tut ve işlemden önce aracı kurumundaki canlı fiyatı kontrol et (veriler 15 dk gecikmeli).",
            "These are rankings, not advice. Only sell puts on stocks you'd be happy to own, keep positions small, and check the live price at your broker before trading (data is 15 min delayed).")}
        </Callout>
      </div>

      {pro && (
        <div className="section">
          <SectionHead title={t("Gelişmiş kontrat tarayıcı", "Advanced contract scanner")} sub={t("Çoklu hisse, kredi spread'leri ve tüm filtreler.", "Multiple stocks, credit spreads and every filter.")} />
          <Disclosure summary={t("Tarayıcıyı aç", "Open the scanner")}><Scanner initial={s} /></Disclosure>
        </div>
      )}
    </div>
  );
}
