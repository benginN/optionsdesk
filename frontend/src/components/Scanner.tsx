// Uzman modu: çoklu hisse, 5 strateji, ayrıntılı filtreler ve tablo.
import { useState } from "react";
import { api, usePersisted } from "../lib/api";
import { dateTR, int, num, pct, spct, strike, susd, usd, usd0, vol } from "../lib/format";
import { useT } from "../prefs";
import { Col, Table } from "./Table";
import { Card, ErrorBox, Field, Loading, Seg, TickerLink, Toggle, Verdict } from "./ui";
import { toJournal, toLab } from "./ContractActions";

type S = "csp" | "cc" | "pcs" | "ccs" | "leaps";
const DEFAULTS: Record<S, Record<string, any>> = {
  csp: { dte_min: 4, dte_max: 21, delta_min: 0.1, delta_max: 0.35, min_oi: 50, max_spread_pct: 0.2, min_premium: 5, max_capital: "", exclude_earnings: false },
  cc: { dte_min: 4, dte_max: 21, delta_min: 0.08, delta_max: 0.3, min_oi: 50, max_spread_pct: 0.2, min_premium: 5, max_capital: "", exclude_earnings: false },
  pcs: { dte_min: 7, dte_max: 45, delta_min: 0.15, delta_max: 0.35, min_oi: 50, max_spread_pct: 0.2, min_premium: 10, max_capital: "", max_width: "", exclude_earnings: false },
  ccs: { dte_min: 7, dte_max: 45, delta_min: 0.15, delta_max: 0.35, min_oi: 50, max_spread_pct: 0.2, min_premium: 10, max_capital: "", max_width: "", exclude_earnings: false },
  leaps: { dte_min: 300, dte_max: 1000, delta_min: 0.55, delta_max: 0.9, min_oi: 10, max_spread_pct: 0.12, min_premium: 0, max_capital: "", exclude_earnings: false },
};

export default function Scanner({ initial }: { initial?: S }) {
  const t = useT();
  const [st, setSt] = usePersisted("pro-scanner", { s: (initial || "csp") as S, tickers: "", top: 25, perTicker: 3, filters: DEFAULTS[initial || "csp"] as Record<string, any> });
  const [res, setRes] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const f = st.filters;
  const setF = (k: string, v: any) => setSt({ ...st, filters: { ...f, [k]: v } });

  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      setRes(await api("/scan", { json: { strategy: st.s, tickers: st.tickers.split(/[\s,]+/).filter(Boolean), top: st.top, per_ticker: st.perTicker, filters: f } }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const contract = (r: any) => (
    <span>{dateTR(r.expiry)} <strong>{strike(r.strike)}{r.cp}</strong>{r.long_strike !== undefined && <> / {strike(r.long_strike)}{r.cp}</>}
      <span className="muted"> · {r.dte}{t("g", "d")}</span>{r.earnings && <span className="warn" title={t("Vadede bilanço", "Earnings before expiry")}> ●</span>}</span>
  );
  const actions: Col<any> = {
    key: "act", label: "", render: (r) => (
      <span className="row" style={{ gap: 2, flexWrap: "nowrap" }}>
        <button className="btn xs ghost" onClick={(e) => { e.stopPropagation(); toLab(r); }}>{t("Simüle et", "Simulate")}</button>
        <button className="btn xs ghost" onClick={(e) => { e.stopPropagation(); toJournal(r); }}>{t("Kaydet", "Log")}</button>
      </span>
    ),
  };
  const base: Col<any>[] = [
    { key: "ticker", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} sub={usd(r.spot)} />, sort: (r) => r.ticker },
    { key: "c", label: t("Kontrat", "Contract"), left: true, render: contract, sort: (r) => r.dte },
  ];
  let cols: Col<any>[];
  const s = res?.strategy as S | undefined;
  if (s === "csp" || s === "cc") {
    cols = [...base,
      { key: "otm", label: t("Uzaklık", "OTM"), render: (r) => spct(r.otm_pct, 1), sort: (r) => Math.abs(r.otm_pct) },
      { key: "prem", label: t("Prim", "Premium"), info: "fill", render: (r) => <><strong>{num(r.premium)}</strong><div className="small muted">{num(r.bid)} / {num(r.ask)}</div></>, sort: (r) => r.premium },
      { key: "y", label: t("Getiri", "Yield"), info: "yield", render: (r) => <>{pct(r.yield, 2)}<div className="small muted">{t("yıllık", "ann.")} {pct(r.ann, 0)}</div></>, sort: (r) => r.ann },
      { key: "d", label: "Δ", info: "delta", render: (r) => num(Math.abs(r.delta), 2), sort: (r) => Math.abs(r.delta) },
      { key: "pop", label: "POP", info: "pop", render: (r) => pct(r.pop, 0), sort: (r) => r.pop },
      { key: "touch", label: t("Dokunma", "Touch"), info: "ptouch", render: (r) => pct(r.p_touch, 0), sort: (r) => r.p_touch, hideSm: true },
      { key: "edge", label: t("Risk primi", "Edge"), info: "edge", render: (r) => <span className={r.edge > 0 ? "pos" : "neg"}>{susd(r.edge * 100, 0)}</span>, sort: (r) => r.edge },
      { key: "iv", label: "IV", info: "resid", render: (r) => <>{vol(r.iv)}<div className="small muted">{r.iv_resid != null ? `${r.iv_resid > 0 ? "+" : ""}${vol(r.iv_resid)} smile` : ""}</div></>, sort: (r) => r.iv_resid, hideSm: true },
      { key: "liq", label: "Spread · OI", info: "spread", render: (r) => <>{pct(r.spread_pct, 0)}<div className="small muted">{int(r.oi)}</div></>, sort: (r) => r.spread_pct, hideSm: true },
      { key: "be", label: t("Başabaş", "Breakeven"), render: (r) => <>{num(r.breakeven)}<div className="small muted">{spct(r.be_pct, 1)}</div></>, sort: (r) => r.be_pct, hideSm: true },
      { key: "cap", label: t("Teminat", "Capital"), render: (r) => usd0(r.capital), sort: (r) => r.capital, hideSm: true },
      { key: "score", label: t("Skor", "Score"), render: (r) => <Verdict s={r.score} parts={r.parts} />, sort: (r) => r.score },
      actions];
  } else if (s === "pcs" || s === "ccs") {
    cols = [...base,
      { key: "w", label: t("Genişlik", "Width"), render: (r) => strike(r.width), sort: (r) => r.width },
      { key: "cr", label: t("Kredi", "Credit"), render: (r) => <strong>{num(r.premium)}</strong>, sort: (r) => r.premium },
      { key: "ml", label: t("Maks. kayıp", "Max loss"), render: (r) => usd0(r.max_loss), sort: (r) => r.max_loss },
      { key: "roc", label: t("Getiri", "Return"), render: (r) => <>{pct(r.yield, 1)}<div className="small muted">{t("yıllık", "ann.")} {pct(r.ann, 0)}</div></>, sort: (r) => r.yield },
      { key: "pop", label: "POP", info: "pop", render: (r) => pct(r.pop, 0), sort: (r) => r.pop },
      { key: "ev", label: t("Risk primi", "Edge"), info: "edge", render: (r) => <span className={r.ev > 0 ? "pos" : "neg"}>{susd(r.ev, 0)}</span>, sort: (r) => r.ev },
      { key: "score", label: t("Skor", "Score"), render: (r) => <Verdict s={r.score} parts={r.parts} />, sort: (r) => r.score },
      actions];
  } else {
    cols = [...base,
      { key: "p", label: t("Fiyat", "Price"), render: (r) => <><strong>{num(r.premium)}</strong><div className="small muted">{usd0(r.capital)}</div></>, sort: (r) => r.capital },
      { key: "disc", label: t("Hisseye göre", "vs stock"), render: (r) => <span className="pos">−{pct(r.discount, 0)}</span>, sort: (r) => r.discount },
      { key: "d", label: "Δ", render: (r) => num(r.delta, 2), sort: (r) => r.delta },
      { key: "ext", label: t("Zaman değeri/yıl", "Time value/yr"), info: "extrinsic", render: (r) => pct(r.extrinsic_pct_yr, 1), sort: (r) => r.extrinsic_pct_yr },
      { key: "be", label: t("Başabaş", "Breakeven"), render: (r) => <>{num(r.breakeven)}<div className="small muted">{spct(r.be_pct, 0)}</div></>, sort: (r) => r.be_pct },
      { key: "lev", label: t("Kaldıraç", "Leverage"), render: (r) => `${num(r.leverage, 1)}×`, sort: (r) => r.leverage, hideSm: true },
      { key: "score", label: t("Skor", "Score"), render: (r) => <Verdict s={r.score} parts={r.parts} />, sort: (r) => r.score },
      actions];
  }

  return (
    <div className="stack">
      <Card>
        <div className="stack" style={{ gap: 14 }}>
          <Seg<S> value={st.s} onChange={(v) => setSt({ ...st, s: v, filters: DEFAULTS[v] })} options={[
            { v: "csp", l: "CSP" }, { v: "cc", l: "Covered call" }, { v: "pcs", l: t("Put spread", "Put spread") }, { v: "ccs", l: t("Call spread", "Call spread") }, { v: "leaps", l: "LEAPS" },
          ]} />
          <div className="form-grid">
            <Field label={t("Hisseler (boşsa en iyiler)", "Tickers (blank = top ranked)")}>
              <input className="input" placeholder="IREN, SOFI" value={st.tickers} onChange={(e) => setSt({ ...st, tickers: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t("Evrenden", "From universe")}>
              <select className="select" value={st.top} onChange={(e) => setSt({ ...st, top: Number(e.target.value) })}>
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{t(`İlk ${n}`, `Top ${n}`)}</option>)}
              </select>
            </Field>
            <Field label={t("Hisse başına", "Per stock")}>
              <select className="select" value={st.perTicker} onChange={(e) => setSt({ ...st, perTicker: Number(e.target.value) })}>
                {[1, 3, 5, 0].map((n) => <option key={n} value={n}>{n || t("Sınırsız", "Unlimited")}</option>)}
              </select>
            </Field>
            <Field label={t("Vade (gün)", "DTE")} info="dte">
              <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <input className="input" type="number" value={f.dte_min} onChange={(e) => setF("dte_min", e.target.value)} />
                <input className="input" type="number" value={f.dte_max} onChange={(e) => setF("dte_max", e.target.value)} />
              </div>
            </Field>
            <Field label="|Delta|" info="delta">
              <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <input className="input" type="number" step="0.01" value={f.delta_min} onChange={(e) => setF("delta_min", e.target.value)} />
                <input className="input" type="number" step="0.01" value={f.delta_max} onChange={(e) => setF("delta_max", e.target.value)} />
              </div>
            </Field>
            <Field label={t("Min. OI", "Min OI")} info="oi"><input className="input" type="number" value={f.min_oi} onChange={(e) => setF("min_oi", e.target.value)} /></Field>
            <Field label={t("Maks. spread %", "Max spread %")} info="spread">
              <input className="input" type="number" value={Math.round(Number(f.max_spread_pct) * 100)} onChange={(e) => setF("max_spread_pct", Number(e.target.value) / 100)} />
            </Field>
            <Field label={t("Maks. sermaye $", "Max capital $")}><input className="input" type="number" placeholder="∞" value={f.max_capital} onChange={(e) => setF("max_capital", e.target.value)} /></Field>
            <Field label={t("Min. prim $", "Min premium $")}><input className="input" type="number" value={f.min_premium} onChange={(e) => setF("min_premium", e.target.value)} /></Field>
          </div>
          <div className="row-between">
            <Toggle checked={!!f.exclude_earnings} onChange={(v) => setF("exclude_earnings", v)} label={t("Vadede bilanço olanları çıkar", "Skip contracts spanning earnings")} />
            <div className="row">
              <button className="btn" onClick={() => setSt({ ...st, filters: DEFAULTS[st.s] })}>{t("Sıfırla", "Reset")}</button>
              <button className="btn primary" onClick={run} disabled={loading}>{loading ? t("Taranıyor…", "Scanning…") : t("Tara", "Scan")}</button>
            </div>
          </div>
        </div>
      </Card>
      {err && <ErrorBox error={err} />}
      {loading && <Loading text={t("Zincirler taranıyor (hisse başına ~1,5 sn)…", "Scanning chains (~1.5s per stock)…")} />}
      {res && !loading && (
        <Card flush title={t(`${res.total} kontrat · ${res.tickers.length} hisse`, `${res.total} contracts · ${res.tickers.length} stocks`)}>
          <Table<any> rows={res.rows} cols={cols} rowKey={(r) => `${r.symbol}-${r.long_strike ?? ""}`} initialSort="score" maxRows={100} />
        </Card>
      )}
    </div>
  );
}
