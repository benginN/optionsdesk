import { useState } from "react";
import { toJournal, toLab } from "../components/ContractActions";
import { Bubble, Icon, STRAT_STYLE } from "../components/Icon";
import { Col, Table } from "../components/Table";
import { Callout, Card, Disclosure, Empty, ErrorBox, Field, Loading, Seg, Stat, TickerLink, Toggle, Verdict } from "../components/ui";
import { api, useApi, usePersisted } from "../lib/api";
import { cls, dateTR, num, pct, spct, strike, susd, usd, usd0 } from "../lib/format";
import { go } from "../lib/router";
import { Horizon, Risk, explainContract } from "../lib/story";
import { usePro, useT } from "../prefs";
import Journal from "./Journal";

function Holdings({ onChange }: { onChange: () => void }) {
  const t = useT();
  const h = useApi<any>("/holdings");
  const [form, setForm] = useState({ ticker: "", shares: "", cost_basis: "" });
  const add = async () => {
    if (!form.ticker || !form.shares) return;
    await api("/holdings", { json: form });
    setForm({ ticker: "", shares: "", cost_basis: "" });
    h.reload();
    onChange();
  };
  const del = async (tk: string) => {
    await api(`/holdings/${tk}`, { method: "DELETE" });
    h.reload();
    onChange();
  };
  const rows = h.data?.holdings || [];
  const cols: Col<any>[] = [
    { key: "t", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} />, sort: (r) => r.ticker },
    { key: "s", label: t("Adet", "Shares"), render: (r) => <>{num(r.shares, 0)}<div className="small muted">{t(`${r.lots} kontratlık`, `${r.lots} contract(s)`)}</div></>, sort: (r) => r.shares },
    { key: "cb", label: t("Maliyet", "Cost"), render: (r) => usd(r.cost_basis), sort: (r) => r.cost_basis },
    { key: "p", label: t("Fiyat", "Price"), render: (r) => usd(r.price), sort: (r) => r.price },
    { key: "u", label: t("K/Z", "P/L"), render: (r) => <span className={cls(r.unrealized)}>{susd(r.unrealized, 0)}</span>, sort: (r) => r.unrealized },
    { key: "adj", label: t("Primle düşen maliyet", "Cost after premiums"), render: (r) => usd(r.adjusted_basis), sort: (r) => r.adjusted_basis, hideSm: true },
    { key: "d", label: "", render: (r) => <button className="btn xs ghost danger" onClick={() => del(r.ticker)}>{t("Sil", "Remove")}</button> },
  ];
  return (
    <Card title={t("Hisselerim", "My shares")} hint={t("covered call önerileri buradan", "covered call ideas come from here")} flush>
      {h.loading && !h.data ? <Loading /> : rows.length ? <Table<any> rows={rows} cols={cols} rowKey={(r) => r.ticker} compact /> : (
        <p className="muted" style={{ padding: "4px 22px 12px" }}>{t("Henüz hisse eklemedin. 100 ve üzeri hissen varsa her hafta call satarak ek gelir önerisi alırsın.",
          "You haven't added any shares. If you own 100+ shares of a stock, you'll get weekly covered-call income ideas.")}</p>
      )}
      <div className="row" style={{ padding: "14px 22px 18px", borderTop: "1px solid var(--line)" }}>
        <input className="input sm" style={{ width: 100 }} placeholder={t("Hisse", "Ticker")} value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} />
        <input className="input sm" style={{ width: 100 }} type="number" placeholder={t("Adet", "Shares")} value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} />
        <input className="input sm" style={{ width: 130 }} type="number" step="0.01" placeholder={t("Ort. maliyet $", "Avg cost $")} value={form.cost_basis} onChange={(e) => setForm({ ...form, cost_basis: e.target.value })} />
        <button className="btn sm primary" onClick={add}><Icon name="plus" size={15} /> {t("Ekle", "Add")}</button>
      </div>
    </Card>
  );
}

function PlanTab() {
  const t = useT();
  const pro = usePro();
  const settings = useApi<any>("/settings");
  const [p, setP] = usePersisted("plan2", {
    cash: "", risk: "balanced" as Risk, horizon: "1w" as Horizon, cc_above_basis: true, exclude_earnings: true,
    reserve_pct: 20, max_position_pct: 35, leaps_share: 50,
  });
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cash = p.cash !== "" ? p.cash : settings.data?.cash ?? 10000;

  const build = async () => {
    setLoading(true);
    setErr(null);
    const dte = { "1w": [3, 9], "2w": [8, 17], "1m": [20, 45] }[p.horizon];
    const delta = { cautious: 0.2, balanced: 0.3, bold: 0.42 }[p.risk];
    try {
      setPlan(await api("/plan", { json: {
        cash: Number(cash), reserve_pct: p.reserve_pct, max_position_pct: p.max_position_pct, dte_min: dte[0], dte_max: dte[1], delta_max: delta,
        cc_above_basis: p.cc_above_basis, exclude_earnings: p.exclude_earnings, leaps_share: p.leaps_share,
      } }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const csp = plan?.csp;
  let stepNo = 0;
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="grid g-side">
        <Holdings onChange={() => setPlan(null)} />
        <Card title={t("Planını oluştur", "Build your plan")}>
          <div className="stack" style={{ gap: 14 }}>
            <Field label={t("Kullanabileceğin nakit ($)", "Cash you can use ($)")}><input className="input" type="number" value={cash} onChange={(e) => setP({ ...p, cash: e.target.value })} /></Field>
            <Field label={t("Risk tercihin", "Risk appetite")}>
              <Seg value={p.risk} onChange={(v) => setP({ ...p, risk: v })} options={[{ v: "cautious", l: t("Temkinli", "Cautious") }, { v: "balanced", l: t("Dengeli", "Balanced") }, { v: "bold", l: t("Cesur", "Bold") }]} />
            </Field>
            <Field label={t("Süre", "Timeframe")}>
              <Seg value={p.horizon} onChange={(v) => setP({ ...p, horizon: v })} options={[{ v: "1w", l: t("1 hafta", "1 week") }, { v: "2w", l: t("2 hafta", "2 weeks") }, { v: "1m", l: t("1 ay", "1 month") }]} />
            </Field>
            <Toggle checked={p.cc_above_basis} onChange={(v) => setP({ ...p, cc_above_basis: v })} label={<span className="small">{t("Hisselerimi maliyetimin altında satma", "Never sell my shares below cost")}</span>} />
            <Toggle checked={p.exclude_earnings} onChange={(v) => setP({ ...p, exclude_earnings: v })} label={<span className="small">{t("Bilanço dönemlerini atla", "Skip earnings periods")}</span>} />
            <Disclosure summary={<span className="small">{t("Gelişmiş ayarlar", "Advanced settings")}</span>}>
              <div className="grid g2" style={{ gap: 10 }}>
                <Field label={t("Nakit rezervi %", "Cash reserve %")}><input className="input" type="number" value={p.reserve_pct} onChange={(e) => setP({ ...p, reserve_pct: Number(e.target.value) })} /></Field>
                <Field label={t("Tek pozisyon maks. %", "Max per position %")}><input className="input" type="number" value={p.max_position_pct} onChange={(e) => setP({ ...p, max_position_pct: Number(e.target.value) })} /></Field>
                <Field label={t("Primin LEAPS payı %", "Premium to LEAPS %")} info="leaps"><input className="input" type="number" value={p.leaps_share} onChange={(e) => setP({ ...p, leaps_share: Number(e.target.value) })} /></Field>
              </div>
            </Disclosure>
            <button className="btn primary" onClick={build} disabled={loading}>{loading ? t("Hazırlanıyor…", "Preparing…") : t("Planımı hazırla", "Prepare my plan")}</button>
            <p className="small muted">{t("~30 hissenin güncel zinciri incelenir; 30–60 saniye sürebilir.", "Checks ~30 live option chains; can take 30–60 seconds.")}</p>
          </div>
        </Card>
      </div>

      {err && <ErrorBox error={err} />}
      {loading && <Loading text={t("Adaylar inceleniyor ve nakdin dağıtılıyor…", "Reviewing candidates and allocating your cash…")} />}

      {plan && !loading && (
        <div className="stack" style={{ gap: 22 }}>
          {plan.notes?.map((n: string) => <Callout key={n} tone="warn">{n}</Callout>)}
          <div className="dark-card">
            <div className="label">{t("Bu turun planı", "This round's plan")}</div>
            <h2 style={{ color: "var(--dark-card-ink)" }}>
              {plan.totals.premium > 0
                ? t(`Bu tur yaklaşık ${usd0(plan.totals.premium)} prim toplayabilirsin.`, `You could collect about ${usd0(plan.totals.premium)} in premium this round.`)
                : t("Bu ayarlarla uygun işlem bulunamadı.", "No suitable trades with these settings.")}
            </h2>
            {csp.used > 0 && (
              <p>{t(`${usd0(csp.used)} nakdini ${csp.allocations.length} farklı hisseye dağıtarak, ortalama ${num(csp.weighted_dte, 0)} günde teminata göre ${pct(csp.yield_on_used, 2)} prim getirisi. ${usd0(csp.remaining_cash)} nakit kenarda kalıyor.`,
                `Spreading ${usd0(csp.used)} across ${csp.allocations.length} stocks earns ${pct(csp.yield_on_used, 2)} on that capital over ~${num(csp.weighted_dte, 0)} days. ${usd0(csp.remaining_cash)} stays in reserve.`)}</p>
            )}
            <p className="small" style={{ color: "var(--dark-card-muted)" }}>
              {t(`İstatistiksel olarak bu kontratların ~${num(csp.expected_assignments, 1)} tanesinde hisseyi almak zorunda kalabilirsin; bu yüzden sadece sahip olmaya razı olduğun hisseleri seç.`,
                `Statistically, ~${num(csp.expected_assignments, 1)} of these contracts may end with you buying the shares, so only pick stocks you'd be happy to own.`)}
            </p>
          </div>

          {csp.allocations.length > 0 && (
            <div>
              <div className="row" style={{ gap: 12, marginBottom: 12 }}>
                <Bubble name={STRAT_STYLE.csp.icon} color={STRAT_STYLE.csp.color} bg={STRAT_STYLE.csp.bg} sm />
                <h2>{t("Nakdinle: put sat", "With your cash: sell puts")}</h2>
              </div>
              <div className="stack" style={{ gap: 10 }}>
                {csp.allocations.map((a: any) => (
                  <div className="card" key={a.symbol} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "center" }}>
                    <span className="step" style={{ margin: 0 }}><span className="n">{++stepNo}</span></span>
                    <div>
                      <div className="row" style={{ gap: 8 }}><strong style={{ fontSize: 16 }}>{a.ticker}</strong><span className="muted small">{usd(a.spot)}</span></div>
                      <p className="idea-sentence mt4">{explainContract(a, t, a.qty)}</p>
                    </div>
                    <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
                      <Verdict s={a.score} parts={a.parts} />
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn xs" onClick={() => toLab(a, a.qty)}>{t("Simüle et", "Simulate")}</button>
                        <button className="btn xs" onClick={() => toJournal(a, a.qty)}>{t("Kaydet", "Log it")}</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="row" style={{ gap: 12, marginBottom: 12 }}>
              <Bubble name={STRAT_STYLE.cc.icon} color={STRAT_STYLE.cc.color} bg={STRAT_STYLE.cc.bg} sm />
              <h2>{t("Hisselerinle: call yaz", "With your shares: write calls")}</h2>
            </div>
            {plan.covered_calls.length === 0 ? (
              <Card><Empty>{t("100 ve üzeri hisse eklediğinde burada her biri için call önerisi çıkar.", "Once you add 100+ shares of a stock, you'll get call ideas for it here.")}</Empty></Card>
            ) : plan.covered_calls.map((h: any) => (
              <Card key={h.ticker} title={t(`${h.ticker} · ${h.lots} kontratlık hissen var (maliyet ${usd(h.cost_basis)})`, `${h.ticker} · you own ${h.lots} contract(s) worth (cost ${usd(h.cost_basis)})`)} style={{ marginBottom: 10 }}>
                {h.error ? <ErrorBox error={h.error} /> : h.options.length ? h.options.map((o: any, i: number) => (
                  <div className="contract-row" key={o.symbol}>
                    <div>
                      {i === 0 && <span className="pill green" style={{ marginBottom: 6 }}>{t("En iyi seçenek", "Best option")}</span>}
                      <p className="idea-sentence">{explainContract(o, t, h.lots)}</p>
                      {o.assign_pl != null && <p className="small muted mt4">{t(`Hisselerin satılırsa toplam kârın: ${susd(o.assign_pl * h.lots, 0)}`, `If your shares are called away, total profit: ${susd(o.assign_pl * h.lots, 0)}`)}</p>}
                    </div>
                    <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
                      <Verdict s={o.score} parts={o.parts} />
                      <button className="btn xs" onClick={() => toJournal(o, h.lots)}>{t("Kaydet", "Log it")}</button>
                    </div>
                  </div>
                )) : <p className="muted">{t("Maliyetinin üstünde uygun call yok. \"Hisselerimi maliyetimin altında satma\" seçeneğini kapatmayı ya da süreyi uzatmayı dene.", "No suitable call above your cost. Try turning off \"Never sell below cost\" or a longer timeframe.")}</p>}
              </Card>
            ))}
          </div>

          <div>
            <div className="row" style={{ gap: 12, marginBottom: 6 }}>
              <Bubble name={STRAT_STYLE.leaps.icon} color={STRAT_STYLE.leaps.color} bg={STRAT_STYLE.leaps.bg} sm />
              <h2>{t("Primle yükselişe ortak ol", "Use premium to ride the upside")}</h2>
            </div>
            <p className="ink2" style={{ marginBottom: 12, maxWidth: 760 }}>
              {t(`Call yazınca ani bir yükselişte hisse elinden gidebilir. Toplanan primin bir kısmıyla (yüzde ${plan.inputs.leaps_share}, yani ${usd0(plan.leaps.budget)}) zamanla uzun vadeli call almak bu riski dengeler.`,
                `Writing calls means a sudden rally could take your shares. Using ${plan.inputs.leaps_share}% of the premium (${usd0(plan.leaps.budget)}) toward long-dated calls over time balances that risk.`)}
            </p>
            <Card flush>
              <Table<any> rows={plan.leaps.options} rowKey={(r) => r.symbol} compact empty={t("Uygun LEAPS bulunamadı.", "No suitable LEAPS found.")} cols={[
                { key: "t", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} sub={usd(r.spot)} /> },
                { key: "c", label: t("Kontrat", "Contract"), left: true, render: (r) => <>{dateTR(r.expiry)} <strong>${strike(r.strike)} call</strong></> },
                { key: "cost", label: t("Maliyet", "Cost"), render: (r) => usd0(r.capital) },
                { key: "be", label: t("Başabaş", "Breakeven"), render: (r) => spct(r.be_pct, 0) },
                { key: "per", label: t("Kaç turluk prim", "Rounds of premium"), render: (r) => (r.periods_needed ? num(r.periods_needed, 1) : "—") },
                { key: "s", label: t("Skor", "Score"), render: (r) => <Verdict s={r.score} parts={r.parts} /> },
              ]} />
            </Card>
          </div>

          {pro && (
            <Card>
              <div className="stats-row">
                <Stat k={t("Yatırılabilir nakit", "Investable cash")} v={usd0(csp.investable)} />
                <Stat k={t("Kullanılan", "Used")} v={usd0(csp.used)} />
                <Stat k={t("Teminat getirisi", "Yield on capital")} v={pct(csp.yield_on_used, 2)} />
                <Stat k={t("Ağırlıklı vade", "Weighted DTE")} v={`${num(csp.weighted_dte, 0)}${t("g", "d")}`} />
                <Stat k={t("Taranan aday", "Candidates scanned")} v={csp.candidates_scanned} />
              </div>
            </Card>
          )}
          <Callout tone="warn">{t("Bu plan bir hesaplama aracıdır; atanma, ani düşüşler ve bilanço sürprizleri primden çok daha büyük kayıplar doğurabilir. İşlem öncesi aracı kurumundaki canlı fiyatı kontrol et.",
            "This plan is a calculator; assignment, sudden drops and earnings surprises can cause losses far larger than the premium. Check live prices at your broker before trading.")}</Callout>
        </div>
      )}
    </div>
  );
}

export default function Portfolio({ query }: { query: URLSearchParams }) {
  const t = useT();
  const tab = query.get("tab") === "journal" ? "journal" : "plan";
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker"><Icon name="briefcase" size={15} /> {t("Portföyüm", "My portfolio")}</div>
          <h1>{tab === "plan" ? t("Nakdin ve hisselerin için bir plan", "A plan for your cash and shares") : t("İşlemlerin ve sonuçların", "Your trades and results")}</h1>
        </div>
      </div>
      <div className="tabs-inline">
        <button className={tab === "plan" ? "on" : ""} onClick={() => go("/portfolio")}><Icon name="target" size={16} /> {t("Planım", "My plan")}</button>
        <button className={tab === "journal" ? "on" : ""} onClick={() => go("/portfolio?tab=journal")}><Icon name="list" size={16} /> {t("İşlemlerim", "My trades")}</button>
      </div>
      {tab === "plan" ? <PlanTab /> : <Journal query={query} />}
    </div>
  );
}
