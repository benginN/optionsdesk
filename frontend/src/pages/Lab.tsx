import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart } from "../components/Charts";
import { Icon } from "../components/Icon";
import { Callout, Card, ErrorBox, Info, Loading, Seg, Stat } from "../components/ui";
import { api } from "../lib/api";
import { bsGreeks, bsPrice, probAbove } from "../lib/bs";
import { cls, dateTR, num, pct, spct, strike, susd, usd, usd0, vol } from "../lib/format";
import { usePro, useT } from "../prefs";

type CP = "C" | "P" | "S";
interface Leg { cp: CP; strike: number; expiry: string; side: "buy" | "sell"; qty: number; price: number; iv?: number | null }

const yearsTo = (exp: string, daysForward = 0) => {
  const ms = Date.parse(`${exp}T20:00:00Z`) - Date.now() - daysForward * 86400000;
  return Math.max(ms, 0) / (365 * 86400000);
};

function legValue(l: Leg, S: number, T: number, r: number, ivShift: number) {
  if (l.cp === "S") return S;
  const iv = Math.max(0.01, (l.iv || 0.4) * (1 + ivShift));
  return bsPrice(S, l.strike, T, r, iv, l.cp);
}

function pnl(legs: Leg[], S: number, r: number, daysForward: number, ivShift: number, atExpiry: boolean, firstExp: string) {
  let tot = 0;
  for (const l of legs) {
    const mult = l.cp === "S" ? 1 : 100;
    const sign = l.side === "buy" ? 1 : -1;
    let v: number;
    if (atExpiry) {
      const T = l.cp === "S" ? 0 : Math.max(0, yearsTo(l.expiry) - yearsTo(firstExp));
      v = l.cp === "S" ? S : T <= 1e-6 ? (l.cp === "C" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S)) : legValue(l, S, T, r, ivShift);
    } else {
      v = legValue(l, S, yearsTo(l.expiry, daysForward), r, ivShift);
    }
    tot += sign * (v - l.price) * mult * l.qty;
  }
  return tot;
}

function ChainPicker({ sym, expiry, onExpiry, data, onPick }: { sym: string; expiry: string; onExpiry: (e: string) => void; data: any; onPick: (l: Leg) => void }) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const spot = data?.spot ?? 0;
  const rows = data ? (data.rows as any[]).filter((r) => Math.abs(r.strike / spot - 1) <= 0.25) : [];
  const atm = rows.length ? rows.reduce((a, b) => (Math.abs(b.strike - spot) < Math.abs(a.strike - spot) ? b : a)).strike : null;
  useEffect(() => {
    const box = boxRef.current;
    const row = box?.querySelector<HTMLTableRowElement>(`tr[data-atm="1"]`);
    if (box && row) box.scrollTop = row.offsetTop - box.clientHeight / 2;
  }, [data, atm]);
  if (!data) return null;
  const cell = (o: any, cp: "C" | "P", side: "buy" | "sell") => {
    if (!o) return <td>—</td>;
    const price = side === "sell" ? o.bid : o.ask;
    return (
      <td>
        <button className="btn xs ghost" style={{ color: side === "sell" ? "var(--red)" : "var(--green)" }} disabled={!price}
          title={`${side === "sell" ? t("Sat", "Sell") : t("Al", "Buy")} ${o.strike}${cp} @ ${price}`}
          onClick={() => onPick({ cp, strike: o.strike, expiry, side, qty: 1, price, iv: o.iv })}>{num(price)}</button>
      </td>
    );
  };
  return (
    <Card title={t(`${sym} opsiyon zinciri`, `${sym} option chain`)} right={
      <select className="select sm" value={expiry} onChange={(e) => onExpiry(e.target.value)}>
        {data.expiries.map((e: any) => <option key={e.expiry} value={e.expiry}>{dateTR(e.expiry)} · {e.dte}{t("g", "d")} · IV {vol(e.atm_iv)}</option>)}
      </select>
    } flush>
      <p className="small muted" style={{ padding: "0 22px 10px" }}>{t(`Bir fiyata tıkla: kırmızı (alış fiyatı) → sat, yeşil (satış fiyatı) → al. Fiyat ${usd(spot)}.`, `Click a price: red (bid) → sell, green (ask) → buy. Price ${usd(spot)}.`)}</p>
      <div className="table-wrap" ref={boxRef} style={{ maxHeight: 420, overflowY: "auto", position: "relative" }}>
        <table className="t compact">
          <thead>
            <tr><th>Δ</th><th>IV</th><th>Bid</th><th>Ask</th><th style={{ textAlign: "center" }}>Strike</th><th>Bid</th><th>Ask</th><th>IV</th><th>Δ</th></tr>
            <tr><th colSpan={4} style={{ textAlign: "center" }}>CALL</th><th /><th colSpan={4} style={{ textAlign: "center" }}>PUT</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const itmC = r.strike < spot;
              return (
                <tr key={r.strike} data-atm={r.strike === atm ? "1" : undefined}>
                  <td style={{ background: itmC ? "var(--surface-2)" : undefined }}>{num(r.call?.delta, 2)}</td>
                  <td style={{ background: itmC ? "var(--surface-2)" : undefined }}>{vol(r.call?.iv)}</td>
                  {cell(r.call, "C", "sell")}
                  {cell(r.call, "C", "buy")}
                  <td style={{ textAlign: "center", fontWeight: 650, boxShadow: r.strike === atm ? "inset 0 -2px 0 var(--ink)" : undefined }}>{strike(r.strike)}</td>
                  {cell(r.put, "P", "sell")}
                  {cell(r.put, "P", "buy")}
                  <td style={{ background: !itmC ? "var(--surface-2)" : undefined }}>{vol(r.put?.iv)}</td>
                  <td style={{ background: !itmC ? "var(--surface-2)" : undefined }}>{num(r.put?.delta, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function nearestDelta(rows: any[], side: "call" | "put", target: number) {
  let best: any = null;
  for (const r of rows) {
    const o = r[side];
    if (!o || o.delta == null || !o.bid) continue;
    if (!best || Math.abs(Math.abs(o.delta) - target) < Math.abs(Math.abs(best.delta) - target)) best = o;
  }
  return best;
}

export default function Lab({ query }: { query: URLSearchParams }) {
  const t = useT();
  const pro = usePro();
  const [sym, setSym] = useState((query.get("ticker") || "SPY").toUpperCase());
  const [input, setInput] = useState(sym);
  const [expiry, setExpiry] = useState<string>("");
  const [chain, setChain] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [legs, setLegs] = useState<Leg[]>(() => {
    try {
      const p = query.get("legs");
      return p ? JSON.parse(decodeURIComponent(p)) : [];
    } catch {
      return [];
    }
  });
  const [days, setDays] = useState(0);
  const [ivShift, setIvShift] = useState(0);
  const [view, setView] = useState<"both" | "exp">("both");

  useEffect(() => {
    const tk = query.get("ticker");
    if (tk) { setSym(tk.toUpperCase()); setInput(tk.toUpperCase()); }
    const p = query.get("legs");
    if (p) {
      try {
        const l = JSON.parse(decodeURIComponent(p));
        setLegs(l);
        setExpiry(l.find((x: Leg) => x.cp !== "S")?.expiry || "");
      } catch { /* yok say */ }
    }
  }, [query]);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    api(`/chain/${sym}${expiry ? `?expiry=${expiry}` : ""}`)
      .then((d) => { setChain(d); if (!expiry && d.expiry) setExpiry(d.expiry); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [sym, expiry]);

  useEffect(() => {
    const need = legs.filter((l) => l.cp !== "S" && (l.iv === undefined || l.iv === null));
    if (!need.length) return;
    const exps = Array.from(new Set(need.map((l) => l.expiry)));
    Promise.all(exps.map((e) => api(`/chain/${sym}?expiry=${e}`).catch(() => null))).then((res) => {
      const map = new Map<string, any>();
      res.forEach((d, i) => d && map.set(exps[i], d));
      setLegs((cur) => cur.map((l) => {
        if (l.cp === "S" || (l.iv !== undefined && l.iv !== null)) return l;
        const d = map.get(l.expiry);
        const row = d?.rows?.find((r: any) => Math.abs(r.strike - l.strike) < 1e-6);
        const o = row?.[l.cp === "C" ? "call" : "put"];
        const atm = d?.expiries?.find((e: any) => e.expiry === l.expiry)?.atm_iv;
        return { ...l, iv: o?.iv ?? atm ?? 0.4 };
      }));
    });
  }, [legs, sym]);

  const spot = chain?.spot ?? 0;
  const r = chain?.rate ?? 0.04;
  const optLegs = legs.filter((l) => l.cp !== "S");
  const firstExp = optLegs.map((l) => l.expiry).sort()[0] || expiry;
  const atmIv = chain?.expiries?.find((e: any) => e.expiry === firstExp)?.atm_iv || 0.3;
  const Tfirst = yearsTo(firstExp);

  const calc = useMemo(() => {
    if (!legs.length || !spot) return null;
    const sd = atmIv * Math.sqrt(Math.max(Tfirst, 1 / 365));
    const range = Math.min(0.6, Math.max(0.12, 3 * sd));
    const lo = spot * (1 - range);
    const hi = spot * (1 + range);
    const N = 160;
    const xs = Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N);
    const expC = xs.map((S) => pnl(legs, S, r, 0, ivShift, true, firstExp));
    const nowC = xs.map((S) => pnl(legs, S, r, days, ivShift, false, firstExp));
    // Uç noktalar: hisse sıfıra giderse ve çok yükselirse (grafik aralığının dışı)
    const atZero = pnl(legs, 0.01, r, 0, ivShift, true, firstExp);
    const atHigh = pnl(legs, spot * 5, r, 0, ivShift, true, firstExp);
    const slopeHi = expC[N] - expC[N - 1];
    const unlimitedUp = slopeHi > 1e-6;     // fiyat yükseldikçe kâr sınırsız artar
    const unlimitedDown = slopeHi < -1e-6;  // fiyat yükseldikçe zarar sınırsız artar (açık call)
    const maxP = Math.max(...expC, atZero, unlimitedUp ? -Infinity : atHigh);
    const minP = Math.min(...expC, atZero, unlimitedDown ? Infinity : atHigh);
    const bes: number[] = [];
    for (let i = 1; i < xs.length; i++) {
      if ((expC[i - 1] < 0 && expC[i] >= 0) || (expC[i - 1] >= 0 && expC[i] < 0)) {
        bes.push(xs[i - 1] + ((0 - expC[i - 1]) / (expC[i] - expC[i - 1])) * (xs[i] - xs[i - 1]));
      }
    }
    let pop = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      if ((expC[i] + expC[i + 1]) / 2 > 0) pop += probAbove(spot, xs[i], Tfirst, atmIv) - probAbove(spot, xs[i + 1], Tfirst, atmIv);
    }
    if (expC[0] > 0) pop += 1 - probAbove(spot, xs[0], Tfirst, atmIv);
    if (expC[N] > 0) pop += probAbove(spot, xs[N], Tfirst, atmIv);
    let debit = 0;
    const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
    for (const l of legs) {
      const sign = l.side === "buy" ? 1 : -1;
      const mult = l.cp === "S" ? 1 : 100;
      debit += sign * l.price * mult * l.qty;
      if (l.cp === "S") g.delta += sign * l.qty;
      else {
        const gr = bsGreeks(spot, l.strike, yearsTo(l.expiry), r, (l.iv || 0.4) * (1 + ivShift), l.cp);
        g.delta += sign * gr.delta * 100 * l.qty;
        g.gamma += sign * gr.gamma * 100 * l.qty;
        g.theta += sign * gr.theta * 100 * l.qty;
        g.vega += sign * gr.vega * 100 * l.qty;
      }
    }
    let capital = debit > 0 ? debit : 0;
    const shortPuts = legs.filter((l) => l.cp === "P" && l.side === "sell");
    const hasStock = legs.some((l) => l.cp === "S" && l.side === "buy");
    if (!unlimitedDown && minP < 0) capital = Math.max(capital, -minP);
    if (shortPuts.length && optLegs.length === shortPuts.length && !hasStock) capital = shortPuts.reduce((a, l) => a + l.strike * 100 * l.qty, 0);
    const scen = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2].map((mv) => ({
      m: mv, exp: pnl(legs, spot * (1 + mv), r, 0, ivShift, true, firstExp), now: pnl(legs, spot * (1 + mv), r, days, ivShift, false, firstExp),
    }));
    const profitZone: [number, number][] = [];
    let start: number | null = null;
    xs.forEach((x, i) => {
      if (expC[i] > 0 && start === null) start = x;
      if ((expC[i] <= 0 || i === xs.length - 1) && start !== null) { profitZone.push([start, x]); start = null; }
    });
    return { xs, expC, nowC, maxP, minP, unlimitedUp, unlimitedDown, bes, pop, debit, g, capital, scen, sd, profitZone, lo, hi };
  }, [legs, spot, r, days, ivShift, firstExp, atmIv, Tfirst, optLegs.length]);

  const addLeg = (l: Leg) => setLegs([...legs, l]);
  const updLeg = (i: number, patch: Partial<Leg>) => setLegs(legs.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  const rmLeg = (i: number) => setLegs(legs.filter((_, j) => j !== i));

  const PRESETS: [string, string, string, string, string][] = [
    ["csp", "Put sat (CSP)", "Sell a put (CSP)", "Almak istediğin hisseden prim topla.", "Collect premium on a stock you'd buy."],
    ["cc", "Covered call", "Covered call", "Hissen varken call sat.", "Sell a call against your shares."],
    ["collar", "Collar (koruma)", "Collar (protection)", "Call satıp put al: alt ve üst sınır.", "Sell a call, buy a put: a floor and a cap."],
    ["pcs", "Put spread", "Put spread", "Riski sınırlı put satışı.", "Risk-capped put selling."],
    ["ccs", "Call spread", "Call spread", "Riski sınırlı call satışı.", "Risk-capped call selling."],
    ["ic", "Iron condor", "Iron condor", "Hisse bir aralıkta kalırsa kazan.", "Profit if the stock stays in a range."],
    ["strangle", "Short strangle", "Short strangle", "İki taraftan prim; risk yüksek.", "Premium from both sides; high risk."],
    ["straddle", "Long straddle", "Long straddle", "Büyük bir hareketten kazan.", "Profit from a big move either way."],
    ["leaps", "LEAPS", "LEAPS", "Uzun vadeli call ile hisseye ortak ol.", "Own the upside with a long-dated call."],
    ["pmcc", "PMCC", "PMCC", "LEAPS al, üstüne kısa vadeli call sat.", "Buy a LEAPS, sell short-term calls on it."],
  ];

  const preset = async (name: string) => {
    if (!chain) return;
    const rows = chain.rows as any[];
    const e = chain.expiry;
    const mk = (o: any, cp: "C" | "P", side: "buy" | "sell", qty = 1): Leg => ({ cp, strike: o.strike, expiry: e, side, qty, price: side === "sell" ? o.bid : o.ask, iv: o.iv });
    const p25 = nearestDelta(rows, "put", 0.25);
    const c20 = nearestDelta(rows, "call", 0.2);
    const p15 = nearestDelta(rows, "put", 0.15);
    const c15 = nearestDelta(rows, "call", 0.15);
    const p10 = nearestDelta(rows, "put", 0.08);
    const c10 = nearestDelta(rows, "call", 0.08);
    const atmC = nearestDelta(rows, "call", 0.5);
    const atmP = nearestDelta(rows, "put", 0.5);
    const stock: Leg = { cp: "S", strike: 0, expiry: e, side: "buy", qty: 100, price: spot };
    const off = (o: any, cp: "call" | "put", steps: number) => {
      const i = rows.findIndex((x) => x.strike === o.strike);
      return rows[i + (cp === "put" ? -steps : steps)]?.[cp];
    };
    let L: Leg[] = [];
    switch (name) {
      case "csp": L = [mk(p25, "P", "sell")]; break;
      case "cc": L = [stock, mk(c20, "C", "sell")]; break;
      case "collar": L = [stock, mk(c20, "C", "sell"), mk(nearestDelta(rows, "put", 0.2), "P", "buy")]; break;
      case "pcs": { const lo = off(p25, "put", 2); L = lo ? [mk(p25, "P", "sell"), mk(lo, "P", "buy")] : []; break; }
      case "ccs": { const hi = off(c20, "call", 2); L = hi ? [mk(c20, "C", "sell"), mk(hi, "C", "buy")] : []; break; }
      case "ic": L = [mk(p15, "P", "sell"), mk(p10, "P", "buy"), mk(c15, "C", "sell"), mk(c10, "C", "buy")]; break;
      case "strangle": L = [mk(p15, "P", "sell"), mk(c15, "C", "sell")]; break;
      case "straddle": L = [mk(atmC, "C", "buy"), mk(atmP, "P", "buy")]; break;
      case "leaps":
      case "pmcc": {
        const far = (chain.expiries as any[]).filter((x) => x.dte >= 300);
        const target = far.sort((a, b) => Math.abs(a.dte - 540) - Math.abs(b.dte - 540))[0];
        if (!target) break;
        const d = await api(`/chain/${sym}?expiry=${target.expiry}`);
        const lc = nearestDelta(d.rows, "call", 0.75);
        if (!lc) break;
        const leap: Leg = { cp: "C", strike: lc.strike, expiry: target.expiry, side: "buy", qty: 1, price: lc.ask, iv: lc.iv };
        L = name === "leaps" ? [leap] : [leap, mk(c20, "C", "sell")];
        break;
      }
    }
    if (L.length) setLegs(L.filter((l) => l.cp === "S" || l.strike));
  };

  const load = () => { setSym(input); setExpiry(""); setLegs([]); };

  const series = calc ? [
    { name: t("Vade sonunda", "At expiry"), color: "var(--series-1)", points: calc.xs.map((x, i) => ({ x, y: calc.expC[i] })) },
    ...(view === "both" ? [{ name: days ? t(`${days} gün sonra`, `In ${days} days`) : t("Bugün", "Today"), color: "var(--series-2)", dashed: true, points: calc.xs.map((x, i) => ({ x, y: calc.nowC[i] })) }] : []),
  ] : [];

  let summary: string | null = null;
  if (calc) {
    const f = (x: number) => usd(x, x >= 100 ? 0 : 2);
    const zone = calc.profitZone.map(([a, b]) => {
      const lowOpen = a <= calc.lo + 1e-6;
      const highOpen = b >= calc.hi - 1e-6;
      if (lowOpen && highOpen) return t("her seviyede", "at any level");
      if (lowOpen) return t(`${f(b)} altında`, `below ${f(b)}`);
      if (highOpen) return t(`${f(a)} üstünde`, `above ${f(a)}`);
      return t(`${f(a)} ile ${f(b)} arasında`, `between ${f(a)} and ${f(b)}`);
    }).join(t(" veya ", " or "));
    summary = t(
      `Bu kurulumla ${dateTR(firstExp)} vadesinde en fazla ${calc.unlimitedUp ? "sınırsız" : usd0(calc.maxP)} kazanır, en fazla ${calc.unlimitedDown ? "çok büyük bir tutar" : usd0(Math.abs(calc.minP))} kaybedersin. ${zone ? `Hisse ${zone} kapanırsa kârdasın` : "Kârlı bir bölge yok"} (olasılık ${pct(calc.pop, 0)}).`,
      `With this setup, at the ${dateTR(firstExp)} expiry you make at most ${calc.unlimitedUp ? "an unlimited amount" : usd0(calc.maxP)} and lose at most ${calc.unlimitedDown ? "a very large amount" : usd0(Math.abs(calc.minP))}. ${zone ? `You profit if the stock closes ${zone}` : "There's no profit zone"} (${pct(calc.pop, 0)} chance).`,
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Card>
        <div className="row" style={{ gap: 10 }}>
          <input className="input" style={{ width: 120 }} value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && load()} />
          <button className="btn" onClick={load}>{t("Yükle", "Load")}</button>
          {chain && <span className="muted">{chain.ticker} {usd(chain.spot)} <span className={cls(chain.change_pct)}>{spct(chain.change_pct)}</span></span>}
        </div>
        <div className="mt16">
          <div className="small muted" style={{ marginBottom: 8 }}>{t("Hazır bir stratejiyle başla:", "Start from a ready-made strategy:")}</div>
          <div className="row" style={{ gap: 6 }}>
            {PRESETS.map(([k, tr, en, dtr, den]) => <button key={k} className="btn sm" disabled={!chain} title={t(dtr, den)} onClick={() => preset(k)}>{t(tr, en)}</button>)}
          </div>
        </div>
      </Card>

      {err && <ErrorBox error={err} />}
      {loading && !chain && <Loading />}
      {summary && <Callout tone="info" icon="sparkle"><span style={{ fontSize: 15 }}>{summary}</span></Callout>}

      <div className="grid g2">
        <div className="stack">
          <Card title={t("Bacaklar", "Legs")} right={legs.length ? <button className="btn xs ghost danger" onClick={() => setLegs([])}>{t("Temizle", "Clear")}</button> : undefined}>
            {!legs.length ? <p className="muted">{t("Henüz bacak yok. Zincirden bir fiyata tıkla ya da hazır bir strateji seç.", "No legs yet. Click a price in the chain or pick a ready-made strategy.")}</p> : (
              <div className="stack" style={{ gap: 8 }}>
                <div className="leg-row small muted hide-sm"><span>{t("Yön", "Side")}</span><span>{t("Tip", "Type")}</span><span>{t("Vade", "Expiry")}</span><span>Strike</span><span>{t("Adet", "Qty")}</span><span>{t("Fiyat", "Price")}</span><span /></div>
                {legs.map((l, i) => (
                  <div className="leg-row" key={i}>
                    <select className="select sm" value={l.side} onChange={(e) => updLeg(i, { side: e.target.value as any })}>
                      <option value="buy">{t("Al", "Buy")}</option><option value="sell">{t("Sat", "Sell")}</option>
                    </select>
                    <select className="select sm" value={l.cp} onChange={(e) => updLeg(i, { cp: e.target.value as CP })}>
                      <option value="C">Call</option><option value="P">Put</option><option value="S">{t("Hisse", "Stock")}</option>
                    </select>
                    <span className="small">{l.cp === "S" ? "—" : `${dateTR(l.expiry)} · IV ${vol(l.iv)}`}</span>
                    {l.cp === "S" ? <span className="muted small">—</span> : <input className="input sm" type="number" value={l.strike} onChange={(e) => updLeg(i, { strike: Number(e.target.value) })} />}
                    <input className="input sm" type="number" value={l.qty} onChange={(e) => updLeg(i, { qty: Number(e.target.value) })} />
                    <input className="input sm" type="number" step="0.01" value={l.price} onChange={(e) => updLeg(i, { price: Number(e.target.value) })} />
                    <button className="btn xs ghost" onClick={() => rmLeg(i)} aria-label="remove"><Icon name="x" size={14} /></button>
                  </div>
                ))}
                <p className="small muted">{t("Hisse bacağında adet = hisse sayısı; opsiyonda kontrat (×100).", "For stock, qty = shares; for options, contracts (×100).")}</p>
              </div>
            )}
          </Card>
          <ChainPicker sym={sym} expiry={expiry} onExpiry={setExpiry} data={chain} onPick={addLeg} />
        </div>

        <div className="stack">
          {calc ? (
            <>
              <Card title={t("Kâr / zarar", "Profit / loss")} right={<Seg sm value={view} onChange={setView} options={[{ v: "both", l: t("Vade + bugün", "Expiry + today") }, { v: "exp", l: t("Sadece vade", "Expiry only") }]} />}>
                <LineChart height={270} series={series} zeroFill
                  vlines={[{ x: spot, label: t("Fiyat", "Price") }, ...calc.bes.map((b) => ({ x: b, color: "var(--muted)" }))]}
                  xFmt={(x) => num(x, x >= 100 ? 0 : 1)} yFmt={(y) => usd0(y)} tipTitle={(x) => `${usd(x)} (${spct(x / spot - 1, 1)})`} />
                <div className="grid g2 mt12" style={{ gap: 16 }}>
                  <div className="field">
                    <label>{t(`Zaman: ${days} gün sonrası`, `Time: ${days} days from now`)}</label>
                    <input type="range" min={0} max={Math.max(1, Math.floor(Tfirst * 365))} value={days} onChange={(e) => setDays(Number(e.target.value))} />
                  </div>
                  <div className="field">
                    <label>{t(`Oynaklık (IV) değişimi: ${spct(ivShift, 0)}`, `Volatility (IV) change: ${spct(ivShift, 0)}`)}</label>
                    <input type="range" min={-50} max={50} value={ivShift * 100} onChange={(e) => setIvShift(Number(e.target.value) / 100)} />
                  </div>
                </div>
              </Card>
              <Card>
                <div className="stats-row">
                  <Stat k={calc.debit >= 0 ? t("Ödediğin", "You pay") : t("Aldığın", "You receive")} v={usd0(Math.abs(calc.debit))} />
                  <Stat k={t("En fazla kâr", "Max profit")} v={calc.unlimitedUp ? t("Sınırsız", "Unlimited") : usd0(calc.maxP)} />
                  <Stat k={t("En fazla zarar", "Max loss")} v={calc.unlimitedDown ? t("Çok büyük", "Very large") : usd0(calc.minP)} />
                  <Stat k={t("Başabaş", "Breakeven")} v={calc.bes.length ? calc.bes.map((b) => num(b, 2)).join(" / ") : "—"} />
                  <Stat k={t("Kâr olasılığı", "Chance of profit")} info="pop" v={pct(calc.pop, 0)} />
                  <Stat k={t("Gereken sermaye", "Capital needed")} v={usd0(calc.capital)} />
                </div>
                {pro && (
                  <>
                    <div className="divider" />
                    <div className="stats-row">
                      <Stat k="Delta" info="delta" v={num(calc.g.delta, 1)} />
                      <Stat k="Gamma" info="gamma" v={num(calc.g.gamma, 2)} />
                      <Stat k={t("Theta / gün", "Theta / day")} info="theta" v={susd(calc.g.theta, 2)} />
                      <Stat k="Vega" info="vega" v={susd(calc.g.vega, 2)} />
                      <Stat k="1σ" info="em" v={`±${pct(calc.sd)}`} />
                    </div>
                  </>
                )}
              </Card>
              <Card title={t("Senaryolar", "Scenarios")} flush>
                <table className="t compact">
                  <thead><tr><th className="l">{t("Hisse", "Stock")}</th><th>{t("Fiyat", "Price")}</th><th>{t("Vade sonunda", "At expiry")}</th><th>{days ? t(`${days} gün sonra`, `In ${days} days`) : t("Bugün", "Today")}</th></tr></thead>
                  <tbody>
                    {calc.scen.map((s) => (
                      <tr key={s.m}>
                        <td className="l">{s.m === 0 ? t("değişmezse", "unchanged") : spct(s.m, 0)}</td>
                        <td>{usd(spot * (1 + s.m))}</td>
                        <td className={cls(s.exp)}>{susd(s.exp, 0)}</td>
                        <td className={cls(s.now)}>{susd(s.now, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <p className="small muted row" style={{ gap: 6 }}>
                <Info text={t("Uzun vadeli bacaklar (PMCC/takvim) kalan süreyle Black-Scholes ile değerlenir. Temettü ve erken kullanım dikkate alınmaz.", "Longer-dated legs (PMCC/calendar) are valued with Black-Scholes for their remaining time. Dividends and early exercise are ignored.")} />
                {t("Model varsayımları", "Model assumptions")}
              </p>
            </>
          ) : <Card><p className="muted">{t("Grafik için en az bir bacak ekle.", "Add at least one leg to see the chart.")}</p></Card>}
        </div>
      </div>
    </div>
  );
}
