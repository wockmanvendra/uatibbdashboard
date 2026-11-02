/**
 * The "Stockist details" grid: primary (dispatch), collection and secondary per
 * stockist, like the HQ grid.
 *
 * Columns: Stockist | Code | HQ (SAP code) | HQ Name | Disp | Disp Gr% | Coll | Coll Gr% | Sec |
 *          Sec Gr% | Closing O/S
 *
 * A division has a few thousand stockists, so the grid searches by name, code
 * or HQ and renders the top rows of the current sort, with "Show more". The
 * Total row is the server's. (I3)
 */
import { useMemo, useState } from 'react';
import type { StockistTablePanel } from '../../types/api';
import { Panel } from '../ui/Panel';
import { TableSkeleton } from '../ui/States';
import { DataTable, type ColumnSpec } from './DataTable';
import { downloadCsv } from '../../lib/csv';

const COLUMNS: ColumnSpec[] = [
  { index: 0, label: 'Stockist', format: 'text', sticky: true },
  { index: 1, label: 'Code', format: 'code' },
  { index: 2, label: 'HQ (SAP code)', format: 'text' },
  { index: 3, label: 'HQ Name', format: 'text' },
  { index: 4, label: 'Disp', format: 'money' },
  { index: 5, label: 'Disp Gr%', format: 'growth' },
  { index: 6, label: 'Coll', format: 'money' },
  { index: 7, label: 'Coll Gr%', format: 'growth' },
  { index: 8, label: 'Sec', format: 'money' },
  { index: 9, label: 'Sec Gr%', format: 'growth' },
  { index: 10, label: 'Closing O/S', format: 'money' },
];

const PAGE = 200;

function Chip({ label, value, tone }: { label: string; value: number; tone: 'good' | 'bad' | 'neutral' }) {
  const cls =
    tone === 'good' ? 'bg-[#dff3e7] text-[#1e6b3f]' : tone === 'bad' ? 'bg-[#fbe3e1] text-[#8f2a25]' : 'bg-white text-[var(--xl-label)]';
  return (
    <span className={`rounded-sm px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal tnum ${cls}`}>
      {label} <strong className="font-semibold">{value.toLocaleString('en-IN')}</strong>
    </span>
  );
}

export function StockistTable({
  data,
  loading,
  stale,
}: {
  data?: StockistTablePanel;
  loading: boolean;
  stale: boolean;
}) {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!data || !term) return data?.rows ?? [];
    return data.rows.filter((r) => [r[0], r[1], r[2], r[3]].some((v) => String(v).toLowerCase().includes(term)));
  }, [data, search]);

  return (
    <Panel
      title="Stockist Performance"
      tone="teal"
      stale={stale}
      actions={
        data ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip label="Stockists" value={data.rows.length} tone="neutral" />
            <Chip label="Growing" value={data.growingCount} tone="good" />
            <Chip label="Degrowing" value={data.degrowingCount} tone="bad" />
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  'stockist-performance',
                  COLUMNS.map((c) => c.label),
                  rows.map((r) => COLUMNS.map((c) => r[c.index] ?? '')),
                )
              }
              className="xl-btn-dark"
            >
              Export
            </button>
          </div>
        ) : undefined
      }
    >
      {loading || !data ? (
        <div className="p-3">
          <TableSkeleton rows={10} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--xl-grid)] px-3 py-2">
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Search stockist, code, SAP code or HQ"
              aria-label="Search stockists"
              maxLength={80}
              className="h-8 w-72 rounded border border-[var(--xl-grid)] px-2 text-[13px] focus:border-[var(--xl-navy)] focus:outline-none"
            />
            <span className="text-[11px] text-[var(--xl-muted)] tnum">
              Showing {Math.min(limit, rows.length).toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')}
            </span>
          </div>
          <DataTable
            columns={COLUMNS}
            rows={rows}
            total={search.trim() ? undefined : data.total}
            caption="Stockist performance for the selected period"
            defaultSort={4}
            maxHeight={560}
            hideEmptyColumns
            limit={limit}
          />
          {rows.length > limit && (
            <div className="border-t border-[var(--xl-grid)] px-3 py-2 text-center">
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE * 5)}
                className="text-[12px] font-semibold text-[var(--xl-navy)] hover:underline"
              >
                Show more ({(rows.length - limit).toLocaleString('en-IN')} left)
              </button>
            </div>
          )}
        </>
      )}
      {data && (
        <p className="px-3 py-2 text-[11px] text-[var(--xl-muted)]">
          Target is not kept per stockist in the source, so there is no Tgt or Ach%. HQ lists the SAP codes the
          stockist has sales under this period, and HQ Name their names (each once); its figures are its sales in
          the selection. O/S is the closing outstanding in the period's last month. Export downloads every row{search.trim() ? ' matching the search' : ''}.
        </p>
      )}
    </Panel>
  );
}
