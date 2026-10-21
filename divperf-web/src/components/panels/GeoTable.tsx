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
import { Panel } from '../ui/Panel';
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
    { index: 11, label: 'Closing inventory', format: 'money' },
    { index: 12, label: 'RCPA', format: 'money' },
    { index: 13, label: 'RCPA as % to Sec', format: 'percent' },
  ];
}

function Chip({ label, value, tone }: { label: string; value: number; tone: 'good' | 'bad' | 'neutral' }) {
  // Light chips on the dark header bar.
  const cls =
    tone === 'good' ? 'bg-[#dff3e7] text-[#1e6b3f]' : tone === 'bad' ? 'bg-[#fbe3e1] text-[#8f2a25]' : 'bg-white text-[var(--xl-label)]';
  return (
    <span className={`rounded-sm px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal tnum ${cls}`}>
      {label} <strong className="font-semibold">{value}</strong>
    </span>
  );
}

export function GeoTable({
  data,
  loading,
  stale,
  note,
}: {
  data?: GeoTablePanel;
  loading: boolean;
  stale: boolean;
  /** A caveat under the grid, e.g. which months CN% covers. */
  note?: string;
}) {
  const grain = data?.grain ?? 'zone';
  const columns = columnsFor(grain);

  return (
    <Panel
      title={`${GRAIN_LABEL[grain]} Performance`}
      tone="teal"
      stale={stale}
      actions={
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
          <TableSkeleton rows={8} />
        </div>
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
      {note && data && <p className="px-3 py-2 text-[11px] text-[var(--xl-muted)]">{note}</p>}
    </Panel>
  );
}
