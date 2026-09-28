// Strateji pusulası: piyasanın bugünkü durumuna göre öne çıkan strateji türü.
// Kurallar sunucuda (backend/app/analytics/stance.py); burada yalnız gösterim.
import { ReactNode } from "react";
import { useApi } from "../lib/api";
import { usePro, useT } from "../prefs";
import { Icon } from "./Icon";
import { Disclosure, ErrorBox, Pill, Skeleton } from "./ui";

type Tone = "green" | "red" | "amber" | "blue" | "violet";

const STANCE_TONE: Record<string, Tone> = {
  sell_easy: "green", sell_careful: "amber", buy_leaps: "violet", defense: "red", post_fear: "blue",
};

function fitColor(v: number) {
  return v >= 70 ? "var(--green)" : v >= 50 ? "var(--amber)" : "var(--red)";
}

function Block({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="compass-block">
      <strong className="small">{title}</strong>
      <div className="mt8">{children}</div>
    </div>
  );
}

export default function Compass() {
  const t = useT();
  const pro = usePro();
  const { data: d, error, loading, reload } = useApi<any>("/market/stance");

  if (loading && !d) return <Skeleton h={220} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!d?.code) return null;

  const signals = (
    <ul className="list-plain compass-signals">
      {d.signals.map((s: any) => (
        <li key={s.key}>
          <div className="row-between" style={{ gap: 8 }}><span>{s.label}</span><Pill tone={s.tone || undefined}>{s.value}</Pill></div>
          <div className="small muted mt4">{s.text}</div>
        </li>
      ))}
    </ul>
  );
  const fit = (
    <ul className="list-plain compass-fit">
      {d.fit.map((f: any) => (
        <li key={f.key}>
          <div className="row-between small"><span>{f.label}</span><span className="num">{f.score}</span></div>
          <div className="progress mt4"><div style={{ width: `${f.score}%`, background: fitColor(f.score) }} /></div>
        </li>
      ))}
    </ul>
  );
  const lines = (xs: string[]) => (
    <ul className="list-plain compass-lines small">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>
  );
  const details = (
    <div className="grid g2 compass-grid">
      <Block title={t("Neden bu duruş?", "Why this stance?")}>{signals}</Block>
      <div className="stack">
        <Block title={t("Strateji uygunluğu (0–100)", "Strategy fit (0–100)")}>{fit}</Block>
        <Block title={t("İleriye bakış", "Looking ahead")}>{lines(d.outlook)}</Block>
        <Block title={t("Görüş ne zaman değişir?", "What would change the view?")}>{lines(d.triggers)}</Block>
      </div>
    </div>
  );

  return (
    <div className="card compass">
      <div className="row-between" style={{ alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="muted small row" style={{ gap: 6 }}><Icon name="target" size={15} /> {t("Strateji pusulası", "Strategy compass")}</div>
          <h2 className="compass-title">{d.emoji} {d.label}</h2>
          <p className="mt4 ink2">{d.summary}</p>
          {d.trend_note && <p className="small warn mt4">{d.trend_note}</p>}
        </div>
        <Pill tone={STANCE_TONE[d.code]}>{t("Bugünkü duruş", "Today's stance")}</Pill>
      </div>

      <div className="compass-params mt12">
        {d.params.map((p: any) => (
          <div key={p.k} className="compass-param"><div className="muted small">{p.k}</div><strong>{p.v}</strong></div>
        ))}
      </div>

      <div className="mt16">
        {pro ? details : <Disclosure summary={t("Neden bu duruş, ne zaman değişir?", "Why this stance, and what would change it?")}>{details}</Disclosure>}
      </div>

      <p className="small muted mt12">
        {d.disclaimer} · {t("Hesaplandı", "Computed")} {String(d.as_of || "").slice(11, 16)} ET
      </p>
    </div>
  );
}
