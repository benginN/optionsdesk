import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../prefs";

/** Kapsayıcının piksel genişliğini ölçer; SVG'yi ölçeklemek yerine gerçek genişlikte çizeriz
    ki metinler her kart genişliğinde 11px kalsın. */
function useWidth(fallback = 640): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      if (cw > 0) setW(Math.round(cw));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* Hafif SVG grafikler. Kurallar: 2px çizgiler, saç teli ızgara, tek y ekseni,
   üzerine gelince crosshair + ipucu, ≥2 seride lejant. Renkler CSS token'ları. */

export interface Pt { x: number; y: number | null }
export interface Series { name: string; color: string; points: Pt[]; dashed?: boolean; width?: number; area?: boolean }

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.name}>
          <i style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

export function LineChart({
  series, height = 220, xFmt = (x) => String(x), yFmt = (y) => String(y), yDomain, xDomain,
  vlines = [], hlines = [], zeroFill = false, legend = true, tipTitle, xTicks: xTicksProp,
}: {
  series: Series[];
  height?: number;
  xFmt?: (x: number) => string;
  yFmt?: (y: number) => string;
  yDomain?: [number, number];
  xDomain?: [number, number];
  vlines?: { x: number; label?: string; color?: string }[];
  hlines?: { y: number; label?: string; color?: string }[];
  zeroFill?: boolean;
  legend?: boolean;
  tipTitle?: (x: number) => ReactNode;
  xTicks?: number[];
}) {
  const [boxRef, W] = useWidth();
  const tr = useT();
  const H = height;
  const m = { t: 12, r: 16, b: 26, l: 52 };
  const ref = useRef<SVGSVGElement>(null);
  const [hx, setHx] = useState<number | null>(null);

  const all = series.flatMap((s) => s.points.filter((p) => p.y !== null && Number.isFinite(p.y as number)));
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y as number);
  const x0 = xDomain ? xDomain[0] : Math.min(...xs);
  const x1 = xDomain ? xDomain[1] : Math.max(...xs);
  let y0 = yDomain ? yDomain[0] : Math.min(...ys, ...hlines.map((h) => h.y));
  let y1 = yDomain ? yDomain[1] : Math.max(...ys, ...hlines.map((h) => h.y));
  if (!yDomain) {
    const pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.1 || 1;
    y0 -= pad;
    y1 += pad;
  }
  const yt = niceTicks(y0, y1, 4);
  if (!yDomain && yt.length) {
    y0 = Math.min(y0, yt[0]);
    y1 = Math.max(y1, yt[yt.length - 1]);
  }
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const xt = xTicksProp || niceTicks(x0, x1, Math.max(3, Math.round(W / 130))).filter((x) => x >= x0 && x <= x1);

  const path = (pts: Pt[]) => {
    let d = "";
    let pen = false;
    for (const p of pts) {
      if (p.y === null || !Number.isFinite(p.y)) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const xsSorted = useMemo(() => Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.x)))).sort((a, b) => a - b), [series]);

  const onMove = (e: React.MouseEvent) => {
    const svg = ref.current;
    if (!svg || !xsSorted.length) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    let best = xsSorted[0];
    for (const x of xsSorted) if (Math.abs(x - xv) < Math.abs(best - xv)) best = x;
    setHx(best);
  };

  const zeroY = y0 < 0 && y1 > 0 ? sy(0) : null;
  const first = series[0];
  const clipId = useMemo(() => `c${Math.random().toString(36).slice(2, 8)}`, []);

  if (!all.length) return <div className="empty" ref={boxRef}>{tr("Veri yok", "No data")}</div>;

  const tipLeftPct = hx !== null ? (sx(hx) / W) * 100 : 0;

  return (
    <div className="chart" style={{ position: "relative" }} ref={boxRef}>
      {legend && series.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <Legend items={series.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed }))} />
        </div>
      )}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHx(null)} role="img">
        {yt.map((y) => (
          <g key={y}>
            <line x1={m.l} x2={W - m.r} y1={sy(y)} y2={sy(y)} style={{ stroke: "var(--grid)" }} strokeWidth={1} />
            <text x={m.l - 8} y={sy(y) + 4} textAnchor="end">{yFmt(y)}</text>
          </g>
        ))}
        {xt.map((x) => (
          <text key={x} x={sx(x)} y={H - 6} textAnchor="middle">{xFmt(x)}</text>
        ))}
        {zeroY !== null && <line x1={m.l} x2={W - m.r} y1={zeroY} y2={zeroY} style={{ stroke: "var(--line-strong)" }} strokeWidth={1} />}
        {zeroFill && first && zeroY !== null && (
          <>
            <defs>
              <clipPath id={`${clipId}a`}><rect x={m.l} y={m.t} width={W - m.l - m.r} height={Math.max(0, zeroY - m.t)} /></clipPath>
              <clipPath id={`${clipId}b`}><rect x={m.l} y={zeroY} width={W - m.l - m.r} height={Math.max(0, H - m.b - zeroY)} /></clipPath>
            </defs>
            {(() => {
              const pts = first.points.filter((p) => p.y !== null);
              if (pts.length < 2) return null;
              const d = `${path(pts)}L${sx(pts[pts.length - 1].x)},${zeroY}L${sx(pts[0].x)},${zeroY}Z`;
              return (
                <>
                  <path d={d} clipPath={`url(#${clipId}a)`} style={{ fill: "var(--green)", opacity: 0.12 }} />
                  <path d={d} clipPath={`url(#${clipId}b)`} style={{ fill: "var(--red)", opacity: 0.12 }} />
                </>
              );
            })()}
          </>
        )}
        {series.filter((s) => s.area).map((s) => {
          const pts = s.points.filter((p) => p.y !== null);
          if (pts.length < 2) return null;
          const base = sy(y0);
          return <path key={`a${s.name}`} d={`${path(pts)}L${sx(pts[pts.length - 1].x)},${base}L${sx(pts[0].x)},${base}Z`} style={{ fill: s.color, opacity: 0.1 }} />;
        })}
        {hlines.map((h, i) => (
          <g key={`h${i}`}>
            <line x1={m.l} x2={W - m.r} y1={sy(h.y)} y2={sy(h.y)} style={{ stroke: h.color || "var(--muted)" }} strokeWidth={1} strokeDasharray="4 4" />
            {h.label && <text x={W - m.r} y={sy(h.y) - 5} textAnchor="end">{h.label}</text>}
          </g>
        ))}
        {vlines.filter((v) => v.x >= x0 && v.x <= x1).map((v, i) => (
          <g key={`v${i}`}>
            <line x1={sx(v.x)} x2={sx(v.x)} y1={m.t} y2={H - m.b} style={{ stroke: v.color || "var(--muted)" }} strokeWidth={1} strokeDasharray="3 4" />
            {v.label && <text x={sx(v.x) + 4} y={m.t + 10}>{v.label}</text>}
          </g>
        ))}
        {series.map((s) => (
          <path key={s.name} d={path(s.points)} fill="none" style={{ stroke: s.color }} strokeWidth={s.width || 2}
            strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 5" : undefined} />
        ))}
        {hx !== null && (
          <g>
            <line x1={sx(hx)} x2={sx(hx)} y1={m.t} y2={H - m.b} style={{ stroke: "var(--ink-2)" }} strokeWidth={1} opacity={0.4} />
            {series.map((s) => {
              const p = s.points.find((q) => q.x === hx);
              if (!p || p.y === null) return null;
              return <circle key={s.name} cx={sx(hx)} cy={sy(p.y)} r={4} style={{ fill: s.color, stroke: "var(--surface)" }} strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>
      {hx !== null && (
        <div className="chart-tip" style={{ left: `${tipLeftPct}%`, top: 8, transform: tipLeftPct > 60 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}>
          <div className="tt">{tipTitle ? tipTitle(hx) : xFmt(hx)}</div>
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hx);
            if (!p || p.y === null) return null;
            return (
              <div className="tr" key={s.name}>
                <span className="row" style={{ gap: 6 }}><i style={{ background: s.color }} />{s.name}</span>
                <strong>{yFmt(p.y)}</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Strike bazlı çubuklar: yukarı (ör. call OI) ve aşağı (ör. put OI) ya da işaretli tek seri (GEX). */
export function StrikeBars({
  data, height = 220, up, down, signed, spot, markers = [], fmt = (v) => String(v), xFmt = (x) => String(x),
  tipLabel = (x) => `Strike ${x}`,
}: {
  tipLabel?: (x: number) => string;
  data: { x: number; up?: number; down?: number; v?: number }[];
  height?: number;
  up?: { name: string; color: string };
  down?: { name: string; color: string };
  signed?: { pos: string; neg: string; name: string };
  spot?: number;
  markers?: { x: number; label: string }[];
  fmt?: (v: number) => string;
  xFmt?: (x: number) => string;
}) {
  const [boxRef, W] = useWidth();
  const tr = useT();
  const H = height;
  const m = { t: 14, r: 12, b: 26, l: 52 };
  const [hi, setHi] = useState<number | null>(null);
  if (!data.length) return <div className="empty" ref={boxRef}>{tr("Veri yok", "No data")}</div>;
  const n = data.length;
  const band = (W - m.l - m.r) / n;
  const bw = Math.max(1, Math.min(24, band - 2));
  let maxUp = 0;
  let maxDn = 0;
  for (const d of data) {
    if (signed) {
      maxUp = Math.max(maxUp, d.v && d.v > 0 ? d.v : 0);
      maxDn = Math.max(maxDn, d.v && d.v < 0 ? -d.v : 0);
    } else {
      maxUp = Math.max(maxUp, d.up || 0);
      maxDn = Math.max(maxDn, d.down || 0);
    }
  }
  const tot = maxUp + maxDn || 1;
  const plotH = H - m.t - m.b;
  const zero = m.t + (maxUp / tot) * plotH;
  const scale = plotH / tot;
  const cx = (i: number) => m.l + band * i + band / 2;
  const xAt = (x: number) => {
    // spot gibi ara değerler için doğrusal konum
    for (let i = 0; i < n - 1; i++) {
      if (x >= data[i].x && x <= data[i + 1].x) return cx(i) + ((x - data[i].x) / (data[i + 1].x - data[i].x || 1)) * band;
    }
    return x < data[0].x ? cx(0) : cx(n - 1);
  };
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(4, Math.round(W / 70))));
  const r = Math.min(4, bw / 2);
  const bar = (x: number, h: number, dir: 1 | -1) => {
    if (h <= 0.5) return "";
    const left = x - bw / 2;
    const right = x + bw / 2;
    if (dir === 1) {
      const top = zero - h;
      return `M${left},${zero}V${top + r}Q${left},${top} ${left + r},${top}H${right - r}Q${right},${top} ${right},${top + r}V${zero}Z`;
    }
    const bot = zero + h;
    return `M${left},${zero}V${bot - r}Q${left},${bot} ${left + r},${bot}H${right - r}Q${right},${bot} ${right},${bot - r}V${zero}Z`;
  };
  const hd = hi !== null ? data[hi] : null;

  return (
    <div className="chart" style={{ position: "relative" }} ref={boxRef}>
      <div style={{ marginBottom: 8 }}>
        <Legend items={signed ? [{ name: `${signed.name} +`, color: signed.pos }, { name: `${signed.name} −`, color: signed.neg }] : [up!, down!].filter(Boolean)} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} onMouseLeave={() => setHi(null)}>
        <line x1={m.l} x2={W - m.r} y1={zero} y2={zero} style={{ stroke: "var(--line-strong)" }} />
        <text x={m.l - 8} y={m.t + 8} textAnchor="end">{fmt(maxUp)}</text>
        {maxDn > 0 && <text x={m.l - 8} y={H - m.b} textAnchor="end">{signed ? `−${fmt(maxDn)}` : fmt(maxDn)}</text>}
        {data.map((d, i) => {
          const x = cx(i);
          const upH = signed ? (d.v && d.v > 0 ? d.v * scale : 0) : (d.up || 0) * scale;
          const dnH = signed ? (d.v && d.v < 0 ? -d.v * scale : 0) : (d.down || 0) * scale;
          return (
            <g key={d.x} onMouseEnter={() => setHi(i)}>
              <rect x={x - band / 2} y={m.t} width={band} height={plotH} fill="transparent" />
              <path d={bar(x, upH, 1)} style={{ fill: signed ? signed.pos : up!.color, opacity: hi === null || hi === i ? 1 : 0.45 }} />
              <path d={bar(x, dnH, -1)} style={{ fill: signed ? signed.neg : down!.color, opacity: hi === null || hi === i ? 1 : 0.45 }} />
              {i % labelEvery === 0 && <text x={x} y={H - 6} textAnchor="middle">{xFmt(d.x)}</text>}
            </g>
          );
        })}
        {spot !== undefined && (
          <g>
            <line x1={xAt(spot)} x2={xAt(spot)} y1={m.t - 6} y2={H - m.b} style={{ stroke: "var(--ink)" }} strokeWidth={1} strokeDasharray="3 3" />
            <text x={xAt(spot) + 4} y={m.t} style={{ fill: "var(--ink)" }}>{tr("Fiyat", "Price")} {xFmt(spot)}</text>
          </g>
        )}
        {markers.map((mk) => (
          <g key={mk.label}>
            <line x1={xAt(mk.x)} x2={xAt(mk.x)} y1={m.t + 10} y2={H - m.b} style={{ stroke: "var(--muted)" }} strokeWidth={1} strokeDasharray="2 4" />
            <text x={xAt(mk.x) + 4} y={H - m.b - 6}>{mk.label}</text>
          </g>
        ))}
      </svg>
      {hd && (
        <div className="chart-tip" style={{ left: `${(cx(hi!) / W) * 100}%`, top: 24, transform: cx(hi!) / W > 0.6 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}>
          <div className="tt">{tipLabel(hd.x)}</div>
          {signed ? (
            <div className="tr"><span>{signed.name}</span><strong>{fmt(hd.v || 0)}</strong></div>
          ) : (
            <>
              <div className="tr"><span className="row" style={{ gap: 6 }}><i style={{ background: up!.color }} />{up!.name}</span><strong>{fmt(hd.up || 0)}</strong></div>
              <div className="tr"><span className="row" style={{ gap: 6 }}><i style={{ background: down!.color }} />{down!.name}</span><strong>{fmt(hd.down || 0)}</strong></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 110, height = 30, color = "var(--muted)" }: { values: (number | null)[]; width?: number; height?: number; color?: string }) {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length < 2) return <span className="muted small">—</span>;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * (width - 6) + 3},${height - 3 - ((y - min) / (max - min || 1)) * (height - 6)}`);
  const last = pts[pts.length - 1].split(",").map(Number);
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts.join(" ")} fill="none" style={{ stroke: color }} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} style={{ fill: "var(--ink)", stroke: "var(--surface)" }} strokeWidth={1.5} />
    </svg>
  );
}

/** 0–100 aralığında yatay konum göstergesi (IV Pos, RSI) */
export function RangeMeter({ value, lo = 0, hi = 100, marks = [] }: { value: number | null | undefined; lo?: number; hi?: number; marks?: number[] }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="muted">—</span>;
  const p = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return (
    <div style={{ position: "relative", height: 8, background: "var(--line)", borderRadius: 99, minWidth: 80 }}>
      {marks.map((mk) => (
        <div key={mk} style={{ position: "absolute", left: `${((mk - lo) / (hi - lo)) * 100}%`, top: -2, width: 1, height: 12, background: "var(--line-strong)" }} />
      ))}
      <div style={{ position: "absolute", left: `calc(${p * 100}% - 6px)`, top: -2, width: 12, height: 12, borderRadius: "50%", background: "var(--ink)", border: "2px solid var(--surface)" }} />
    </div>
  );
}
