// Dile duyarlı sayı, para, yüzde ve tarih biçimleri.
type Lang = "tr" | "en";
let L: Lang = "tr";
export function setFormatLang(l: Lang) {
  L = l;
  cache.clear();
}

const cache = new Map<string, Intl.NumberFormat>();
function fmt(min: number, max: number) {
  const k = `${L}-${min}-${max}`;
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(L === "en" ? "en-US" : "tr-TR", { minimumFractionDigits: min, maximumFractionDigits: max }));
  return cache.get(k)!;
}

const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const MINUS = "−";

export const num = (x: unknown, d = 2) => (ok(x) ? fmt(d, d).format(x) : "—");
export const int = (x: unknown) => (ok(x) ? fmt(0, 0).format(Math.round(x)) : "—");
/** Sayıyı gereksiz ondalık olmadan yazar (strike gibi): 42 · 42,5 */
export const strike = (x: unknown) => (ok(x) ? fmt(0, 2).format(x) : "—");
export const usd = (x: unknown, d = 2) => (ok(x) ? `${x < 0 ? MINUS : ""}$${fmt(d, d).format(Math.abs(x))}` : "—");
export const usd0 = (x: unknown) => (ok(x) ? `${x < 0 ? MINUS : ""}$${fmt(0, 0).format(Math.abs(Math.round(x)))}` : "—");

function pctBody(v: number, d: number) {
  const s = fmt(d, d).format(v * 100);
  return L === "en" ? `${s}%` : `%${s}`;
}
/** 0.1234 → TR %12,3 · EN 12.3% */
export const pct = (x: unknown, d = 1) => (ok(x) ? pctBody(x, d) : "—");
/** İşaretli yüzde: +%1,2 / −%0,4 */
export const spct = (x: unknown, d = 2) => {
  if (!ok(x)) return "—";
  const s = x > 0 ? "+" : x < 0 ? MINUS : "";
  return `${s}${pctBody(Math.abs(x), d)}`;
};
export const signed = (x: unknown, d = 2) => {
  if (!ok(x)) return "—";
  const s = x > 0 ? "+" : x < 0 ? MINUS : "";
  return `${s}${fmt(d, d).format(Math.abs(x))}`;
};
export const susd = (x: unknown, d = 2) => {
  if (!ok(x)) return "—";
  const s = x > 0 ? "+" : x < 0 ? MINUS : "";
  return `${s}$${fmt(d, d).format(Math.abs(x))}`;
};
/** Volatilite (ondalık) → 45,3 */
export const vol = (x: unknown, d = 1) => (ok(x) ? fmt(d, d).format(x * 100) : "—");
export const compact = (x: unknown) => {
  if (!ok(x)) return "—";
  const a = Math.abs(x);
  const [b, m, k] = L === "en" ? ["B", "M", "K"] : ["Mr", "Mn", "B"];
  if (a >= 1e9) return `${fmt(1, 1).format(x / 1e9)} ${b}`;
  if (a >= 1e6) return `${fmt(1, 1).format(x / 1e6)} ${m}`;
  if (a >= 1e3) return `${fmt(1, 1).format(x / 1e3)} ${k}`;
  return fmt(0, 0).format(x);
};
export const cls = (x: unknown) => (ok(x) ? (x > 0 ? "pos" : x < 0 ? "neg" : "") : "");

const MONTHS = {
  tr: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const MONTHS_LONG = {
  tr: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

export function dateTR(s?: string | null, long = false) {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return s;
  const mon = (long ? MONTHS_LONG : MONTHS)[L][m - 1];
  if (L === "en") return long ? `${mon} ${d}, ${y}` : `${mon} ${d}`;
  return `${d} ${mon}${long ? ` ${y}` : ""}`;
}
export const today = () => new Date().toISOString().slice(0, 10);

export function scoreColor(s: number | null | undefined) {
  if (!ok(s)) return "var(--line-strong)";
  if (s >= 70) return "#1f5c3d";
  if (s >= 60) return "#2e6b4a";
  if (s >= 50) return "#5b8a5f";
  if (s >= 40) return "#a0892f";
  return "#a5584a";
}

/** Gün sayısını insan diliyle: 7 gün · 1 hafta · 2 ay */
export function days(n: number | null | undefined) {
  if (!ok(n)) return "—";
  if (L === "en") return `${n} day${n === 1 ? "" : "s"}`;
  return `${n} gün`;
}
