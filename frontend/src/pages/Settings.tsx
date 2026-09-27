import { useEffect, useState } from "react";
import type { Status } from "../App";
import { Icon } from "../components/Icon";
import { Callout, Card, Field, Loading } from "../components/ui";
import { api, useApi } from "../lib/api";
import { pct } from "../lib/format";
import { useT } from "../prefs";

export default function Settings({ onChange, status }: { onChange: () => void; status: Status | null }) {
  const t = useT();
  const settings = useApi<any>("/settings");
  const universe = useApi<any>("/universe");
  const [s, setS] = useState<any>(null);
  const [uni, setUni] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (settings.data) setS(settings.data); }, [settings.data]);
  useEffect(() => { if (universe.data) setUni(universe.data.tickers.join(", ")); }, [universe.data]);
  if (!s || !universe.data) return <Loading />;

  const save = async () => {
    await api("/settings", { method: "PUT", json: {
      cash: Number(s.cash), cash_reserve_pct: Number(s.cash_reserve_pct), max_position_pct: Number(s.max_position_pct),
      commission_per_contract: Number(s.commission_per_contract),
      risk_free_override: s.risk_free_override === "" || s.risk_free_override === null ? null : Number(s.risk_free_override),
    } });
    setMsg(t("Ayarlar kaydedildi.", "Settings saved."));
  };
  const saveUni = async () => {
    const r = await api<any>("/universe", { method: "PUT", json: { tickers: uni.split(/[\s,;]+/).filter(Boolean) } });
    setUni(r.tickers.join(", "));
    setMsg(t(`Hisse listesi güncellendi: ${r.tickers.length} hisse. Bir sonraki veri yenilemesinde geçerli olur.`, `Stock list updated: ${r.tickers.length} stocks. Takes effect on the next data refresh.`));
    onChange();
  };
  const lr = status?.last_run;

  return (
    <div>
      <div className="page-head"><div>
        <div className="kicker"><Icon name="gear" size={15} /> {t("Ayarlar", "Settings")}</div>
        <h1>{t("Varsayımlar ve takip ettiğin hisseler", "Assumptions and the stocks you follow")}</h1>
      </div></div>
      {msg && <div style={{ marginBottom: 16 }}><Callout tone="good">{msg}</Callout></div>}
      <div className="grid g2" style={{ alignItems: "start" }}>
        <Card title={t("Varsayımlar", "Assumptions")}>
          <div className="form-grid">
            <Field label={t("Varsayılan nakit ($)", "Default cash ($)")}><input className="input" type="number" value={s.cash} onChange={(e) => setS({ ...s, cash: e.target.value })} /></Field>
            <Field label={t("Nakit rezervi (%)", "Cash reserve (%)")}><input className="input" type="number" value={s.cash_reserve_pct} onChange={(e) => setS({ ...s, cash_reserve_pct: e.target.value })} /></Field>
            <Field label={t("Tek pozisyon maks. (%)", "Max per position (%)")}><input className="input" type="number" value={s.max_position_pct} onChange={(e) => setS({ ...s, max_position_pct: e.target.value })} /></Field>
            <Field label={t("Kontrat başı komisyon ($)", "Commission per contract ($)")}><input className="input" type="number" step="0.01" value={s.commission_per_contract} onChange={(e) => setS({ ...s, commission_per_contract: e.target.value })} /></Field>
            <Field label={t("Risksiz faiz (%)", "Risk-free rate (%)")} help={t(`Boş bırakırsan otomatik: ${pct(status?.rate, 2)}`, `Leave blank for automatic: ${pct(status?.rate, 2)}`)}>
              <input className="input" type="number" step="0.01" value={s.risk_free_override ?? ""} onChange={(e) => setS({ ...s, risk_free_override: e.target.value })} />
            </Field>
          </div>
          <div className="row mt16" style={{ justifyContent: "flex-end" }}><button className="btn primary" onClick={save}>{t("Kaydet", "Save")}</button></div>
        </Card>
        <Card title={t("Son veri yenilemesi", "Last data refresh")}>
          {lr ? (
            <div className="kv">
              <span className="k">{t("Başlangıç", "Started")}</span><span className="v">{lr.started}</span>
              <span className="k">{t("Bitiş", "Finished")}</span><span className="v">{lr.finished || t("devam ediyor", "in progress")}</span>
              <span className="k">{t("İşlem günü", "Trading day")}</span><span className="v">{lr.trade_date || "—"}</span>
              <span className="k">{t("Başarılı / hatalı", "Succeeded / failed")}</span><span className="v">{lr.ok} / {lr.failed}</span>
            </div>
          ) : <p className="muted">{t("Henüz çalışmadı.", "Hasn't run yet.")}</p>}
          {lr && lr.errors?.length > 0 && <div className="mt12 small muted" style={{ maxHeight: 160, overflow: "auto" }}>{lr.errors.map((e: string) => <div key={e}>{e}</div>)}</div>}
          <p className="small muted mt12">{t("Sunucu açıkken veriler hafta içi her gün New York saatiyle 16:30'dan sonra otomatik yenilenir. Bilgisayarın kapalıysa sağ üstteki yenile düğmesini kullan.",
            "While the server is running, data refreshes automatically every weekday after 4:30 PM New York time. If your computer was off, use the refresh button at the top right.")}</p>
        </Card>
      </div>
      <div className="mt16">
        <Card title={t(`Takip edilen hisseler (${universe.data.tickers.length})`, `Stocks followed (${universe.data.tickers.length})`)} hint={t("virgül ya da boşlukla ayır", "separate with commas or spaces")}>
          <textarea className="input" style={{ minHeight: 170, fontFamily: "var(--mono)", fontSize: 12.5 }} value={uni} onChange={(e) => setUni(e.target.value.toUpperCase())} />
          <p className="small muted mt8">{t("Likit ve sahip olmaya razı olacağın şirketlerle sınırlı tut. Liste büyüdükçe veri yenilemesi uzar (~40 hisse/dk).",
            "Keep it to liquid companies you'd be happy to own. A longer list means slower refreshes (~40 stocks/min).")}</p>
          <div className="row mt12" style={{ justifyContent: "flex-end" }}><button className="btn primary" onClick={saveUni}>{t("Listeyi kaydet", "Save list")}</button></div>
        </Card>
      </div>
    </div>
  );
}
