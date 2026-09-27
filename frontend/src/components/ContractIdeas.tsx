// Tek bir hisse için sade dilli kontrat önerileri (canlı tarama).
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Horizon, Risk, Strat, explainContract, filtersFor } from "../lib/story";
import { usePrefs, useT } from "../prefs";
import { toJournal, toLab } from "./ContractActions";
import { Icon } from "./Icon";
import { Callout, Loading, Pill, Verdict } from "./ui";

export default function ContractIdeas({ ticker, s, risk, horizon, budget, noEarnings, limit = 3 }: {
  ticker: string; s: Strat; risk: Risk; horizon: Horizon; budget: number | null; noEarnings: boolean; limit?: number;
}) {
  const t = useT();
  const { lang } = usePrefs();
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setErr(null);
    api("/scan", { json: { strategy: s, tickers: [ticker], per_ticker: 0, filters: filtersFor(s, risk, horizon, budget, noEarnings) } })
      .then((d: any) => {
        if (!alive) return;
        // Aynı vadeden çok benzer strike'lar yerine çeşitlilik: vade başına en iyi 2
        const perExp: Record<string, number> = {};
        const picked = (d.rows as any[]).filter((r) => {
          perExp[r.expiry] = (perExp[r.expiry] || 0) + 1;
          return perExp[r.expiry] <= 2;
        });
        setRows(picked.slice(0, limit));
      })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [ticker, s, risk, horizon, budget, noEarnings, limit, lang]);

  if (err) return <Callout tone="bad">{err}</Callout>;
  if (!rows) return <Loading text={t("Güncel kontratlar inceleniyor…", "Checking current contracts…")} />;
  if (!rows.length) {
    return (
      <Callout tone="warn">
        {t("Bu tercihlere uyan kontrat bulunamadı. Risk seviyesini ya da süreyi değiştirmeyi, veya bütçeyi artırmayı dene.",
          "No contract matches these preferences. Try a different risk level or timeframe, or a larger budget.")}
      </Callout>
    );
  }
  return (
    <div>
      {rows.map((r) => (
        <div className="contract-row" key={`${r.symbol}-${r.long_strike ?? ""}`}>
          <div>
            <p className="idea-sentence">{explainContract(r, t)}</p>
            <div className="chips mt8">
              {r.earnings && <Pill tone="red">{t("Vadede bilanço var", "Earnings before expiry")}</Pill>}
              {r.edge != null && r.edge > 0 && <Pill tone="green">{t("Prim, geçmiş hareketliliğe göre cömert", "Premium is generous vs past moves")}</Pill>}
              {r.spread_pct != null && r.spread_pct > 0.12 && <Pill tone="amber">{t("Alış-satış farkı geniş: limit emir kullan", "Wide spread: use a limit order")}</Pill>}
            </div>
          </div>
          <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
            <Verdict s={r.score} parts={r.parts} />
            <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
              <button className="btn sm" onClick={() => toLab(r)}><Icon name="flask" size={15} /> {t("Simüle et", "Simulate")}</button>
              <button className="btn sm" onClick={() => toJournal(r)}><Icon name="plus" size={15} /> {t("Kaydet", "Log it")}</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
