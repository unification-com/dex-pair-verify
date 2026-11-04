// components/ui/DataTable.tsx
// Restyled, generic replacement for SortableTable/TableHead/TableBody/TableCell.
// Column-config driven (not cellType strings). Supports client-side sort,
// row selection (for bulk actions), row click, and a custom cell renderer per
// column — so a "Decision driver" or "Confidence" column is just a render fn.
//
// Migration: the old `columns` used {label, accessor, cellType}. Here a column
// is {key, label, render?}. Move the cellType formatting into `render`. The
// table chrome (sticky header, hairlines, hover, selected row) is all in
// globals.css under `table.data`.
import React, { useMemo, useState, ReactNode } from "react";

export type Column<T> = {
  key: string;
  label: ReactNode;
  num?: boolean;                 // right-align + tabular mono
  width?: string;
  sortable?: boolean;
  sortVal?: (row: T) => number | string | null; // defaults to row[key]
  render?: (row: T) => ReactNode;                // defaults to row[key]
};

type Props<T> = {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (key: string) => void;
  onToggleAll?: (allSelected: boolean) => void;
  onRowClick?: (row: T) => void;
  sortInit?: { key: string; dir: "asc" | "desc" };
  // Server-sort mode: when `onSortChange` is given, the table does NOT sort `data`
  // itself (it's already ordered by the server, across the WHOLE dataset, not just
  // this page) — header clicks call back so the page can re-query. `serverSort`
  // drives the active-column indicator.
  serverSort?: { key: string; dir: "asc" | "desc" } | null;
  onSortChange?: (key: string, dir: "asc" | "desc") => void;
  empty?: ReactNode;
};

function DataTable<T>({ columns, data, rowKey, selectable, selected, onToggle, onToggleAll, onRowClick, sortInit, serverSort, onSortChange, empty }: Props<T>) {
  const [sort, setSort] = useState(sortInit || null);
  const serverMode = !!onSortChange;
  const activeSort = serverMode ? serverSort ?? null : sort;

  const sorted = useMemo(() => {
    if (serverMode || !sort) return data; // server mode: data already ordered upstream
    const col = columns.find((c) => c.key === sort.key);
    const acc = col?.sortVal || ((r: T) => (r as Record<string, number | string | null>)[sort.key]);
    const arr = [...data].sort((a, b) => {
      const x = acc(a), y = acc(b);
      if (x == null) return 1; if (y == null) return -1;
      if (typeof x === "number" && typeof y === "number") return x - y;
      return String(x).localeCompare(String(y));
    });
    return sort.dir === "desc" ? arr.reverse() : arr;
  }, [data, sort, columns, serverMode]);

  const clickSort = (c: Column<T>) => {
    if (!c.sortable) return;
    const cur = activeSort;
    const nextDir: "asc" | "desc" = cur && cur.key === c.key ? (cur.dir === "asc" ? "desc" : "asc") : (c.num ? "desc" : "asc");
    if (serverMode) { onSortChange?.(c.key, nextDir); return; }
    setSort({ key: c.key, dir: nextDir });
  };
  const allSel = !!selectable && data.length > 0 && selected != null && data.every((r) => selected.has(rowKey(r)));

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {selectable ? <th className="tight"><input type="checkbox" className="ckbox" checked={allSel} onChange={() => onToggleAll?.(allSel)} /></th> : null}
            {columns.map((c) => (
              <th key={c.key} className={(c.num ? "num " : "") + (c.sortable ? "sortable" : "")} style={c.width ? { width: c.width } : undefined} onClick={() => clickSort(c)}>
                {c.label}
                {c.sortable && activeSort?.key === c.key ? <span className="sort-ind">{activeSort.dir === "asc" ? "↑" : "↓"}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={columns.length + (selectable ? 1 : 0)} style={{ textAlign: "center", padding: "var(--sp-9)", color: "var(--text-2)" }}>{empty || "No rows."}</td></tr>
          ) : sorted.map((r) => {
            const k = rowKey(r);
            const sel = !!selectable && !!selected?.has(k);
            return (
              <tr key={k} className={(onRowClick ? "clickable " : "") + (sel ? "row-selected" : "")} onClick={onRowClick ? (e) => { if ((e.target as HTMLInputElement).type !== "checkbox") onRowClick(r); } : undefined}>
                {selectable ? <td className="tight"><input type="checkbox" className="ckbox" checked={sel} onChange={() => onToggle?.(k)} /></td> : null}
                {columns.map((c) => <td key={c.key} className={c.num ? "num" : undefined}>{c.render ? c.render(r) : (r as Record<string, ReactNode>)[c.key]}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
