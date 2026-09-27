import { Icon } from "../components/Icon";
import { go } from "../lib/router";
import { useT } from "../prefs";
import Anomalies from "./Anomalies";
import Lab from "./Lab";

export default function Tools({ query }: { query: URLSearchParams }) {
  const t = useT();
  const tab = query.get("tab") === "anomalies" ? "anomalies" : "lab";
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker"><Icon name="flask" size={15} /> {t("Araçlar", "Tools")}</div>
          <h1>{tab === "lab" ? t("Bir stratejiyi denemeden önce gör", "See a strategy before you try it") : t("Yanlış fiyatlanan kontratları bul", "Find mispriced contracts")}</h1>
          <p className="sub">{tab === "lab"
            ? t("Hisse fiyatı değişirse, zaman geçerse ya da oynaklık artarsa ne kazanıp ne kaybedeceğini önceden gör.", "See what you'd make or lose if the price moves, time passes or volatility changes.")
            : t("Fiyatları birbiriyle tutarsız olan ya da komşularına göre pahalı/ucuz kalan kontratlar.", "Contracts whose prices are inconsistent with each other or rich/cheap versus their neighbors.")}</p>
        </div>
      </div>
      <div className="tabs-inline">
        <button className={tab === "lab" ? "on" : ""} onClick={() => go("/tools?tab=lab")}><Icon name="flask" size={16} /> {t("Strateji laboratuvarı", "Strategy lab")}</button>
        <button className={tab === "anomalies" ? "on" : ""} onClick={() => go("/tools?tab=anomalies")}><Icon name="radar" size={16} /> {t("Anomali tarayıcı", "Anomaly scanner")}</button>
      </div>
      {tab === "lab" ? <Lab query={query} /> : <Anomalies query={query} />}
    </div>
  );
}
