import { useEffect, useState } from "react";
import { StrikeBars } from "../components/Charts";
import { Icon } from "../components/Icon";
import { Col, Table } from "../components/Table";
import { Callout, Card, Empty, ErrorBox, Field, Info, Modal, Pill, Seg, Skeleton, Stat, TickerLink, Toggle } from "../components/ui";
import { api, useApi } from "../lib/api";
import { cls, compact, dateTR, num, pct, strike, susd, today, usd, usd0 } from "../lib/format";
import { go } from "../lib/router";
import { usePro, useT } from "../prefs";

const STRATS: [string, string, string][] = [
  ["csp", "Nakitle put satışı (CSP)", "Cash-secured put"], ["cc", "Covered call", "Covered call"],
  ["pcs", "Put spread (kısa bacak)", "Put spread (short leg)"], ["ccs", "Call spread (kısa bacak)", "Call spread (short leg)"],
  ["leaps", "LEAPS", "LEAPS"], ["long", "Opsiyon alımı", "Long option"], ["hedge", "Koruma", "Hedge"], ["other", "Diğer", "Other"],
];

function useStatusTr() {
  const t = useT();
  return (s: string) => ({
    open: t("Açık", "Open"), expired: t("Değersiz bitti", "Expired worthless"), closed: t("Kapatıldı", "Closed"),
    assigned: t("Atandı", "Assigned"), exercised: t("Kullanıldı", "Exercised"), rolled: t("Roll edildi", "Rolled"),
  }[s] || s);
}
const STATUS_TONE: Record<string, any> = { open: "blue", expired: "green", assigned: "amber", exercised: "amber" };

function TradeForm({ initial, onDone, onCancel }: { initial?: any; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [f, setF] = useState<any>({
    ticker: "", strategy: "csp", opt_type: "P", side: "sell", strike: "", expiry: "", qty: 1, open_date: today(), open_price: "", fees: "", notes: "", ...initial,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: any) => {
    const n = { ...f, [k]: v };
    if (k === "strategy") {
      if (v === "csp" || v === "pcs") Object.assign(n, { opt_type: "P", side: "sell" });
      if (v === "cc" || v === "ccs") Object.assign(n, { opt_type: "C", side: "sell" });
      if (v === "leaps") Object.assign(n, { opt_type: "C", side: "buy" });
    }
    setF(n);
  };
  const save = async () => {
    setErr(null);
    try {
      if (initial?.id) await api(`/journal/${initial.id}`, { method: "PUT", json: f });
      else await api("/journal", { json: f });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const premium = Number(f.open_price) * 100 * Number(f.qty);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="form-grid">
        <Field label={t("Hisse", "Stock")}><input className="input" value={f.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} /></Field>
        <Field label={t("Strateji", "Strategy")}>
          <select className="select" value={f.strategy} onChange={(e) => set("strategy", e.target.value)}>
            {STRATS.map(([v, tr, en]) => <option key={v} value={v}>{t(tr, en)}</option>)}
          </select>
        </Field>
        <Field label={t("Yön", "Side")}>
          <select className="select" value={f.side} onChange={(e) => set("side", e.target.value)}>
            <option value="sell">{t("Sattım", "Sold")}</option><option value="buy">{t("Aldım", "Bought")}</option>
          </select>
        </Field>
        <Field label={t("Tip", "Type")}>
          <select className="select" value={f.opt_type} onChange={(e) => set("opt_type", e.target.value)}>
            <option value="P">Put</option><option value="C">Call</option>
          </select>
        </Field>
        <Field label="Strike"><input className="input" type="number" step="0.5" value={f.strike} onChange={(e) => set("strike", e.target.value)} /></Field>
        <Field label={t("Vade", "Expiry")}><input className="input" type="date" value={f.expiry} onChange={(e) => set("expiry", e.target.value)} /></Field>
        <Field label={t("Kontrat adedi", "Contracts")}><input className="input" type="number" value={f.qty} onChange={(e) => set("qty", e.target.value)} /></Field>
        <Field label={t("Fiyat (hisse başı)", "Price (per share)")}><input className="input" type="number" step="0.01" value={f.open_price} onChange={(e) => set("open_price", e.target.value)} /></Field>
        <Field label={t("İşlem tarihi", "Trade date")}><input className="input" type="date" value={f.open_date} onChange={(e) => set("open_date", e.target.value)} /></Field>
        <Field label={t("Komisyon ($)", "Fees ($)")}><input className="input" type="number" step="0.01" value={f.fees} onChange={(e) => set("fees", e.target.value)} /></Field>
      </div>
      <Field label={t("Not", "Note")}><input className="input" value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} /></Field>
      {premium > 0 && (
        <Callout tone="info">
          {f.side === "sell" ? t(`Hesabına ${usd(premium)} prim geçer.`, `${usd(premium)} of premium lands in your account.`) : t(`${usd(premium)} ödersin.`, `You pay ${usd(premium)}.`)}
          {f.side === "sell" && f.opt_type === "P" && f.strike && ` ${t("Ayırman gereken nakit", "Cash to set aside")}: ${usd0(Number(f.strike) * 100 * Number(f.qty))} · ${t("getiri", "yield")} ${pct(Number(f.open_price) / Number(f.strike), 2)}.`}
        </Callout>
      )}
      {err && <ErrorBox error={err} />}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>{t("Vazgeç", "Cancel")}</button>
        <button className="btn primary" onClick={save}>{t("Kaydet", "Save")}</button>
      </div>
    </div>
  );
}

function CloseForm({ tr, onDone, onCancel }: { tr: any; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [action, setAction] = useState<string>(tr.itm ? "assigned" : "expired");
  const [price, setPrice] = useState<string>(tr.mark ? String(tr.mark) : "");
  const [date, setDate] = useState<string>(tr.expiry <= today() ? tr.expiry : today());
  const [fees, setFees] = useState("");
  const [updH, setUpdH] = useState(true);
  const [roll, setRoll] = useState<any>({ strike: tr.strike, expiry: "", price: "" });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      await api(`/journal/${tr.id}/close`, { json: { action, price, date, fees, update_holdings: updH, roll: action === "rolled" ? roll : null } });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const help: Record<string, string> = {
    expired: t("Kontrat vadede değersiz bitti; primin tamamı senin.", "The contract expired worthless; you keep the whole premium."),
    closed: t("Kontratı vadeden önce geri alarak (ya da satarak) kapattın.", "You closed the contract before expiry by buying it back (or selling it)."),
    assigned: t("Karşı taraf kullandı: put'ta hisseyi aldın, call'da hisseni sattın.", "It was exercised: with a put you bought the shares, with a call you sold them."),
    rolled: t("Kapatıp aynı anda daha ileri vadeye yeniden açtın.", "You closed it and reopened at a later date in one go."),
    exercised: t("Aldığın opsiyonu kullandın.", "You exercised an option you bought."),
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <p><strong>{tr.ticker}</strong> {dateTR(tr.expiry)} ${strike(tr.strike)} {tr.opt_type === "P" ? "put" : "call"} · {tr.side === "sell" ? t("satış", "sold") : t("alış", "bought")} @ {num(tr.open_price)} × {tr.qty}</p>
      <Seg value={action} onChange={setAction} options={[
        { v: "expired", l: t("Değersiz bitti", "Expired") }, { v: "closed", l: t("Kapattım", "Closed") },
        { v: "assigned", l: t("Atandım", "Assigned") }, { v: "rolled", l: "Roll" }, { v: "exercised", l: t("Kullandım", "Exercised") },
      ]} />
      <p className="small muted">{help[action]}</p>
      <div className="form-grid">
        {(action === "closed" || action === "rolled" || action === "exercised") && (
          <Field label={t("Kapanış fiyatı", "Closing price")}><input className="input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        )}
        <Field label={t("Tarih", "Date")}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t("Komisyon ($)", "Fees ($)")}><input className="input" type="number" step="0.01" value={fees} onChange={(e) => setFees(e.target.value)} /></Field>
      </div>
      {action === "assigned" && (
        <Toggle checked={updH} onChange={setUpdH} label={tr.opt_type === "P"
          ? t(`Hisselerime ${tr.qty * 100} adet ${tr.ticker} ekle (${usd(tr.strike)} maliyetle)`, `Add ${tr.qty * 100} ${tr.ticker} shares to my holdings (at ${usd(tr.strike)})`)
          : t(`Hisselerimden ${tr.qty * 100} adet ${tr.ticker} düş`, `Remove ${tr.qty * 100} ${tr.ticker} shares from my holdings`)} />
      )}
      {action === "rolled" && (
        <div className="form-grid">
          <Field label={t("Yeni strike", "New strike")}><input className="input" type="number" step="0.5" value={roll.strike} onChange={(e) => setRoll({ ...roll, strike: e.target.value })} /></Field>
          <Field label={t("Yeni vade", "New expiry")}><input className="input" type="date" value={roll.expiry} onChange={(e) => setRoll({ ...roll, expiry: e.target.value })} /></Field>
          <Field label={t("Yeni prim", "New premium")}><input className="input" type="number" step="0.01" value={roll.price} onChange={(e) => setRoll({ ...roll, price: e.target.value })} /></Field>
        </div>
      )}
      {err && <ErrorBox error={err} />}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>{t("Vazgeç", "Cancel")}</button>
        <button className="btn primary" onClick={save}>{t("Kaydet", "Save")}</button>
      </div>
    </div>
  );
}

function PositionCard({ p, onClose }: { p: any; onClose: () => void }) {
  const t = useT();
  const sell = p.side === "sell";
  const captured = p.captured != null ? Math.max(0, Math.min(1, p.captured)) : null;
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <a href={`#/stock/${p.ticker}`} style={{ color: "inherit" }}><h3 style={{ fontSize: 17 }}>{p.ticker}</h3></a>
            {p.itm != null && <Pill tone={p.itm ? "red" : "green"}>{p.itm ? t("Strike'ın içinde", "In the money") : t("Güvenli bölgede", "Out of the money")}</Pill>}
          </div>
          <div className="small ink2 mt4">
            {sell ? t("Sattın", "Sold") : t("Aldın", "Bought")} {p.qty} × {dateTR(p.expiry)} ${strike(p.strike)} {p.opt_type === "P" ? "put" : "call"} @ {num(p.open_price)}
            {p.dte != null && p.dte >= 0 && <span className="muted"> · {t(`${p.dte} gün kaldı`, `${p.dte} days left`)}</span>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={`num ${cls(p.unrealized)}`} style={{ fontSize: 20, fontWeight: 650 }}>{susd(p.unrealized, 0)}</div>
          <div className="small muted">{t("şu anki K/Z", "current P/L")}</div>
        </div>
      </div>
      {sell && captured != null && (
        <div>
          <div className="row-between small"><span className="ink2">{t(`Primin yüzde ${Math.round(captured * 100)} kadarı kazanıldı`, `${Math.round(captured * 100)}% of the premium earned`)}</span><span className="muted">{usd0(p.premium_total)}</span></div>
          <div className="progress mt4" style={{ height: 8 }}><div style={{ width: `${captured * 100}%` }} /></div>
        </div>
      )}
      {(p.advice || []).map((a: string, i: number) => <Callout key={i} tone={/ITM|içinde|in the money|atan|assign/i.test(a) ? "warn" : "good"}>{a}</Callout>)}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn sm" onClick={onClose}>{t("Pozisyonu kapat / güncelle", "Close / update position")}</button>
      </div>
    </div>
  );
}

function RateCard({ title, tag, a, b, na, nb, color }: { title: string; tag: string; a: number | null; b: number | null; na: string; nb: string; color: string }) {
  const bar = (v: number | null) => <div className="progress mt8" style={{ height: 7 }}><div style={{ width: `${(v ?? 0) * 100}%`, background: color }} /></div>;
  return (
    <Card>
      <div className="row-between"><span className="ink2" style={{ fontWeight: 550 }}>{title}</span><span className="muted small">{tag}</span></div>
      <div className="grid g2 mt8" style={{ gap: 22 }}>
        <div><div className="display" style={{ fontSize: 32 }}>{pct(a, 1)}</div><div className="muted small">{na}</div>{bar(a)}</div>
        <div><div className="display" style={{ fontSize: 32 }}>{pct(b, 1)}</div><div className="muted small">{nb}</div>{bar(b)}</div>
      </div>
    </Card>
  );
}

export default function Journal({ query }: { query: URLSearchParams }) {
  const t = useT();
  const pro = usePro();
  const statusTr = useStatusTr();
  const stats = useApi<any>("/journal/stats");
  const trades = useApi<any>("/journal");
  const open = useApi<any>("/journal/open");
  const [adding, setAdding] = useState<any>(null);
  const [closing, setClosing] = useState<any>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (query.get("add")) {
      setAdding({
        ticker: query.get("ticker") || "", strategy: query.get("strategy") || "csp", opt_type: query.get("opt_type") || "P",
        side: query.get("side") || "sell", strike: query.get("strike") || "", expiry: query.get("expiry") || "",
        open_price: query.get("price") || "", qty: query.get("qty") || 1,
      });
    }
  }, [query]);

  const reloadAll = () => { stats.reload(); trades.reload(); open.reload(); };
  const del = async (id: number) => {
    if (!window.confirm(t("Bu işlem kaydı silinsin mi?", "Delete this trade record?"))) return;
    await api(`/journal/${id}`, { method: "DELETE" });
    reloadAll();
  };

  const s = stats.data;
  const positions = open.data?.positions || [];
  const allRows = (trades.data?.trades || []).filter((x: any) => filter === "all" || (filter === "open" ? x.status === "open" : x.status !== "open"));
  const tradeCols: Col<any>[] = [
    { key: "date", label: t("Tarih", "Date"), left: true, render: (r) => dateTR(r.open_date), sort: (r) => r.open_date },
    { key: "t", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} />, sort: (r) => r.ticker },
    { key: "c", label: t("Kontrat", "Contract"), left: true, render: (r) => <>{r.side === "sell" ? t("Satış", "Sold") : t("Alış", "Bought")} {r.qty}× {dateTR(r.expiry)} ${strike(r.strike)} {r.opt_type === "P" ? "put" : "call"}</> },
    { key: "p", label: t("Prim", "Premium"), render: (r) => usd0(r.premium_total), sort: (r) => r.premium_total },
    { key: "st", label: t("Durum", "Status"), render: (r) => <Pill tone={STATUS_TONE[r.status]}>{statusTr(r.status)}</Pill>, sort: (r) => r.status },
    { key: "pl", label: t("K/Z", "P/L"), render: (r) => <span className={cls(r.pl)}>{susd(r.pl, 0)}</span>, sort: (r) => r.pl },
    { key: "ann", label: t("Yıllık", "Annual"), render: (r) => pct(r.ann_return, 0), sort: (r) => r.ann_return, hideSm: true },
    {
      key: "a", label: "", render: (r) => (
        <span className="row" style={{ gap: 2, flexWrap: "nowrap" }}>
          <button className="btn xs ghost" onClick={() => setAdding(r)}>{t("Düzenle", "Edit")}</button>
          <button className="btn xs ghost danger" onClick={() => del(r.id)}>{t("Sil", "Delete")}</button>
        </span>
      ),
    },
  ];
  const monthly = s?.monthly || [];
  const noTrades = s && s.n_trades === 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <p className="ink2" style={{ maxWidth: 640 }}>{t("Açtığın her kontratı buraya kaydet. Açık pozisyonların canlı fiyatla izlenir ve ne yapman gerektiği sade bir dille önerilir.",
          "Log every contract you open here. Open positions are tracked at live prices, with plain-language suggestions on what to do next.")}</p>
        <button className="btn primary" onClick={() => setAdding({})}><Icon name="plus" size={16} /> {t("İşlem ekle", "Add trade")}</button>
      </div>

      {noTrades ? (
        <Card>
          <Empty title={t("Henüz işlem yok", "No trades yet")}>
            <p>{t("Bir fikri beğendiğinde \"Kaydet\" düğmesiyle buraya ekleyebilir ya da aracı kurumunda açtığın işlemi elle girebilirsin.",
              "When you like an idea, add it here with the \"Log it\" button, or enter a trade you opened at your broker by hand.")}</p>
            <div className="row mt16" style={{ justifyContent: "center" }}>
              <button className="btn" onClick={() => go("/ideas")}>{t("Fikirlere göz at", "Browse ideas")}</button>
              <button className="btn primary" onClick={() => setAdding({})}>{t("Elle ekle", "Add manually")}</button>
            </div>
          </Empty>
        </Card>
      ) : (
        <>
          {s && (
            <div className="grid g4">
              <Card><Stat lg k={t("Toplanan prim", "Premium collected")} v={usd0(s.premium_collected)} d={t(`${s.n_trades} işlem`, `${s.n_trades} trades`)} /></Card>
              <Card><Stat lg k={t("Gerçekleşen kâr/zarar", "Realized P/L")} v={<span className={cls(s.realized)}>{susd(s.realized, 0)}</span>} d={t(`kazanma oranı ${pct(s.win_rate, 0)}`, `win rate ${pct(s.win_rate, 0)}`)} /></Card>
              <Card><Stat lg k={t("Bağlı teminat", "Capital in use")} v={usd0(s.collateral_in_use)} d={t(`${s.n_open} açık pozisyon`, `${s.n_open} open positions`)} /></Card>
              <Card><Stat lg k={t("Henüz kesinleşmemiş prim", "Premium not yet locked in")} v={usd0(s.open_premium)} /></Card>
            </div>
          )}

          <div>
            <h2 style={{ marginBottom: 14 }}>{t("Açık pozisyonların", "Your open positions")}</h2>
            {open.loading && !open.data ? <Skeleton h={140} n={2} cols={2} /> : open.error ? <ErrorBox error={open.error} /> : positions.length ? (
              <div className="grid g2">{positions.map((p: any) => <PositionCard key={p.id} p={p} onClose={() => setClosing(p)} />)}</div>
            ) : <Card><Empty>{t("Açık pozisyon yok.", "No open positions.")}</Empty></Card>}
          </div>

          {s && (s.sell_positions > 0 || pro) && (
            <div className="grid g2">
              <RateCard title={t("Değersiz biten kontratlar", "Contracts that expired worthless")} tag="CSP + CC" color="var(--green)"
                a={s.expired_rate_contracts} na={t(`${s.expired_contracts} / ${s.sell_contracts} kontrat`, `${s.expired_contracts} / ${s.sell_contracts} contracts`)}
                b={s.expired_rate_positions} nb={t(`${s.expired_positions} / ${s.sell_positions} pozisyon`, `${s.expired_positions} / ${s.sell_positions} positions`)} />
              <RateCard title={t("Atanma oranı", "Assignment rate")} tag={t("sadece CSP", "CSP only")} color="var(--amber)"
                a={s.assign_rate_contracts} na={t(`${s.assigned_contracts} / ${s.csp_contracts} kontrat`, `${s.assigned_contracts} / ${s.csp_contracts} contracts`)}
                b={s.assign_rate_positions} nb={t(`${s.assigned_positions} / ${s.csp_positions} pozisyon`, `${s.assigned_positions} / ${s.csp_positions} positions`)} />
            </div>
          )}

          {monthly.length > 1 && (
            <Card title={t("Aylık gerçekleşen kâr/zarar", "Monthly realized P/L")}>
              <StrikeBars data={monthly.map((mo: any, i: number) => ({ x: i, v: mo.realized }))} height={180}
                signed={{ pos: "var(--div-pos)", neg: "var(--div-neg)", name: t("K/Z", "P/L") }}
                fmt={(v) => `$${compact(v)}`} xFmt={(i) => dateTR(`${monthly[i]?.month}-01`)} tipLabel={(i) => monthly[i]?.month} />
            </Card>
          )}

          <Card flush title={t("İşlem geçmişi", "Trade history")} right={<Seg sm value={filter} onChange={setFilter} options={[{ v: "all", l: t("Tümü", "All") }, { v: "open", l: t("Açık", "Open") }, { v: "closed", l: t("Kapalı", "Closed") }]} />}>
            <Table<any> rows={allRows} cols={tradeCols} rowKey={(r) => String(r.id)} initialSort="date" maxRows={50} />
          </Card>
          {pro && s?.by_ticker?.length > 0 && (
            <Card title={t("Hisse bazında", "By stock")} info="wheel" flush>
              <Table<any> rows={s.by_ticker} rowKey={(r) => r.ticker} compact initialSort="p" cols={[
                { key: "t", label: t("Hisse", "Stock"), left: true, render: (r) => <TickerLink t={r.ticker} />, sort: (r) => r.ticker },
                { key: "n", label: t("İşlem", "Trades"), render: (r) => r.trades, sort: (r) => r.trades },
                { key: "p", label: t("Prim", "Premium"), render: (r) => usd0(r.premium), sort: (r) => r.premium },
                { key: "r", label: t("Gerçekleşen", "Realized"), render: (r) => <span className={cls(r.realized)}>{susd(r.realized, 0)}</span>, sort: (r) => r.realized },
                { key: "a", label: t("Atanma", "Assigned"), render: (r) => r.assigned, sort: (r) => r.assigned },
              ]} />
            </Card>
          )}
          <p className="small muted row" style={{ gap: 6 }}><Info k="assignment" /> {t("25 delta civarında put satan birinin atanma oranı ~%25 olur; bu bir hata değil, stratejinin parçasıdır.", "Someone selling ~25-delta puts gets assigned about 25% of the time — that's part of the strategy, not a mistake.")}</p>
        </>
      )}

      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding?.id ? t("İşlemi düzenle", "Edit trade") : t("İşlem ekle", "Add a trade")}>
        {adding && <TradeForm initial={adding} onCancel={() => setAdding(null)} onDone={() => { setAdding(null); reloadAll(); if (query.get("add")) go("/portfolio?tab=journal"); }} />}
      </Modal>
      <Modal open={!!closing} onClose={() => setClosing(null)} title={t("Pozisyonu güncelle", "Update position")}>
        {closing && <CloseForm tr={closing} onCancel={() => setClosing(null)} onDone={() => { setClosing(null); reloadAll(); }} />}
      </Modal>
    </div>
  );
}
