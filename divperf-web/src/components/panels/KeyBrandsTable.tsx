/**
 * The report's KEY BRANDS PERFORMANCE grid.
 * Columns: Brand | Tgt | Disp | Disp Gr% | Coll | Ach% on Coll | Coll Gr% |
 *          Credit note | CN% | Sec | Closing inventory | RCPA | RCPA as % to Sec
 *
 * The Total row is the server's, from its totals — the grid shows the top
 * brands only, and the client never sums rows. (I3) Coll is collection split by
 * product, net of GST; the panel's note says so.
 */
import type { KeyBrandRow, KeyBrandsPanel } from '../../types/api';
import { Panel } from '../ui/Panel';
import { TableSkeleton } from '../ui/States';
import { DataTable, type ColumnSpec } from './DataTable';
import { downloadCsv } from '../../lib/csv';

const COLUMNS: ColumnSpec[] = [
  { index: 0, label: 'Brand', format: 'text', sticky: true },
  { index: 1, label: 'Tgt', format: 'money' },
  { index: 2, label: 'Disp', format: 'money' },
  { index: 3, label: 'Disp Gr%', format: 'growth' },
  { index: 4, label: 'Coll', format: 'money' },
  { index: 5, label: 'Ach% on Coll', format: 'ach' },
  { index: 6, label: 'Coll Gr%', format: 'growth' },
  { index: 7, label: 'Credit note', format: 'money' },
  { index: 8, label: 'CN%', format: 'percent' },
  { index: 9, label: 'Sec', format: 'money' },
  { index: 10, label: 'Closing inventory', format: 'money' },
  { index: 11, label: 'RCPA', format: 'money' },
  { index: 12, label: 'RCPA as % to Sec', format: 'percent' },
];

export function KeyBrandsTable({
  data,
  total,
  loading,
  stale,
}: {
  data?: KeyBrandsPanel;
  total?: KeyBrandRow;
  loading: boolean;
  stale: boolean;
}) {
  return (
    <Panel
      title="Key Brands Performance"
      tone="teal"
      stale={stale}
      actions={
        <>
          <span className="text-[11px] font-normal normal-case tracking-normal text-white/75">
            Values in ₹ Lakhs
          </span>
          {data && data.rows.length > 0 && (
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  'key-brands',
                  COLUMNS.map((c) => c.label),
                  data.rows.map((r) => COLUMNS.map((c) => r[c.index] ?? '')),
                )
              }
              className="xl-btn-dark"
            >
              Export
            </button>
          )}
        </>
      }
    >
      {loading || !data ? (
        <div className="p-3">
          <TableSkeleton rows={6} />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={data.rows}
          total={total}
          caption="Key brands performance for the selected period"
          defaultSort={2}
          maxHeight={420}
          hideEmptyColumns
        />
      )}
      {data?.note && <p className="px-3 py-2 text-[11px] text-[var(--xl-muted)]">{data.note}</p>}
    </Panel>
  );
}
