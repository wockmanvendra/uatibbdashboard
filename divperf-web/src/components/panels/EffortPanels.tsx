/**
 * The report's "Effort Dashboard": doctor lists by category, coverage and call
 * effort, Call Avg and Field Days by month, and the PCPM box. From the Infinity
 * effort data (territory rows) and the headcount tables.
 *
 * Over several months the server sends doctor counts and field days per month;
 * the percentages and Call Avg come from the period's summed counts.
 */
import type { ReactNode } from 'react';
import type { EffortFigures, EffortPanel, PcpmPanel } from '../../types/api';
import { count, lakhs, percent } from '../../lib/format';
import { Panel } from '../ui/Panel';
import { TableSkeleton } from '../ui/States';

const one = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(1));

/** Why a panel is empty, or the caveat it carries. */
function Note({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--xl-muted)]">{children}</p>;
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="p-3">
      <TableSkeleton rows={rows} />
    </div>
  );
}

/** "Count of Drs": the list, and each category's share of it. */
export function DoctorCounts({
  data, loading, stale, note, caveat,
}: {
  data?: EffortPanel | null;
  loading: boolean;
  stale: boolean;
  /** Why there are no figures. */
  note?: string;
  /** A caveat on the figures shown. */
  caveat?: string;
}) {
  const t: EffortFigures | undefined = data?.total;
  const rows = t
    ? [
        { label: 'Count of Drs', value: t.drs, share: null as number | null, total: true },
        { label: 'A+', value: t.aPlus, share: null, total: false },
        { label: 'A', value: t.a, share: share(t.a, t.drs), total: false },
        { label: 'B', value: t.b, share: share(t.b, t.drs), total: false },
        { label: 'C', value: t.c, share: share(t.c, t.drs), total: false },
      ]
    : [];

  return (
    <Panel title="Count of Drs" stale={stale}>
      {loading ? (
        <Skeleton rows={5} />
      ) : !t ? (
        <Note>{note ?? 'No effort data for this selection.'}</Note>
      ) : (
        <table className="xl-table tnum">
          <caption className="sr-only">Doctors on the list, by category</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">Category</th>
              <th scope="col" className="text-right">No.</th>
              <th scope="col" className="text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={r.total ? 'font-semibold' : undefined}>
                <th scope="row" className="text-left">{r.label}</th>
                <td className="text-right">{count(r.value)}</td>
                <td className="text-right">{r.share === null ? '' : percent(r.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {t && <Note>{caveat}</Note>}
    </Panel>
  );
}

const share = (part: number | null, whole: number | null) =>
  part === null || whole === null || whole === 0 ? null : (part / whole) * 100;

/** "Effort": coverage, right-frequency coverage, calls and field days. */
export function EffortTable({
  data, loading, stale, note, caveat, onShowMissed,
}: {
  data?: EffortPanel | null;
  loading: boolean;
  stale: boolean;
  note?: string;
  caveat?: string;
  /** Opens the list of missed doctors; Drs Missed is a link when given. */
  onShowMissed?: () => void;
}) {
  const t = data?.total;
  const missed: ReactNode =
    t && onShowMissed && t.drsMissed !== null && t.drsMissed > 0 ? (
      <button
        type="button"
        onClick={onShowMissed}
        className="font-semibold text-[var(--xl-navy)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
        title="List the missed doctors"
        aria-label={`List the ${count(t.drsMissed)} missed doctors`}
      >
        {count(t.drsMissed)}
      </button>
    ) : (
      count(t?.drsMissed)
    );
  const rows: { label: string; value: ReactNode }[] = t
    ? [
        { label: 'Drs Met', value: count(t.drsMet) },
        { label: 'Covrg%', value: percent(t.coveragePct) },
        { label: 'Drs Met with Rt Frq', value: count(t.drsMetRtFrq) },
        { label: 'Rt Frq Covrg%', value: percent(t.rtFrqCoveragePct) },
        { label: 'Call Avg', value: one(t.callAvg) },
        { label: 'Drs Missed', value: missed },
        { label: 'Missed with Rt Frq', value: count(t.missedRtFrq) },
        { label: 'Field Days', value: one(t.fieldDays) },
      ]
    : [];

  return (
    <Panel title="Effort" stale={stale}>
      {loading ? (
        <Skeleton rows={8} />
      ) : !t ? (
        <Note>{note ?? 'No effort data for this selection.'}</Note>
      ) : (
        <table className="xl-table tnum">
          <caption className="sr-only">Doctor coverage and call effort for the selected period</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">Effort</th>
              <th scope="col" className="text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="text-left">{r.label}</th>
                <td className="text-right">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {t && <Note>{caveat}</Note>}
    </Panel>
  );
}

/** Call Avg and Field Days, month by month, with the period below. */
export function CallAvgFieldDays({
  data, loading, stale, note,
}: {
  data?: EffortPanel | null;
  loading: boolean;
  stale: boolean;
  note?: string;
}) {
  const months = data?.months ?? [];
  return (
    <Panel title="Call Avg & Field Days" stale={stale}>
      {loading ? (
        <Skeleton rows={4} />
      ) : !data || months.length === 0 ? (
        <Note>{note ?? 'No effort data for this selection.'}</Note>
      ) : (
        <table className="xl-table tnum">
          <caption className="sr-only">Call average and field days by month</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">Month</th>
              <th scope="col" className="text-right">Call Avg</th>
              <th scope="col" className="text-right">Field Days</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.yrMn}>
                <th scope="row" className="text-left">{m.label}</th>
                <td className="text-right">{one(m.callAvg)}</td>
                <td className="text-right">{one(m.fieldDays)}</td>
              </tr>
            ))}
            {months.length > 1 && (
              <tr className="font-semibold">
                <th scope="row" className="text-left">Period</th>
                <td className="text-right">{one(data.total.callAvg)}</td>
                <td className="text-right">{one(data.total.fieldDays)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <Note>Field Days are per working territory; Call Avg is doctor calls per field day.</Note>
    </Panel>
  );
}

/** The PCPM box: budgeted TMs, and collection per TM per month. */
export function PcpmBox({
  data, loading, stale, note,
}: {
  data?: PcpmPanel;
  loading: boolean;
  stale: boolean;
  note?: string;
}) {
  return (
    <Panel title="PCPM" stale={stale}>
      {loading || !data ? (
        <Skeleton rows={2} />
      ) : (
        <table className="xl-table tnum">
          <caption className="sr-only">Budgeted TMs and collection per TM per month</caption>
          <tbody>
            <tr>
              <th scope="row" className="text-left">Budget TM</th>
              <td className="text-right">{data.budgetTm === null ? '—' : `${count(data.budgetTm)} TM`}</td>
            </tr>
            <tr>
              <th scope="row" className="text-left">PCPM (Coll)</th>
              <td className="text-right">
                {data.pcpmCollection === null ? '—' : `${lakhs(data.pcpmCollection, 1)} lacs`}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <Note>{note ?? 'PCPM (Coll) = Collection ÷ TMs in place ÷ months selected.'}</Note>
    </Panel>
  );
}
