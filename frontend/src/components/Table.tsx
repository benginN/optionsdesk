import { ReactNode, useMemo, useState } from "react";
import { useT } from "../prefs";
import { Info } from "./ui";

export interface Col<T> {
  key: string;
  label: ReactNode;
  info?: string;
  left?: boolean;
  render?: (r: T) => ReactNode;
  sort?: (r: T) => number | string | null | undefined;
  hideSm?: boolean;
  width?: number | string;
}

export function Table<T>({
  rows, cols, initialSort, initialDir = "desc", onRowClick, rowKey, compact = false, maxRows, empty,
}: {
  rows: T[];
  cols: Col<T>[];
  initialSort?: string;
  initialDir?: "asc" | "desc";
  onRowClick?: (r: T) => void;
  rowKey: (r: T, i: number) => string;
  compact?: boolean;
  maxRows?: number;
  empty?: ReactNode;
}) {
  const tr = useT();
  const [sortKey, setSortKey] = useState<string | undefined>(initialSort);
  const [dir, setDir] = useState<"asc" | "desc">(initialDir);
  const [limit, setLimit] = useState(maxRows);

  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sortKey);
    if (!col || !col.sort) return rows;
    const get = col.sort;
    const out = [...rows];
    out.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const na = va === null || va === undefined || (typeof va === "number" && !Number.isFinite(va));
      const nb = vb === null || vb === undefined || (typeof vb === "number" && !Number.isFinite(vb));
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      const c = typeof va === "string" ? va.localeCompare(vb as string, "tr") : (va as number) - (vb as number);
      return dir === "asc" ? c : -c;
    });
    return out;
  }, [rows, cols, sortKey, dir]);

  const shown = limit ? sorted.slice(0, limit) : sorted;

  const clickHead = (c: Col<T>) => {
    if (!c.sort) return;
    if (c.key === sortKey) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSortKey(c.key);
      setDir(c.left ? "asc" : "desc");
    }
  };

  if (!rows.length) return <div className="empty">{empty ?? tr("Sonuç yok", "No results")}</div>;

  return (
    <>
      <div className="table-wrap">
        <table className={`t ${compact ? "compact" : ""}`}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`${c.left ? "l" : ""} ${c.sort ? "sortable" : ""} ${c.hideSm ? "hide-sm" : ""}`}
                  onClick={() => clickHead(c)}
                  style={c.width ? { width: c.width } : undefined}
                >
                  <span className="row" style={{ gap: 4, display: "inline-flex", flexWrap: "nowrap" }}>
                    {c.label}
                    {c.info && <Info k={c.info} />}
                    {sortKey === c.key && <span className="arrow">{dir === "asc" ? "▲" : "▼"}</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={rowKey(r, i)} className={onRowClick ? "clickable" : ""} onClick={() => onRowClick?.(r)}>
                {cols.map((c) => (
                  <td key={c.key} className={`${c.left ? "l" : ""} ${c.hideSm ? "hide-sm" : ""}`}>
                    {c.render ? c.render(r) : String((r as any)[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit && sorted.length > limit && (
        <div style={{ padding: 12, textAlign: "center" }}>
          <button className="btn sm" onClick={() => setLimit(undefined)}>
            {tr("Tümünü göster", "Show all")} ({sorted.length})
          </button>
        </div>
      )}
    </>
  );
}
