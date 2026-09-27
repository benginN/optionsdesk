// Kontratları ve hisseleri sade dille anlatan yardımcılar (TR / EN).
import { ReactNode } from "react";
import { dateTR, pct, strike, usd, usd0 } from "./format";

type T = (tr: string, en: string) => string;
const B = ({ children }: { children: ReactNode }) => <strong>{children}</strong>;

export type Strat = "csp" | "cc" | "leaps" | "pcs" | "ccs";
export type Risk = "cautious" | "balanced" | "bold";
export type Horizon = "1w" | "2w" | "1m";

export function stratName(s: Strat, t: T) {
  return {
    csp: t("Nakitle put sat", "Sell a cash-secured put"),
    cc: t("Hissene call yaz", "Write a covered call"),
    leaps: t("Uzun vadeli call al", "Buy a long-dated call"),
    pcs: t("Put kredi spread", "Put credit spread"),
    ccs: t("Call kredi spread", "Call credit spread"),
  }[s];
}

export function stratPitch(s: Strat, t: T) {
  return {
    csp: t("Almak istediğin hisseyi daha ucuza almak için beklerken kira topla.", "Collect rent while you wait to buy a stock you like at a lower price."),
    cc: t("Elindeki hisselerden her hafta ek gelir üret.", "Earn extra income from shares you already own."),
    leaps: t("Hissenin yükselişine çok daha az sermayeyle ortak ol.", "Ride a stock's upside with far less capital."),
    pcs: t("Put satışının riski sınırlı, daha az teminatlı hali.", "A lower-capital, risk-capped version of selling puts."),
    ccs: t("Hissenin yükselmeyeceğini düşünüyorsan sınırlı riskle prim topla.", "Collect premium with capped risk if you think a stock won't rise."),
  }[s];
}

/** Basit mod risk/süre tercihlerini tarayıcı filtrelerine çevirir */
export function filtersFor(s: Strat, risk: Risk, horizon: Horizon, budget: number | null, noEarnings: boolean) {
  const dteMap: Record<Horizon, [number, number]> = { "1w": [3, 9], "2w": [8, 17], "1m": [20, 45] };
  const deltaShort: Record<Risk, [number, number]> = { cautious: [0.08, 0.2], balanced: [0.15, 0.3], bold: [0.25, 0.42] };
  const deltaLeaps: Record<Risk, [number, number]> = { cautious: [0.75, 0.92], balanced: [0.65, 0.85], bold: [0.5, 0.7] };
  if (s === "leaps") {
    const [a, b] = deltaLeaps[risk];
    return { dte_min: 300, dte_max: 1000, delta_min: a, delta_max: b, min_oi: 10, max_spread_pct: 0.15, min_premium: 0, max_capital: budget ?? "", exclude_earnings: false };
  }
  const [d0, d1] = dteMap[horizon];
  const [a, b] = deltaShort[risk];
  return {
    dte_min: d0, dte_max: d1, delta_min: a, delta_max: b, min_oi: 50, max_spread_pct: 0.2,
    min_premium: s === "pcs" || s === "ccs" ? 10 : 5, max_capital: budget ?? "", exclude_earnings: noEarnings,
  };
}

/** Tek bir kontrat fikrini sade bir paragrafla anlatır */
export function explainContract(r: any, t: T, qty = 1): ReactNode {
  const tk = r.ticker;
  const d = dateTR(r.expiry, false);
  const k = `$${strike(r.strike)}`;
  const prem = usd0((r.premium || 0) * 100 * qty);
  if (r.strategy === "csp") {
    return isEn(t) ? (
      <>
        Sell the <B>{k} put</B> expiring <B>{d}</B> and collect <B>{prem}</B> today. If {tk} stays above {k} until then
        ({pct(r.p_otm ?? r.pop, 0)} chance), you keep it all. If it falls below, you buy {100 * qty} shares at an effective <B>{usd(r.breakeven)}</B>
        {" "}({pct(Math.abs(r.be_pct), 1)} below today). Cash to set aside: <B>{usd0(r.capital * qty)}</B>.
      </>
    ) : (
      <>
        <B>{d}</B> vadeli <B>{k} put</B> sat, bugün <B>{prem}</B> prim al. {tk} o tarihe kadar {k} üstünde kalırsa
        ({pct(r.p_otm ?? r.pop, 0)} olasılık) primin tamamı senin. Altına düşerse {100 * qty} hisseyi fiilen <B>{usd(r.breakeven)}</B> maliyetle
        almış olursun (bugünkü fiyatın {pct(Math.abs(r.be_pct), 1)} altında). Ayırman gereken nakit: <B>{usd0(r.capital * qty)}</B>.
      </>
    );
  }
  if (r.strategy === "cc") {
    return isEn(t) ? (
      <>
        Against 100 shares of {tk}, sell the <B>{k} call</B> expiring <B>{d}</B> and collect <B>{prem}</B>. If {tk} stays below {k}
        ({pct(r.p_otm ?? r.pop, 0)} chance), you keep the premium and the shares. If it rises above, your shares are sold at {k}
        ({pct(r.otm_pct, 1)} above today).
      </>
    ) : (
      <>
        Elindeki 100 {tk} hissesi için <B>{d}</B> vadeli <B>{k} call</B> sat, <B>{prem}</B> prim al. {tk} {k} altında kalırsa
        ({pct(r.p_otm ?? r.pop, 0)} olasılık) prim de hisseler de sende. Üstüne çıkarsa hisselerin {k} fiyatından satılır
        (bugünkü fiyatın {pct(r.otm_pct, 1)} üstünde).
      </>
    );
  }
  if (r.strategy === "leaps") {
    const months = Math.round((r.dte || 0) / 30);
    return isEn(t) ? (
      <>
        Instead of buying 100 shares for {usd0(r.stock_cost)}, buy the <B>{k} call</B> expiring <B>{dateTR(r.expiry, true)}</B> for <B>{usd0(r.capital)}</B>
        {" "}({pct(r.discount, 0)} less capital). It moves about {Math.round((r.delta || 0) * 100)}% as much as the stock. You profit above <B>{usd(r.breakeven)}</B> at expiry,
        and you have {months} months for it to work.
      </>
    ) : (
      <>
        100 hisseyi {usd0(r.stock_cost)} ödeyerek almak yerine <B>{dateTR(r.expiry, true)}</B> vadeli <B>{k} call</B> opsiyonunu <B>{usd0(r.capital)}</B> karşılığında al
        ({pct(r.discount, 0)} daha az sermaye). Hisse 1$ yükselirse opsiyon yaklaşık {Math.round((r.delta || 0) * 100)} sent kazanır. Vadede <B>{usd(r.breakeven)}</B> üstü kâr;
        bunun için {months} ayın var.
      </>
    );
  }
  // Kredi spread'leri
  const lk = `$${strike(r.long_strike)}`;
  return isEn(t) ? (
    <>
      Sell the <B>{k}</B> and buy the <B>{lk}</B> {r.cp === "P" ? "puts" : "calls"} expiring <B>{d}</B>: collect <B>{usd0(r.premium_total)}</B>, risk at most <B>{usd0(r.max_loss)}</B>.
      {" "}{pct(r.pop, 0)} chance of profit.
    </>
  ) : (
    <>
      <B>{d}</B> vadeli <B>{k}</B> {r.cp === "P" ? "put" : "call"} sat, <B>{lk}</B> al: <B>{usd0(r.premium_total)}</B> kredi al, en fazla <B>{usd0(r.max_loss)}</B> riske et.
      {" "}Kâr olasılığı {pct(r.pop, 0)}.
    </>
  );
}

function isEn(t: T) {
  return t("tr", "en") === "en";
}

/** Hissenin neden öne çıktığını anlatan kısa etiketler */
export function reasons(m: any, s: Strat, t: T): { label: string; tone?: "green" | "amber" | "red" | "blue" | "violet" }[] {
  const out: { label: string; tone?: "green" | "amber" | "red" | "blue" | "violet" }[] = [];
  const ivp = m.iv_pos;
  if (ivp != null) {
    if (ivp >= 60) out.push({ label: t("Opsiyonlar pahalı", "Options are pricey"), tone: s === "leaps" ? "amber" : "green" });
    else if (ivp <= 30) out.push({ label: t("Opsiyonlar ucuz", "Options are cheap"), tone: s === "leaps" ? "green" : "amber" });
  }
  if (m.vrp != null && m.vrp >= 1.15 && s !== "leaps") out.push({ label: t("Risk abartılı fiyatlanıyor", "Risk is overpriced"), tone: "green" });
  if (m.rsi14 != null) {
    if (m.rsi14 <= 35) out.push({ label: t("Son dönemde çok düştü", "Recently sold off"), tone: s === "cc" ? "amber" : "green" });
    else if (m.rsi14 >= 70) out.push({ label: t("Son dönemde çok yükseldi", "Recently ran up"), tone: s === "cc" ? "green" : "amber" });
  }
  const c = m[s] || m.c;
  if (c?.spread_pct != null && c.spread_pct <= 0.05) out.push({ label: t("Çok likit", "Very liquid"), tone: "blue" });
  if (s === "leaps" && c?.extrinsic_pct_yr != null && c.extrinsic_pct_yr <= 0.08) out.push({ label: t("Düşük zaman maliyeti", "Low time cost"), tone: "green" });
  const flags: string[] = (m.flags?.[s] ?? m.flags ?? []) as string[];
  if (Array.isArray(flags) && flags.length) out.push({ label: flags[0], tone: "red" });
  return out.slice(0, 4);
}

/** Hisse-düzeyi örnek kontratı tek cümleyle anlatır (tarayıcı kartları için) */
export function explainCandidate(_ticker: string, c: any, s: Strat, t: T): ReactNode {
  if (!c) return t("Şu an uygun kontrat yok.", "No suitable contract right now.");
  const d = dateTR(c.expiry);
  const k = `$${strike(c.strike)}`;
  if (s === "leaps") {
    return isEn(t) ? (
      <>A <B>{k} call</B> expiring {dateTR(c.expiry, true)} costs <B>{usd0(c.cost)}</B> instead of {usd0(c.stock_cost)} for 100 shares.</>
    ) : (
      <>{dateTR(c.expiry, true)} vadeli <B>{k} call</B> 100 hisse için {usd0(c.stock_cost)} yerine <B>{usd0(c.cost)}</B>.</>
    );
  }
  const prem = usd0((c.premium || 0) * 100);
  if (s === "cc") {
    return isEn(t) ? (
      <>A <B>{k} call</B> ({d}, {c.dte} days) pays <B>{prem}</B> per 100 shares — <B>{pct(c.yield, 2)}</B> on the stock.</>
    ) : (
      <><B>{k} call</B> ({d}, {c.dte} gün) 100 hisse başına <B>{prem}</B> öder; bu, hisse değerine göre <B>{pct(c.yield, 2)}</B> getiri.</>
    );
  }
  return isEn(t) ? (
    <>A <B>{k} put</B> ({d}, {c.dte} days) pays <B>{prem}</B> on {usd0(c.capital)} of cash — <B>{pct(c.yield, 2)}</B>, with a {pct(c.pop, 0)} chance to keep it all.</>
  ) : (
    <><B>{k} put</B> ({d}, {c.dte} gün) {usd0(c.capital)} nakit karşılığı <B>{prem}</B> öder — <B>{pct(c.yield, 2)}</B>; primin tamamının sende kalma olasılığı {pct(c.pop, 0)}.</>
  );
}
