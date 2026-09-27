import { ReactNode, useEffect } from "react";
import { term } from "../lib/glossary";
import { scoreColor } from "../lib/format";
import { href } from "../lib/router";
import { usePrefs, useT } from "../prefs";
import { Icon } from "./Icon";

export function Info({ k, text, title }: { k?: string; text?: string; title?: string }) {
  const { lang } = usePrefs();
  const g = k ? term(k, lang) : undefined;
  const body = text || g?.d;
  if (!body) return null;
  return (
    <span className="info" tabIndex={0} aria-label={g?.t || title || "info"}>
      ?
      <span className="tip">
        {(g?.t || title) && <strong style={{ display: "block", marginBottom: 4 }}>{g?.t || title}</strong>}
        {body}
      </span>
    </span>
  );
}

export function Card({
  title, hint, info, children, className = "", flush = false, right, style,
}: {
  title?: ReactNode; hint?: ReactNode; info?: string; children: ReactNode; className?: string; flush?: boolean; right?: ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section className={`card ${flush ? "flush" : ""} ${className}`} style={style}>
      {(title || hint || right) && (
        <div className="card-head">
          <div className="row" style={{ gap: 6 }}>
            {title && <h3>{title}</h3>}
            {info && <Info k={info} />}
          </div>
          {right || (hint && <span className="hint">{hint}</span>)}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ k, v, d, info, dCls = "", lg = false }: { k: ReactNode; v: ReactNode; d?: ReactNode; info?: string; dCls?: string; lg?: boolean }) {
  return (
    <div className={`stat ${lg ? "lg" : ""}`}>
      <div className="k">{k}{info && <Info k={info} />}</div>
      <div className="v">{v}</div>
      {d !== undefined && d !== "" && <div className={`d ${dCls}`}>{d}</div>}
    </div>
  );
}

export function Score({ s }: { s: number | null | undefined }) {
  return <span className="score" style={{ background: scoreColor(s) }}>{s ?? "—"}</span>;
}

/** Skoru sade bir etiketle birlikte gösterir: Güçlü / İyi / Orta / Zayıf */
export function useVerdict() {
  const t = useT();
  return (s: number | null | undefined) => {
    if (s === null || s === undefined) return { label: "—", tone: undefined as undefined };
    if (s >= 68) return { label: t("Güçlü", "Strong"), tone: "green" as const };
    if (s >= 56) return { label: t("İyi", "Good"), tone: "green" as const };
    if (s >= 44) return { label: t("Orta", "Fair"), tone: "amber" as const };
    return { label: t("Zayıf", "Weak"), tone: "red" as const };
  };
}

export function Verdict({ s, parts }: { s: number | null | undefined; parts?: Record<string, number | null> }) {
  const v = useVerdict()(s);
  const t = useT();
  const body = (
    <span className="verdict">
      <span className="lbl" style={{ color: `var(--${v.tone === "green" ? "green" : v.tone === "amber" ? "amber" : "red"})` }}>{v.label}</span>
      <Score s={s} />
    </span>
  );
  if (!parts) return body;
  return (
    <span className="hovertip" tabIndex={0}>
      {body}
      <span className="tip" style={{ width: 290, left: "auto", right: 0, transform: "none" }}>
        <strong style={{ display: "block", marginBottom: 8 }}>{t("Skor neye dayanıyor?", "What drives the score?")}</strong>
        <Parts parts={parts} />
      </span>
    </span>
  );
}

export function Pill({ children, tone, title }: { children: ReactNode; tone?: "green" | "red" | "amber" | "blue" | "violet"; title?: string }) {
  return <span className={`pill ${tone || ""}`} title={title}>{children}</span>;
}

export function Loading({ text }: { text?: string }) {
  const t = useT();
  return <div className="loading"><div className="spinner" /> {text || t("Yükleniyor…", "Loading…")}</div>;
}

export function Skeleton({ h = 120, n = 1, cols = 1 }: { h?: number; n?: number; cols?: number }) {
  return (
    <div className={`grid ${cols === 3 ? "g3" : cols === 2 ? "g2" : ""}`}>
      {Array.from({ length: n }).map((_, i) => <div key={i} className="skel" style={{ height: h }} />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="error-box row-between">
      <span>{error}</span>
      {onRetry && <button className="btn sm" onClick={onRetry}>{t("Tekrar dene", "Try again")}</button>}
    </div>
  );
}

export function Empty({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {title && <div className="big">{title}</div>}
      {children}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, sm = false }: { value: T; options: { v: T; l: ReactNode }[]; onChange: (v: T) => void; sm?: boolean }) {
  return (
    <div className={`seg ${sm ? "sm" : ""}`}>
      {options.map((o) => (
        <button key={o.v} className={o.v === value ? "on" : ""} onClick={() => onChange(o.v)} type="button">{o.l}</button>
      ))}
    </div>
  );
}

export function TickerLink({ t, name, sub }: { t: string; name?: string | null; sub?: ReactNode }) {
  return (
    <a href={href(`/stock/${t}`)} onClick={(e) => e.stopPropagation()} style={{ color: "inherit", display: "block" }}>
      <div className="tk">{t}</div>
      {(name || sub) && <div className="tk-sub">{sub ?? name}</div>}
    </a>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginBottom: 16 }}>
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, info, help }: { label: ReactNode; children: ReactNode; info?: string; help?: ReactNode }) {
  return (
    <div className="field">
      <label className="row" style={{ gap: 5 }}>{label}{info && <Info k={info} />}</label>
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="check">
      <span className="toggle">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
      {label}
    </label>
  );
}

export function Callout({ tone = "info", icon, children }: { tone?: "info" | "warn" | "good" | "bad"; icon?: string; children: ReactNode }) {
  const ic = icon || { info: "info", warn: "alert", good: "check", bad: "alert" }[tone];
  return <div className={`callout c-${tone}`}><Icon name={ic} /> <div>{children}</div></div>;
}

export const PART_LABELS: Record<string, [string, string]> = {
  prim: ["Prim", "Premium"], iv: ["Opsiyon pahalılığı", "Option richness"], risk_primi: ["Risk primi", "Risk premium"],
  likidite: ["Likidite", "Liquidity"], kurulum: ["Zamanlama (RSI)", "Timing (RSI)"], skew: ["Skew", "Skew"],
  iv_ucuz: ["Opsiyon ucuzluğu", "Option cheapness"], maliyet: ["Zaman değeri", "Time value"], trend: ["Uzun trend", "Long-term trend"],
  getiri: ["Getiri", "Return"], olasilik: ["Olasılık", "Probability"], mesafe: ["Mesafe", "Distance"],
  gulumseme: ["Gülümseme", "Smile"], rr: ["Risk/ödül", "Risk/reward"], delta: ["Delta uyumu", "Delta fit"], basabas: ["Başabaş", "Breakeven"],
};

export function Parts({ parts }: { parts?: Record<string, number | null> }) {
  const { lang } = usePrefs();
  if (!parts) return null;
  return (
    <div style={{ display: "grid", gap: 7, minWidth: 220 }}>
      {Object.entries(parts).map(([k, v]) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "110px 1fr 30px", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <span style={{ opacity: 0.8 }}>{PART_LABELS[k]?.[lang === "en" ? 1 : 0] || k}</span>
          <div className="progress" style={{ height: 5, background: "rgba(128,128,128,0.25)" }}>
            <div style={{ width: `${Math.round((v ?? 0) * 100)}%`, background: v == null ? "transparent" : "var(--dark-card-accent)" }} />
          </div>
          <span style={{ textAlign: "right" }}>{v == null ? "—" : Math.round(v * 100)}</span>
        </div>
      ))}
    </div>
  );
}

/** Soldan sağa renk geçişli gösterge (0–100) */
export function Gauge({ value, left, right, colors = ["var(--blue-bg)", "var(--amber-bg)", "var(--red-bg)"] }: { value: number | null | undefined; left: ReactNode; right: ReactNode; colors?: string[] }) {
  const v = value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="gauge-track" style={{ background: `linear-gradient(90deg, ${colors.join(", ")})` }}>
        {v !== null && <div className="gauge-knob" style={{ left: `${v}%` }} />}
      </div>
      <div className="gauge-ends"><span>{left}</span><span>{right}</span></div>
    </div>
  );
}

/** Beklenen aralık çubuğu: alt – bugünkü fiyat – üst */
export function RangeBar({ low, high, price, fmt }: { low: number; high: number; price: number; fmt: (x: number) => string }) {
  const lo = Math.min(low, price);
  const hi = Math.max(high, price);
  const p = hi > lo ? ((price - lo) / (hi - lo)) * 100 : 50;
  return (
    <div className="range">
      <div className="track" />
      <div className="mark" style={{ left: `${p}%` }} />
      <div className="lbl l">{fmt(low)}</div>
      <div className="lbl" style={{ left: `${p}%`, fontWeight: 650, color: "var(--ink)" }}>{fmt(price)}</div>
      <div className="lbl r">{fmt(high)}</div>
    </div>
  );
}

export function Disclosure({ summary, children, open = false }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="disclosure" open={open}>
      <summary><Icon name="chevron" size={16} /> {summary}</summary>
      <div className="mt12">{children}</div>
    </details>
  );
}

export function SectionHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Step({ n, children }: { n: number; children: ReactNode }) {
  return <div className="step"><span className="n">{n}</span><span className="t">{children}</span></div>;
}

/** **kalın** işaretlerini <strong>'a çevirir (sunucu metinleri için) */
export function md(s: string): ReactNode[] {
  return s.split("**").map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>));
}
