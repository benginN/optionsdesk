import { useEffect, useMemo, useState } from "react";
import { legsParam } from "../components/ContractActions";
import { Col, Table } from "../components/Table";
import { Callout, Card, ErrorBox, Field, Info, Loading, Pill, TickerLink } from "../components/ui";
import { api, usePersisted } from "../lib/api";
import { dateTR, int, num, pct, spct, strike, susd, vol } from "../lib/format";
import { go } from "../lib/router";
import { useT } from "../prefs";

export default function Anomalies({ query }: { query: URLSearchParams }) {
  const t = useT();
  const [p, setP] = usePersisted("anomaly", { tickers: "SPY, QQQ, IWM, SPX", minProfit: 0.03 });
  const [res, setRes] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (tickers = p.tickers) => {
    setLoading(true);
    setErr(null);
    try {
      const tk = tickers.split(/[\s,]+/).filter(Boolean).join(",");
      setRes(await api(`/anomalies?tickers=${encodeURIComponent(tk)}&min_profit=${p.minProfit}`));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const tk = query.get("tickers");
    if (tk) { setP({ ...p, tickers: tk }); run(tk); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.get("tickers")]);

  const arbs = useMemo(() => (res?.results || []).flatMap((r: any) => r.arbitrage.map((a: any) => ({ ...a, ticker: r.ticker }))), [res]);
  const boxRows = useMemo(() => (res?.results || []).flatMap((r: any) => (r.box_rates || []).map((b: any) => ({ ...b, ticker: r.ticker, rf: r.rate }))), [res]);
  const smiles = useMemo(() => (res?.results || []).flatMap((r: any) => r.smile.map((a: any) => ({ ...a, ticker: r.ticker, spot: r.spot }))), [res]);
  const qTone: Record<string, any> = { iyi: "green", orta: "amber", şüpheli: "red" };
  const qTr = (q: string) => ({ iyi: t("iyi", "good"), orta: t("orta", "fair"), şüpheli: t("şüpheli", "suspect") }[q] || q);
  const simulate = (r: any) => {
    const leg = { cp: r.cp, strike: r.strike, expiry: r.expiry, side: r.resid > 0 ? "sell" : "buy", qty: 1, price: r.mid };
    go(`/tools?tab=lab&ticker=${r.ticker}&legs=${legsParam([leg])}`);
  };

  const arbCols: Col<any>[] = [
    { key: "t", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} />, sort: (r) => r.ticker },
    { key: "type", label: t("Tür", "Type"), left: true, render: (r) => <span className="row" style={{ gap: 5 }}>{r.title}<Info text={r.note} /></span>, sort: (r) => r.type },
    { key: "exp", label: t("Vade", "Expiry"), left: true, render: (r) => <>{dateTR(r.expiry)}{r.expiry2 ? ` → ${dateTR(r.expiry2)}` : ""}</>, sort: (r) => r.dte },
    { key: "legs", label: t("Bacaklar", "Legs"), left: true, render: (r) => <span className="small">{r.legs.join(" · ")}</span> },
    { key: "tot", label: t("Kâr / set", "Profit / set"), render: (r) => <strong className="pos">{susd(r.profit_total)}</strong>, sort: (r) => r.profit_total },
    { key: "q", label: t("Kotasyon", "Quotes"), render: (r) => <Pill tone={qTone[r.quality]}>{qTr(r.quality)}</Pill> },
  ];
  const smileCols: Col<any>[] = [
    { key: "t", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} />, sort: (r) => r.ticker },
    { key: "c", label: t("Kontrat", "Contract"), left: true, render: (r) => <>{dateTR(r.expiry)} <strong>{strike(r.strike)} {r.cp === "C" ? "call" : "put"}</strong> <span className="muted">· {r.dte}{t("g", "d")}</span></>, sort: (r) => r.dte },
    { key: "iv", label: t("IV → komşuları", "IV → neighbors"), info: "resid", render: (r) => <>{vol(r.iv)} → {vol(r.fitted_iv)}</> },
    { key: "r", label: t("Sapma", "Deviation"), render: (r) => <span className={r.resid > 0 ? "pos" : "neg"}>{r.rel > 0 ? "+" : ""}{num(r.rel * 100, 1)}%</span>, sort: (r) => Math.abs(r.rel) },
    { key: "e", label: t("Alış-satış fiyatıyla avantaj", "Edge at bid/ask"), render: (r) => <span className={r.exec_edge > 0 ? "pos" : "muted"}>{susd(r.exec_edge, 0)}</span>, sort: (r) => r.exec_edge },
    { key: "liq", label: "Spread · OI", render: (r) => <>{pct(r.spread_pct, 0)} · {int(r.oi)}</>, hideSm: true },
    {
      key: "a", label: "", left: true, render: (r) => (
        <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <Pill tone={r.resid > 0 ? "green" : "blue"}>{r.resid > 0 ? t("Pahalı → sat", "Rich → sell") : t("Ucuz → al", "Cheap → buy")}</Pill>
          {r.executable ? <Pill tone="amber">{t("işlem yapılabilir", "tradeable")}</Pill> : <span className="muted small">{t("fark içinde", "within spread")}</span>}
          <button className="btn xs ghost" onClick={() => simulate(r)}>{t("Simüle et", "Simulate")}</button>
        </span>
      ),
    },
  ];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Callout tone="info" icon="radar">
        <strong>{t("Arbitraj nedir?", "What is arbitrage?")}</strong>{" "}
        {t("Opsiyon fiyatları birbirleriyle matematiksel olarak tutarlı olmak zorundadır. Bu tutarlılık bozulursa risksiz kâr kilitlenebilir. Bu araç bu tür hataları ve komşularına göre pahalı/ucuz kalmış kontratları arar.",
          "Option prices have to be mathematically consistent with each other. When that breaks, a risk-free profit can be locked in. This tool hunts for those errors and for contracts that are rich or cheap versus their neighbors.")}
      </Callout>
      <Card>
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field label={t("Hisseler / endeksler (en fazla 20)", "Stocks / indexes (up to 20)")}>
              <input className="input" value={p.tickers} onChange={(e) => setP({ ...p, tickers: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          <div style={{ width: 170 }}>
            <Field label={t("Min. kâr / hisse ($)", "Min profit / share ($)")}>
              <input className="input" type="number" step="0.01" value={p.minProfit} onChange={(e) => setP({ ...p, minProfit: Number(e.target.value) })} />
            </Field>
          </div>
          <button className="btn primary" onClick={() => run()} disabled={loading}>{loading ? t("Taranıyor…", "Scanning…") : t("Tara", "Scan")}</button>
        </div>
      </Card>
      <Callout tone="warn">
        {t("Gerçekçi ol: likit kontratlarda gerçek arbitraj milisaniyeler içinde kapanır. Burada görünen adayların çoğu gecikmeli ya da bayat fiyattan, temettü/ödünç maliyetinden veya erken kullanım riskinden kaynaklanır. Aracı kurumunda canlı fiyatla doğrulamadan işlem yapma.",
          "Be realistic: true arbitrage in liquid contracts closes within milliseconds. Most candidates here come from delayed or stale quotes, dividend/borrow costs or early-exercise risk. Never trade without confirming live prices at your broker.")}
      </Callout>

      {err && <ErrorBox error={err} />}
      {loading && <Loading text={t("Zincirler taranıyor…", "Scanning chains…")} />}
      {res && !loading && (
        <>
          {res.errors?.length > 0 && <Callout tone="warn">{t("Alınamayanlar", "Failed")}: {res.errors.join(" · ")}</Callout>}
          {!res.market_open && (
            <Callout tone="info">{t("Piyasa kapalı: hisse bacaklı kontroller sadece seans içinde çalışır (kapanıştan sonra hisse ve opsiyon fiyatları aynı ana ait değil). Opsiyon-opsiyon kontrolleri kapanış fiyatlarıyla yapıldı.",
              "Market closed: checks involving the stock only run during the session (after the close, stock and option quotes aren't from the same moment). Option-only checks used closing quotes.")}</Callout>
          )}
          <Card title={t("Arbitraj adayları", "Arbitrage candidates")} hint={`${arbs.length}`} flush>
            <Table<any> rows={arbs} cols={arbCols} rowKey={(r, i) => `${r.ticker}-${r.type}-${i}`} initialSort="tot" maxRows={40}
              empty={t("Tutarsızlık bulunamadı. Bu normal: piyasa bu hataları hızla kapatır.", "No inconsistencies found. That's normal: the market closes these gaps fast.")} />
          </Card>
          {boxRows.length > 0 && (
            <Card title={t("Box spread ima edilen faiz", "Box spread implied rate")} flush>
              <p className="small muted" style={{ padding: "0 22px 10px" }}>{t("Box spread vadede tam olarak strike farkını öder; bugünkü maliyeti piyasanın ima ettiği risksiz faizi verir.", "A box spread pays exactly the strike width at expiry; today's cost implies the market's risk-free rate.")}</p>
              <Table<any> rows={boxRows} rowKey={(r) => `${r.ticker}-${r.expiry}`} compact initialSort="rate" maxRows={15} cols={[
                { key: "t", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} />, sort: (r) => r.ticker },
                { key: "e", label: t("Vade", "Expiry"), left: true, render: (r) => `${dateTR(r.expiry)} · ${r.dte}${t("g", "d")}`, sort: (r) => r.dte },
                { key: "rate", label: t("İma edilen faiz", "Implied rate"), render: (r) => pct(r.lend_rate, 2), sort: (r) => r.lend_rate },
                { key: "x", label: t("T-Bill farkı", "vs T-Bill"), render: (r) => <span className={r.lend_rate - r.rf > 0.005 ? "pos" : "muted"}>{spct(r.lend_rate - r.rf, 2)}</span>, sort: (r) => r.lend_rate - r.rf },
              ]} />
            </Card>
          )}
          <Card title={t("Komşularına göre pahalı / ucuz kontratlar", "Contracts rich / cheap vs neighbors")} info="resid" flush>
            <Table<any> rows={smiles} cols={smileCols} rowKey={(r) => `${r.ticker}-${r.expiry}-${r.strike}-${r.cp}`} maxRows={40}
              empty={t("Belirgin sapma yok.", "No meaningful deviations.")} />
          </Card>
        </>
      )}
    </div>
  );
}
