/**
 * The columnar table used by Key Brands, the geo grids, and the CN detail
 * grids. Driven by a column spec so one component serves all of them.
 *
 * The API sends rows as arrays of primitives (parallel to `columns`), so this
 * renders by index and never builds intermediate objects per row.
 */
import { useMemo, useState } from 'react';
import { EM_DASH, growth, growthClass, money, moneyFull, percent } from '../../lib/format';
import { GapRibbon } from './GapRibbon';

export type CellFormat = 'text' | 'code' | 'money' | 'percent' | 'growth' | 'ach' | 'number';

export interface ColumnSpec {
  /** Index into the row array. */
  index: number;
  label: string;
  format: CellFormat;
  align?: 'left' | 'right';
  /** Sticky first column for wide grids. */
  sticky?: boolean;
}

type Row = readonly (string | number | null)[];

interface DataTableProps {
  columns: ColumnSpec[];
  rows: Row[];
  /** Rendered as a pinned footer row and never computed in the client. (I3) */
  total?: Row;
  caption: string;
  /** Initial sort column index; defaults to unsorted (server order). */
  defaultSort?: number;
  maxHeight?: number;
  /**
   * Drop columns that are null in every row. A grid with five empty columns
   * reads as broken; the reason is reported once in the footer instead. The
   * first column is always kept — it is the row's identity.
   */
  hideEmptyColumns?: boolean;
}

function renderCell(v: string | number | null, format: CellFormat) {
  if (v === null || v === undefined) return <span className="text-ink-3">{EM_DASH}</span>;
  switch (format) {
    case 'money':
      return <span title={moneyFull(v as number)}>{money(v as number)}</span>;
    case 'percent':
      return percent(v as number);
    case 'growth':
      return <span className={growthClass(v as number)}>{growth(v as number)}</span>;
    case 'ach':
      return (
        <div className="flex flex-col items-end gap-1">
          <span>{percent(v as number)}</span>
          <div className="w-16">
            <GapRibbon ach={v as number} label="Achievement" />
          </div>
        </div>
      );
    case 'number':
      return (v as number).toLocaleString('en-IN');
    case 'code':
      return <span className="font-mono text-[12px] text-ink-2">{v}</span>;
    default:
      return String(v);
  }
}

export function DataTable({
  columns: allColumns, rows, total, caption, defaultSort,
  maxHeight = 340, hideEmptyColumns = false,
}: DataTableProps) {
  const [sort, setSort] = useState<{ index: number; dir: 'asc' | 'desc' } | null>(
    defaultSort === undefined ? null : { index: defaultSort, dir: 'desc' },
  );

  const columns = useMemo(() => {
    if (!hideEmptyColumns || rows.length === 0) return allColumns;
    return allColumns.filter(
      (c) => c.index === 0 || rows.some((r) => r[c.index] !== null && r[c.index] !== undefined),
    );
  }, [allColumns, rows, hideEmptyColumns]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { index, dir } = sort;
    return [...rows].sort((a, b) => {
      const av = a[index];
      const bv = b[index];
      // Nulls always sink, whichever direction is active — a missing value is
      // not "the smallest value".
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort]);

  const toggle = (index: number) =>
    setSort((s) =>
      s?.index === index ? { index, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { index, dir: 'desc' },
    );

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse text-table tnum">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-rule">
            {columns.map((c) => {
              const active = sort?.index === c.index;
              return (
                <th
                  key={c.index}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`whitespace-nowrap bg-surface py-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
                    (c.align ?? (c.format === 'text' || c.format === 'code' ? 'left' : 'right')) === 'left'
                      ? 'pr-3 text-left'
                      : 'pl-3 text-right'
                  } ${c.sticky ? 'sticky left-0 z-20' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.index)}
                    className="inline-flex items-center gap-1 uppercase tracking-[0.06em] hover:text-ink-2"
                  >
                    {c.label}
                    <span aria-hidden="true" className={active ? 'text-ink-2' : 'text-transparent'}>
                      {active && sort.dir === 'asc' ? '▲' : '▼'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {sorted.map((row, i) => (
            <tr key={String(row[0]) + i} className="border-b border-rule-soft hover:bg-paper">
              {columns.map((c) => {
                const left =
                  (c.align ?? (c.format === 'text' || c.format === 'code' ? 'left' : 'right')) === 'left';
                const Tag = c.index === 0 ? 'th' : 'td';
                return (
                  <Tag
                    key={c.index}
                    {...(c.index === 0 ? { scope: 'row' as const } : {})}
                    className={`${left ? 'pr-3 text-left font-normal' : 'pl-3 text-right'} ${
                      c.index === 0 ? 'text-ink' : 'text-ink-2'
                    } ${c.sticky ? 'sticky left-0 bg-surface' : ''}`}
                    style={{ height: 'var(--row-h)' }}
                  >
                    {renderCell(row[c.index] ?? null, c.format)}
                  </Tag>
                );
              })}
            </tr>
          ))}

          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-[12px] text-ink-3">
                No rows for the selected period.
              </td>
            </tr>
          )}
        </tbody>

        {total && (
          <tfoot className="sticky bottom-0 bg-surface">
            <tr className="border-t-2 border-rule font-medium">
              {columns.map((c) => {
                const left =
                  (c.align ?? (c.format === 'text' || c.format === 'code' ? 'left' : 'right')) === 'left';
                return (
                  <td
                    key={c.index}
                    className={`bg-surface text-ink ${left ? 'pr-3 text-left' : 'pl-3 text-right'} ${
                      c.sticky ? 'sticky left-0' : ''
                    }`}
                    style={{ height: 'var(--row-h)' }}
                  >
                    {/* The ribbon is a per-row comparison device; on the total it
                        would invite reading an average of percentages. */}
                    {renderCell(total[c.index] ?? null, c.format === 'ach' ? 'percent' : c.format)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
