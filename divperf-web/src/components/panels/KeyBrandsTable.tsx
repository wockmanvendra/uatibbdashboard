/**
 * The report's KEY BRANDS PERFORMANCE grid.
 * Columns: Brand | Tgt | Disp | Coll | Ach% on Coll | Gr% | Sec | Inventory | RCPA
 *
 * The Total row is passed in from the tab's server-computed totals — the grid
 * shows the top brands only, and the client never sums rows. (I3)
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
  { index: 3, label: 'Coll', format: 'money' },
  { index: 4, label: 'Ach% on Coll', format: 'ach' },
  { index: 5, label: 'Gr%', format: 'growth' },
  { index: 6, label: 'Sec', format: 'money' },
  { index: 7, label: 'Inventory', format: 'money' },
  { index: 8, label: 'RCPA', format: 'money' },
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
    </Panel>
  );
}
