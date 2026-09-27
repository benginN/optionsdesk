// Black-Scholes: Laboratuvar'daki kâr/zarar eğrileri ve Greeks için.

export function ncdf(x: number): number {
  // Abramowitz-Stegun 7.1.26 (erf yaklaşımı)
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function npdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function bsPrice(S: number, K: number, T: number, r: number, sigma: number, cp: "C" | "P"): number {
  if (T <= 0) return cp === "C" ? Math.max(0, S - K) : Math.max(0, K - S);
  const s = Math.max(sigma, 1e-4);
  const d1 = (Math.log(S / K) + (r + 0.5 * s * s) * T) / (s * Math.sqrt(T));
  const d2 = d1 - s * Math.sqrt(T);
  return cp === "C"
    ? S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2)
    : K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
}

export function bsGreeks(S: number, K: number, T: number, r: number, sigma: number, cp: "C" | "P") {
  const t = Math.max(T, 1e-6);
  const s = Math.max(sigma, 1e-4);
  const d1 = (Math.log(S / K) + (r + 0.5 * s * s) * t) / (s * Math.sqrt(t));
  const d2 = d1 - s * Math.sqrt(t);
  const gamma = npdf(d1) / (S * s * Math.sqrt(t));
  const vega = (S * npdf(d1) * Math.sqrt(t)) / 100;
  const delta = cp === "C" ? ncdf(d1) : ncdf(d1) - 1;
  const theta =
    cp === "C"
      ? (-S * npdf(d1) * s / (2 * Math.sqrt(t)) - r * K * Math.exp(-r * t) * ncdf(d2)) / 365
      : (-S * npdf(d1) * s / (2 * Math.sqrt(t)) + r * K * Math.exp(-r * t) * ncdf(-d2)) / 365;
  return { delta, gamma, theta, vega };
}

/** Lognormal: vade sonunda fiyatın K üstünde olma olasılığı */
export function probAbove(S: number, K: number, T: number, sigma: number, mu = 0) {
  if (T <= 0) return S > K ? 1 : 0;
  const s = Math.max(sigma, 1e-4);
  const d2 = (Math.log(S / K) + (mu - 0.5 * s * s) * T) / (s * Math.sqrt(T));
  return ncdf(d2);
}
