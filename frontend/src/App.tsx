import { useEffect, useRef, useState } from "react";
import { Icon } from "./components/Icon";
import { Seg } from "./components/ui";
import { api } from "./lib/api";
import { dateTR } from "./lib/format";
import { go, href, useRoute } from "./lib/router";
import { usePrefs, useT } from "./prefs";
import Today from "./pages/Today";
import Ideas from "./pages/Ideas";
import Stock from "./pages/Stock";
import Portfolio from "./pages/Portfolio";
import Tools from "./pages/Tools";
import Learn from "./pages/Learn";
import Settings from "./pages/Settings";

export interface Status {
  market_open: boolean;
  now_et: string;
  snapshot_count: number;
  latest_snapshot: string | null;
  universe_size: number;
  rate: number;
  progress: { running: boolean; done: number; total: number; failed: number; current: string | null; trade_date: string | null };
  last_run: { ok: number; failed: number; errors: string[]; started?: string; finished?: string; trade_date?: string } | null;
}

function useStatus() {
  const [s, setS] = useState<Status | null>(null);
  const timer = useRef<number>();
  const load = () =>
    api<Status>("/status")
      .then((d) => {
        setS(d);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(load, d.progress.running ? 3000 : 60000);
      })
      .catch(() => {
        timer.current = window.setTimeout(load, 10000);
      });
  useEffect(() => {
    load();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { s, reload: load };
}

function DataStatus({ s, reload }: { s: Status | null; reload: () => void }) {
  const t = useT();
  if (!s) return null;
  const p = s.progress;
  const start = async () => {
    await api("/snapshot", { method: "POST" });
    reload();
  };
  if (p.running) {
    return (
      <span className="pill" title={t("Tüm hisseler için veriler çekiliyor", "Fetching data for every stock")}>
        <span className="spinner" style={{ width: 12, height: 12 }} />
        <span className="num">{p.done}/{p.total}</span>
      </span>
    );
  }
  return (
    <button className="pill" onClick={start} style={{ cursor: "pointer" }}
      title={t("Verileri şimdi yenile (~10 dk sürer)", "Refresh data now (takes ~10 min)")}>
      <span className="dot" style={{ color: s.market_open ? "var(--green)" : "var(--muted)" }} />
      <span className="hide-sm">
        {s.latest_snapshot ? t(`${dateTR(s.latest_snapshot)} kapanışı`, `${dateTR(s.latest_snapshot)} close`) : t("Veri yok", "No data")}
      </span>
      <Icon name="refresh" size={14} />
    </button>
  );
}

function Search() {
  const t = useT();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ t: string; name?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  useEffect(() => {
    if (!q) {
      setRes([]);
      return;
    }
    const tm = window.setTimeout(() => {
      api<{ results: { t: string; name?: string }[] }>(`/search?q=${encodeURIComponent(q)}`).then((d) => setRes(d.results)).catch(() => {});
    }, 120);
    return () => window.clearTimeout(tm);
  }, [q]);
  const pick = (tk: string) => {
    go(`/stock/${tk.toUpperCase()}`);
    setQ("");
    setOpen(false);
  };
  const options = q && !res.some((r) => r.t === q.toUpperCase()) ? [{ t: q.toUpperCase() }, ...res] : res;
  return (
    <div className="search">
      <span className="ico"><Icon name="search" size={15} /></span>
      <input
        className="input sm"
        placeholder={t("Hisse ara…", "Search a stock…")}
        value={q}
        onChange={(e) => { setQ(e.target.value.toUpperCase()); setOpen(true); setHl(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && options.length) pick((options[hl] || options[0]).t);
          if (e.key === "ArrowDown") setHl(Math.min(hl + 1, options.length - 1));
          if (e.key === "ArrowUp") setHl(Math.max(hl - 1, 0));
        }}
      />
      {open && options.length > 0 && (
        <div className="search-results">
          {options.map((o, i) => (
            <button key={o.t} className={i === hl ? "hl" : ""} onMouseDown={() => pick(o.t)}>
              <strong>{o.t}</strong> <span className="muted small">{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const t = useT();
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("theme") || "auto";
    } catch {
      return "auto";
    }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "auto") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* yok say */
    }
  }, [theme]);
  const next = theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto";
  const label = theme === "auto" ? t("Tema: sistem", "Theme: system") : theme === "dark" ? t("Tema: koyu", "Theme: dark") : t("Tema: açık", "Theme: light");
  return (
    <button className="btn ghost icon" title={label} aria-label={label} onClick={() => setTheme(next)}>
      <Icon name={theme === "light" ? "sun" : theme === "dark" ? "moon" : "globe"} size={17} />
    </button>
  );
}

// Eski adresleri yeni bölümlere yönlendir
const LEGACY: Record<string, string> = {
  hisse: "/stock/", tarayici: "/ideas", kontrat: "/ideas", plan: "/portfolio", defter: "/portfolio?tab=journal",
  lab: "/tools?tab=lab", anomali: "/tools?tab=anomalies", rehber: "/learn", ayarlar: "/settings",
};

export default function App() {
  const route = useRoute();
  const { s, reload } = useStatus();
  const { lang, setLang, mode, setMode } = usePrefs();
  const t = useT();
  const first = route.parts[0] || "";

  useEffect(() => {
    if (LEGACY[first]) go(first === "hisse" ? `/stock/${route.parts[1] || "SPY"}` : LEGACY[first]);
  }, [first, route.parts]);

  const NAV = [
    { key: "", icon: "sun", label: t("Bugün", "Today") },
    { key: "ideas", icon: "bulb", label: t("Fikirler", "Ideas") },
    { key: "portfolio", icon: "briefcase", label: t("Portföyüm", "My portfolio") },
    { key: "tools", icon: "flask", label: t("Araçlar", "Tools") },
    { key: "learn", icon: "book", label: t("Öğren", "Learn") },
  ];

  let page;
  switch (first) {
    case "":
      page = <Today status={s} />;
      break;
    case "ideas":
      page = <Ideas query={route.query} />;
      break;
    case "stock":
      page = <Stock sym={(route.parts[1] || "SPY").toUpperCase()} />;
      break;
    case "portfolio":
      page = <Portfolio query={route.query} />;
      break;
    case "tools":
      page = <Tools query={route.query} />;
      break;
    case "learn":
      page = <Learn />;
      break;
    case "settings":
      page = <Settings onChange={reload} status={s} />;
      break;
    default:
      page = LEGACY[first] ? null : <div className="empty">{t("Sayfa bulunamadı.", "Page not found.")} <a href={href("/")}>{t("Ana sayfa", "Home")}</a></div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href={href("/")}>
            <span className="brand-mark">o</span>
            <span className="brand-name">{t("Opsiyon Masası", "Options Desk")}</span>
          </a>
          <nav className="nav">
            {NAV.map((n) => (
              <a key={n.key} href={href(`/${n.key}`)} className={first === n.key || (n.key === "ideas" && first === "stock") ? "active" : ""}>
                <Icon name={n.icon} size={16} /> {n.label}
              </a>
            ))}
          </nav>
          <div className="top-actions">
            <span className="hide-sm"><Search /></span>
            <DataStatus s={s} reload={reload} />
            <span title={t("Basit: sade dil ve öneriler · Uzman: tüm tablolar ve metrikler", "Simple: plain language and suggestions · Pro: every table and metric")}>
              <Seg sm value={mode} onChange={setMode} options={[{ v: "simple", l: t("Basit", "Simple") }, { v: "pro", l: t("Uzman", "Pro") }]} />
            </span>
            <Seg sm value={lang} onChange={setLang} options={[{ v: "tr", l: "TR" }, { v: "en", l: "EN" }]} />
            <ThemeToggle />
            <a className="btn ghost icon" href={href("/settings")} title={t("Ayarlar", "Settings")} aria-label={t("Ayarlar", "Settings")}>
              <Icon name="gear" size={17} />
            </a>
          </div>
        </div>
      </header>
      <main className="main">{page}</main>
      <footer className="footer">
        <div className="footer-inner">
          <span>{t("Veriler: CBOE (15 dk gecikmeli), Yahoo, Nasdaq, FRED.", "Data: CBOE (15-min delayed), Yahoo, Nasdaq, FRED.")}</span>
          <span>{t("Kişisel kullanım içindir, yatırım tavsiyesi değildir. Opsiyon satışında kayıp, alınan primden çok daha büyük olabilir.",
            "For personal use, not investment advice. Losses from selling options can far exceed the premium collected.")}</span>
        </div>
      </footer>
    </div>
  );
}
