/**
 * The report's "Effort Dashboard": doctor lists by category, coverage and call
 * effort, Call Avg and Field Days by month, and the PCPM box. From the Infinity
 * effort data (territory rows) and the headcount tables.
 *
 * Over several months the server sends doctor counts and field days per month;
 * the percentages and Call Avg come from the period's summed counts.
 *
 * With `onOpen`, the figures open their detail lists in the side panel: the
 * doctor counts the doctor list, the effort ratios the TM-wise effort, and the
 * PCPM box the HQ headcount.
 */
import type { ReactNode } from 'react';
import type { EffortFigures, EffortPanel, PcpmPanel } from '../../types/api';
import { count, lakhs, percent } from '../../lib/format';
import { Panel } from '../ui/Panel';
import { TableSkeleton } from '../ui/States';
import { FigureLink, hasAny, type OpenDetail } from '../ui/FigureLink';

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
  data, loading, stale, note, caveat, onOpen,
}: {
  data?: EffortPanel | null;
  loading: boolean;
  stale: boolean;
  /** Why there are no figures. */
  note?: string;
  /** A caveat on the figures shown. */
  caveat?: string;
  onOpen?: OpenDetail;
}) {
  const t: EffortFigures | undefined = data?.total;
  const rows = t
    ? [
        { label: 'Count of Drs', value: t.drs, share: null as number | null, total: true, category: null as string | null },
        { label: 'A+', value: t.aPlus, share: null, total: false, category: null },
        { label: 'A', value: t.a, share: share(t.a, t.drs), total: false, category: 'A' },
        { label: 'B', value: t.b, share: share(t.b, t.drs), total: false, category: 'B' },
        { label: 'C', value: t.c, share: share(t.c, t.drs), total: false, category: 'C' },
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
                <td className="text-right">
                  <FigureLink
                    label={r.total ? 'List the doctors' : `List the ${r.label} doctors`}
                    onClick={
                      onOpen && hasAny(r.value) && (r.total || r.category)
                        ? () => onOpen('doctors', { status: 'all', ...(r.category ? { category: r.category } : {}) })
                        : undefined
                    }
                  >
                    {count(r.value)}
                  </FigureLink>
                </td>
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
  data, loading, stale, note, caveat, onOpen,
}: {
  data?: EffortPanel | null;
  loading: boolean;
  stale: boolean;
  note?: string;
  caveat?: string;
  onOpen?: OpenDetail;
}) {
  const t = data?.total;
  const tmWise = onOpen && t?.drs ? () => onOpen('tm-effort') : undefined;
  const link = (label: string, shown: string, onClick?: () => void): ReactNode => (
    <FigureLink label={label} onClick={onClick}>
      {shown}
    </FigureLink>
  );
  const rows: { label: string; value: ReactNode }[] = t
    ? [
        {
          label: 'Drs Met',
          value: link(`List the ${count(t.drsMet)} doctors met`, count(t.drsMet),
            onOpen && hasAny(t.drsMet) ? () => onOpen('doctors', { status: 'met' }) : undefined),
        },
        { label: 'Covrg%', value: link('Coverage by territory', percent(t.coveragePct), tmWise) },
        { label: 'Drs Met with Rt Frq', value: count(t.drsMetRtFrq) },
        { label: 'Rt Frq Covrg%', value: link('Right-frequency coverage by territory', percent(t.rtFrqCoveragePct), tmWise) },
        { label: 'Call Avg', value: link('Call average by territory', one(t.callAvg), tmWise) },
        {
          label: 'Drs Missed',
          value: link(`List the ${count(t.drsMissed)} missed doctors`, count(t.drsMissed),
            onOpen && hasAny(t.drsMissed) ? () => onOpen('doctors', { status: 'missed' }) : undefined),
        },
        { label: 'Missed with Rt Frq', value: count(t.missedRtFrq) },
        { label: 'Field Days', value: link('Field days by territory', one(t.fieldDays), tmWise) },
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
  data, loading, stale, note, onOpen,
}: {
  data?: EffortPanel | null;
  loading: boolean;
  stale: boolean;
  note?: string;
  onOpen?: OpenDetail;
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
                <th scope="row" className="text-left">
                  <FigureLink
                    label={`Effort by territory, ${m.label}`}
                    onClick={onOpen ? () => onOpen('tm-effort', { month: String(m.yrMn) }) : undefined}
                  >
                    {m.label}
                  </FigureLink>
                </th>
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
  data, loading, stale, note, onOpen,
}: {
  data?: PcpmPanel;
  loading: boolean;
  stale: boolean;
  note?: string;
  onOpen?: OpenDetail;
}) {
  const byHq = onOpen && hasAny(data?.budgetTm) ? () => onOpen('hq-headcount') : undefined;
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
              <td className="text-right">
                <FigureLink label="Headcount by HQ" onClick={byHq}>
                  {data.budgetTm === null ? '—' : `${count(data.budgetTm)} TM`}
                </FigureLink>
              </td>
            </tr>
            <tr>
              <th scope="row" className="text-left">PCPM (Coll)</th>
              <td className="text-right">
                <FigureLink label="PCPM by HQ" onClick={data.pcpmCollection === null ? undefined : byHq}>
                  {data.pcpmCollection === null ? '—' : `${lakhs(data.pcpmCollection, 1)} lacs`}
                </FigureLink>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <Note>{note ?? 'PCPM (Coll) = Collection ÷ TMs in place ÷ months selected.'}</Note>
    </Panel>
  );
}
