/**
 * The Excel "Zonal / Regional / HQ Performance" grid.
 *
 * Columns: <grain> | Tgt | Disp | Disp Gr% | Coll | Ach% on Coll | Coll Gr% |
 *          PCPM (Coll) | Credit Note | CN% | Sec | Inventory Value | RCPA |
 *          RCPA as % to Sec
 *
 * The header chips ("Zones on Tgt (xx)", "Growing (xx)", "Degrowing (xx)") come
 * from the server — counting them in the client would violate I3 and would be
 * wrong anyway once the grid is filtered.
 */
import type { GeoTablePanel } from '../../types/api';
import { Card } from '../ui/Card';
import { TableSkeleton } from '../ui/States';
import { DataTable, type ColumnSpec } from './DataTable';
import { downloadCsv } from '../../lib/csv';

const GRAIN_LABEL: Record<GeoTablePanel['grain'], string> = {
  division: 'Division',
  brand: 'Brand',
  zone: 'Zone',
  region: 'Region',
  hq: 'HQ',
};

const GRAIN_PLURAL: Record<GeoTablePanel['grain'], string> = {
  division: 'Divisions',
  brand: 'Brands',
  zone: 'Zones',
  region: 'Regions',
  hq: 'HQs',
};

function columnsFor(grain: GeoTablePanel['grain']): ColumnSpec[] {
  return [
    { index: 0, label: GRAIN_LABEL[grain], format: 'text', sticky: true },
    { index: 1, label: 'Tgt', format: 'money' },
    { index: 2, label: 'Disp', format: 'money' },
    { index: 3, label: 'Disp Gr%', format: 'growth' },
    { index: 4, label: 'Coll', format: 'money' },
    { index: 5, label: 'Ach% on Coll', format: 'ach' },
    { index: 6, label: 'Coll Gr%', format: 'growth' },
    { index: 7, label: 'PCPM (Coll)', format: 'money' },
    { index: 8, label: 'Credit note', format: 'money' },
    { index: 9, label: 'CN%', format: 'percent' },
    { index: 10, label: 'Sec', format: 'money' },
    { index: 11, label: 'Inventory value', format: 'money' },
    { index: 12, label: 'RCPA', format: 'money' },
    { index: 13, label: 'RCPA as % to Sec', format: 'percent' },
  ];
}

function Chip({ label, value, tone }: { label: string; value: number; tone: 'good' | 'bad' | 'neutral' }) {
  const cls =
    tone === 'good'
      ? 'border-good-soft text-good'
      : tone === 'bad'
        ? 'border-bad-soft text-bad'
        : 'border-rule text-ink-2';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] tnum ${cls}`}>
      {label} <strong className="font-semibold">{value}</strong>
    </span>
  );
}

export function GeoTable({
  data,
  loading,
  stale,
}: {
  data?: GeoTablePanel;
  loading: boolean;
  stale: boolean;
}) {
  const grain = data?.grain ?? 'zone';
  const columns = columnsFor(grain);

  return (
    <Card
      title={`${GRAIN_LABEL[grain]} performance`}
      stale={stale}
      aside={
        data ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip label={`${GRAIN_PLURAL[grain]} on tgt`} value={data.onTargetCount} tone="good" />
            <Chip label="Growing" value={data.growingCount} tone="good" />
            <Chip label="Degrowing" value={data.degrowingCount} tone="bad" />
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  `${grain}-performance`,
                  columns.map((c) => c.label),
                  data.rows.map((r) => columns.map((c) => r[c.index] ?? '')),
                )
              }
              className="rounded border border-rule px-2 py-0.5 text-[11px] text-ink-2 hover:bg-paper"
            >
              Export
            </button>
          </div>
        ) : undefined
      }
    >
      {loading || !data ? (
        <TableSkeleton rows={8} />
      ) : (
        <DataTable
          columns={columns}
          rows={data.rows}
          total={data.total}
          caption={`${GRAIN_LABEL[grain]} performance for the selected period`}
          defaultSort={2}
          maxHeight={420}
          hideEmptyColumns
        />
      )}
    </Card>
  );
}
