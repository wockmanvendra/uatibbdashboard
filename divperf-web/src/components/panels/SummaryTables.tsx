/**
 * The report's small summary tables: PRIMARY PERFORMANCE, SECONDARY • PCPM •
 * RCPA, and MANPOWER ATTRITION.
 */
import type {
  InventoryPanel, PcpmPanel, PrimaryPanel, RcpaPanel, SecondaryPanel,
} from '../../types/api';
import { EM_DASH, count, lakhs, lakhsAuto, moneyFull, percent } from '../../lib/format';
import { Panel } from '../ui/Panel';
import { TableSkeleton } from '../ui/States';

const full = (n: number | null | undefined) => (n === null || n === undefined ? undefined : moneyFull(n));
const pctCell = (n: number | null | undefined) => (
  <span className={n !== null && n !== undefined && n < 0 ? 'text-bad' : undefined}>{percent(n)}</span>
);

export function PrimaryPerformance({
  primary, loading, stale,
}: {
  primary?: PrimaryPanel;
  loading: boolean;
  stale: boolean;
}) {
  const rows = primary
    ? [
        { label: 'Tgt', m: primary.target, ach: false },
        { label: 'Coll', m: primary.collection, ach: true },
        { label: 'Disp', m: primary.dispatch, ach: true },
      ]
    : [];

  return (
    <Panel title="Primary Performance" stale={stale}>
      {loading || !primary ? (
        <div className="p-3">
          <TableSkeleton rows={3} />
        </div>
      ) : (
        <table className="xl-table tnum">
          <caption className="sr-only">Primary performance for the selected period</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">Primary</th>
              <th scope="col" className="text-right">Value (₹ L)</th>
              <th scope="col" className="text-right">Ach%</th>
              <th scope="col" className="text-right">Gr%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="text-left">{r.label}</th>
                <td className="text-right" title={full(r.m.value)}>{lakhsAuto(r.m.value)}</td>
                <td className="text-right">{r.ach ? percent(r.m.ach) : ''}</td>
                <td className="text-right">{pctCell(r.m.gr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export function SecondaryPcpmRcpa({
  secondary, pcpm, rcpa, inventory, loading, stale,
}: {
  secondary?: SecondaryPanel;
  pcpm?: PcpmPanel;
  rcpa?: RcpaPanel;
  inventory?: InventoryPanel;
  loading: boolean;
  stale: boolean;
}) {
  const ready = !loading && !!secondary && !!pcpm && !!rcpa;
  const rows = ready
    ? [
        { label: 'Sec (₹ L)', value: lakhsAuto(secondary.value), title: full(secondary.value), pct: secondary.grPct },
        { label: 'Invntry (₹ L)', value: lakhsAuto(inventory?.value), title: full(inventory?.value), pct: null },
        { label: 'Budget TM (Nos.)', value: count(pcpm.budgetTm), pct: null },
        { label: 'PCPM Coll (₹ L)', value: lakhs(pcpm.pcpmCollection, 1), pct: null },
        // Against plan when a plan exists; otherwise against last year.
        { label: 'RCPA Value (₹ L)', value: lakhsAuto(rcpa.actual), title: full(rcpa.actual), pct: rcpa.achPct ?? rcpa.grPct },
      ]
    : [];

  return (
    <Panel title="Secondary • PCPM • RCPA" stale={stale}>
      {!ready ? (
        <div className="p-3">
          <TableSkeleton rows={5} />
        </div>
      ) : (
        <table className="xl-table tnum">
          <caption className="sr-only">Secondary, PCPM and RCPA for the selected period</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">Metric</th>
              <th scope="col" className="text-right">Value</th>
              <th scope="col" className="text-right">Ach% / Gr%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="text-left">{r.label}</th>
                <td className="text-right" title={r.title}>{r.value}</td>
                <td className="text-right">{r.pct === null ? '' : pctCell(r.pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** No attrition feed exists yet: the panel keeps its place and says so. */
export function ManpowerAttrition({ stale }: { stale: boolean }) {
  return (
    <Panel title="Manpower Attrition" tone="teal" stale={stale}>
      <table className="xl-table tnum">
        <caption className="sr-only">Manpower attrition</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">Cadre</th>
            <th scope="col" className="text-right">Count</th>
            <th scope="col" className="text-right">Attrition %</th>
          </tr>
        </thead>
        <tbody>
          {['TMs', 'RMs', 'ZSMs'].map((c) => (
            <tr key={c}>
              <th scope="row" className="text-left">{c}</th>
              <td className="text-right text-[var(--xl-muted)]">{EM_DASH}</td>
              <td className="text-right text-[var(--xl-muted)]">{EM_DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-[var(--xl-muted)]">
        No attrition source yet — headcount and leavers will show here once a field-force feed is
        connected.
      </p>
    </Panel>
  );
}
