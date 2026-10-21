/**
 * Credit Note tab: the CN split by HQ and by SKU, from the credit-note view.
 *
 * The Excel sheet split credit notes by stockist; the source has no stockist,
 * only territory and product, so the HQ grid stands in its place. A SKU is
 * named by its brand with the product code beside it — the sales table's
 * product descriptions do not match their codes. CN% is on each HQ's or SKU's
 * own gross sales.
 */
import type { CnDetailPanel, CnDetailRow } from '../../types/api';
import { Panel } from '../ui/Panel';
import { TableSkeleton } from '../ui/States';
import { DataTable, type ColumnSpec } from './DataTable';
import { downloadCsv } from '../../lib/csv';

const columns = (name: string, code: string): ColumnSpec[] => [
  { index: 0, label: name, format: 'text', sticky: true },
  { index: 1, label: code, format: 'code' },
  { index: 2, label: 'Exp CN', format: 'money' },
  { index: 3, label: 'SRCN', format: 'money' },
  { index: 4, label: 'PD CN', format: 'money' },
  { index: 5, label: 'Total CN', format: 'money' },
  { index: 6, label: 'CN%', format: 'percent' },
];

const GRIDS = [
  { key: 'byHq', title: 'Credit note by HQ', file: 'cn-by-hq', columns: columns('HQ', 'Code') },
  { key: 'bySku', title: 'Credit note by SKU', file: 'cn-by-sku', columns: columns('Brand', 'Product code') },
] as const;

export function CnDetailPanels({
  data,
  loading,
  stale,
  note,
}: {
  data?: CnDetailPanel;
  loading: boolean;
  stale: boolean;
  /** A caveat under the grids, e.g. which months CN% covers. */
  note?: string;
}) {
  const grid = (g: (typeof GRIDS)[number], rows: CnDetailRow[]) => (
    <Panel
      key={g.key}
      title={g.title}
      tone="teal"
      stale={stale}
      actions={
        rows.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              downloadCsv(g.file, g.columns.map((c) => c.label), rows.map((r) => g.columns.map((c) => r[c.index] ?? '')))
            }
            className="xl-btn-dark"
          >
            Export
          </button>
        ) : undefined
      }
    >
      {rows.length > 0 ? (
        <>
          <DataTable columns={[...g.columns]} rows={rows} caption={g.title} defaultSort={5} />
          {note && <p className="px-3 py-2 text-[11px] text-[var(--xl-muted)]">{note}</p>}
        </>
      ) : (
        <p className="px-3 py-6 text-center text-[12px] text-[var(--xl-muted)]">
          No credit notes for the selected period.
        </p>
      )}
    </Panel>
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {GRIDS.map((g) =>
        loading || !data ? (
          <Panel key={g.key} title={g.title} tone="teal">
            <div className="p-3">
              <TableSkeleton rows={6} />
            </div>
          </Panel>
        ) : (
          grid(g, data[g.key])
        ),
      )}
    </div>
  );
}
