// Bir kontratı Laboratuvar'a ya da Defter'e gönderme yardımcıları.
import { go } from "../lib/router";

export function legsParam(legs: any[]) {
  return encodeURIComponent(JSON.stringify(legs));
}

export function legsFor(r: any, qty = 1): any[] {
  const legs: any[] = [];
  if (r.strategy === "csp") legs.push({ cp: "P", strike: r.strike, expiry: r.expiry, side: "sell", qty, price: r.premium });
  if (r.strategy === "cc") {
    legs.push({ cp: "S", strike: 0, expiry: r.expiry, side: "buy", qty: 100 * qty, price: r.spot });
    legs.push({ cp: "C", strike: r.strike, expiry: r.expiry, side: "sell", qty, price: r.premium });
  }
  if (r.strategy === "pcs" || r.strategy === "ccs") {
    const cp = r.strategy === "pcs" ? "P" : "C";
    legs.push({ cp, strike: r.strike, expiry: r.expiry, side: "sell", qty, price: r.bid });
    legs.push({ cp, strike: r.long_strike, expiry: r.expiry, side: "buy", qty, price: r.long_ask });
  }
  if (r.strategy === "leaps") legs.push({ cp: "C", strike: r.strike, expiry: r.expiry, side: "buy", qty, price: r.premium });
  return legs;
}

export function toLab(r: any, qty = 1) {
  go(`/tools?tab=lab&ticker=${r.ticker}&legs=${legsParam(legsFor(r, qty))}`);
}

export function toJournal(r: any, qty = 1) {
  const q = new URLSearchParams({
    tab: "journal", add: "1", ticker: r.ticker, strategy: r.strategy,
    opt_type: r.strategy === "csp" || r.strategy === "pcs" ? "P" : "C",
    side: r.strategy === "leaps" ? "buy" : "sell", strike: String(r.strike), expiry: r.expiry, price: String(r.premium), qty: String(qty),
  });
  go(`/portfolio?${q.toString()}`);
}
