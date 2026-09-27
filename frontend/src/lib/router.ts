import { useEffect, useState } from "react";

/** Minimal hash router: #/yol?x=1 */
export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const h = window.location.hash.replace(/^#/, "") || "/";
  const [p, q] = h.split("?");
  const path = p || "/";
  return { path, parts: path.split("/").filter(Boolean), query: new URLSearchParams(q || "") };
}

export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const on = () => {
      setR(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export function go(path: string) {
  window.location.hash = path;
}

export function href(path: string) {
  return `#${path}`;
}
