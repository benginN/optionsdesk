// Fikirler kapanış (snapshot) verisinden seçilir; bu not verinin yaşını ve gün içi fiyat değişimini hatırlatır.
import { dateTR } from "../lib/format";
import { useT } from "../prefs";
import { Callout } from "./ui";

export function FreshnessNote({ f, warnCount, live }: { f?: any; warnCount?: number; live?: any }) {
  const t = useT();
  if (!f?.snapshot) return null;
  const d = dateTR(f.snapshot, true);
  if (live?.active && f.market_open) {
    return (
      <div style={{ marginBottom: 14 }}><Callout tone={warnCount ? "warn" : "info"}>
        {t(`Fikirler gün içi taramadan (${live.delay_min} dk gecikmeli): bugün tazelenen hisse ${live.count}/${live.total}, her hisse ~${live.cycle_min} dk'da bir yenilenir · son ${String(live.newest || "").slice(11, 16)} ET.`,
          `Ideas come from the intraday scan (${live.delay_min}-min delayed): ${live.count} of ${live.total} stocks refreshed today, each every ~${live.cycle_min} min · last ${String(live.newest || "").slice(11, 16)} ET.`)}
        {warnCount ? t(` ${warnCount} fikirde aleyhe hareket var (⚠).`, ` ${warnCount} idea(s) have moved against you (⚠).`) : ""}
      </Callout></div>
    );
  }
  if (f.behind > 0) {
    return (
      <div style={{ marginBottom: 14 }}><Callout tone="warn">
        {t(`Fikirler ${d} kapanışına göre ve ${f.behind} iş günü eski: son kapanışın verisi henüz alınmadı (sunucu kapalı kalmış olabilir). Sayıları işlemden önce canlı kontratla doğrula.`,
          `Ideas are based on the ${d} close and are ${f.behind} trading day(s) old: the latest close hasn't been captured yet (the server may have been off). Check the live contract before trading.`)}
      </Callout></div>
    );
  }
  if (f.market_open) {
    return (
      <div style={{ marginBottom: 14 }}><Callout tone={warnCount ? "warn" : "info"}>
        {t(`Fikirler ${d} kapanışına göre seçildi; piyasa şu an açık, fiyatlar değişti.`, `Ideas were picked from the ${d} close; the market is open now and prices have moved.`)}
        {warnCount ? t(` ${warnCount} fikirde kapanıştan bu yana aleyhe hareket var (⚠).`, ` ${warnCount} idea(s) have moved against you since the close (⚠).`) : ""}
        {" "}{t("İşlemden önce “Kontratları gör” ile canlı fiyata bak.", "Check live prices with “View contracts” before trading.")}
      </Callout></div>
    );
  }
  return null;
}
