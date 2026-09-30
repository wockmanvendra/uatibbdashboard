/**
 * The Excel "Key Brands Performance" grid.
 * Columns: Brand | Tgt | Disp | Coll | Ach% on Coll | Gr% | Sec | Inventory | RCPA
 */
import type { KeyBrandsPanel } from '../../types/api';
import { Card } from '../ui/Card';
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
  loading,
  stale,
}: {
  data?: KeyBrandsPanel;
  loading: boolean;
  stale: boolean;
}) {
  return (
    <Card
      title="Key brands performance"
      stale={stale}
      aside={
        data && data.rows.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                'key-brands',
                COLUMNS.map((c) => c.label),
                data.rows.map((r) => COLUMNS.map((c) => r[c.index] ?? '')),
              )
            }
            className="rounded border border-rule px-2 py-0.5 text-[11px] text-ink-2 hover:bg-paper"
          >
            Export
          </button>
        ) : undefined
      }
    >
      {loading || !data ? (
        <TableSkeleton rows={6} />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={data.rows}
          caption="Key brands performance for the selected period"
          defaultSort={2}
          hideEmptyColumns
        />
      )}
    </Card>
  );
}
