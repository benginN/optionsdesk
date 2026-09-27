import { useCallback, useEffect, useRef, useState } from "react";
import { getLang, usePrefs } from "../prefs";

export class ApiError extends Error {}

export async function api<T = any>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const init: RequestInit = { ...opts, headers: { "X-Lang": getLang(), ...(opts.headers || {}) } };
  if (opts.json !== undefined) {
    init.method = init.method || "POST";
    init.headers = { ...(init.headers as Record<string, string>), "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.json);
  }
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* yok say */
    }
    throw new ApiError(msg);
  }
  return res.json();
}

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (d: T | null) => void;
}

/** Veri çekme kancası. Yol ya da dil değişince yeniden yükler. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []): Loadable<T> {
  const { lang } = usePrefs();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => my === seq.current && setData(d))
      .catch((e) => my === seq.current && setError(String(e.message || e)))
      .finally(() => my === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, lang, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** localStorage'a güvenli okuma/yazma (gizli pencerede hata verebilir). */
export function usePersisted<T extends object>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, JSON.stringify(nv));
      } catch {
        /* yok say */
      }
    },
    [key],
  );
  return [v, set];
}
