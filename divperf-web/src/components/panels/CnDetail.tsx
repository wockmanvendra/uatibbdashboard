/**
 * Credit Note tab: the stockist-level and SKU-level grids.
 *
 * The Excel note on this sheet says the CN split arrives from distribution as a
 * spreadsheet at stockist and SKU level, and that HQ/Region/Zone still need to
 * be mapped. Until that feed exists these grids are populated by the mock
 * layer — the shape is real, the numbers are not.
 */
import type { CnDetailPanel } from '../../types/api';
import { Card } from '../ui/Card';
import { TableSkeleton } from '../ui/States';
import { DataTable, type ColumnSpec } from './DataTable';
import { downloadCsv } from '../../lib/csv';

const COLUMNS: ColumnSpec[] = [
  { index: 0, label: 'Name', format: 'text', sticky: true },
  { index: 1, label: 'Code', format: 'code' },
  { index: 2, label: 'Exp CN', format: 'money' },
  { index: 3, label: 'SRCN', format: 'money' },
  { index: 4, label: 'PD CN', format: 'money' },
  { index: 5, label: 'Total CN', format: 'money' },
  { index: 6, label: 'CN%', format: 'percent' },
];

export function CnDetailPanels({
  data,
  loading,
  stale,
}: {
  data?: CnDetailPanel;
  loading: boolean;
  stale: boolean;
}) {
  const grid = (title: string, rows: CnDetailPanel['byStockist'], file: string) => (
    <Card
      title={title}
      stale={stale}
      aside={
        rows.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              downloadCsv(file, COLUMNS.map((c) => c.label), rows.map((r) => COLUMNS.map((c) => r[c.index] ?? '')))
            }
            className="btn-ghost"
          >
            Export
          </button>
        ) : undefined
      }
    >
      <DataTable columns={COLUMNS} rows={rows} caption={title} defaultSort={5} />
    </Card>
  );

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Credit note by stockist">
          <TableSkeleton rows={6} />
        </Card>
        <Card title="Credit note by SKU">
          <TableSkeleton rows={6} />
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {grid('Credit note by stockist', data.byStockist, 'cn-by-stockist')}
      {grid('Credit note by SKU', data.bySku, 'cn-by-sku')}
    </div>
  );
}
