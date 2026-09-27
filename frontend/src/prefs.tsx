import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { setFormatLang } from "./lib/format";

export type Lang = "tr" | "en";
export type Mode = "simple" | "pro";

// Modül düzeyinde güncel dil: api() ve format yardımcıları React dışından da okur.
let currentLang: Lang = initialLang();
export const getLang = () => currentLang;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* gizli pencere vb. */
  }
}

function initialLang(): Lang {
  const saved = read("lang");
  if (saved === "tr" || saved === "en") return saved;
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}
setFormatLang(currentLang);

interface Prefs {
  lang: Lang;
  setLang: (l: Lang) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}

const Ctx = createContext<Prefs>({ lang: currentLang, setLang: () => {}, mode: "simple", setMode: () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);
  const [mode, setModeState] = useState<Mode>(() => (read("mode") === "pro" ? "pro" : "simple"));

  const setLang = useCallback((l: Lang) => {
    currentLang = l;
    setFormatLang(l);
    write("lang", l);
    setLangState(l);
  }, []);
  const setMode = useCallback((m: Mode) => {
    write("mode", m);
    setModeState(m);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === "en" ? "Options Desk" : "Opsiyon Masası";
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, mode, setMode }), [lang, setLang, mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePrefs = () => useContext(Ctx);

/** t("Türkçe", "English") — metinler bileşenin yanında, iki dilde yazılır. */
export function useT() {
  const { lang } = useContext(Ctx);
  return useCallback((tr: string, en: string) => (lang === "en" ? en : tr), [lang]);
}

export const usePro = () => useContext(Ctx).mode === "pro";
