/**
 * The report's small summary tables: PRIMARY PERFORMANCE, SECONDARY • PCPM •
 * RCPA, and MANPOWER ATTRITION.
 */
import type {
  InventoryPanel, ManpowerPanel, PcpmPanel, PrimaryPanel, RcpaPanel, RxPanel, SecondaryPanel,
} from '../../types/api';
import { label as monthLabel } from '../../lib/yrmn';
import { count, lakhs, lakhsAuto, moneyFull, percent } from '../../lib/format';
import { Panel } from '../ui/Panel';
import { TableSkeleton } from '../ui/States';
import { FigureLink, hasAny, type OpenDetail } from '../ui/FigureLink';

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
  // The division budget beside the field one, for a division-level view only.
  const div = primary?.divisionTarget ?? null;
  const rows = primary
    ? [
        { label: div ? 'Field Tgt' : 'Tgt', m: primary.target, ach: false, divAch: null },
        ...(div ? [{ label: 'Div Tgt', m: { value: div.value, ach: null, gr: div.gr }, ach: false, divAch: null }] : []),
        { label: 'Coll', m: primary.collection, ach: true, divAch: div?.collAch ?? null },
        { label: 'Disp', m: primary.dispatch, ach: true, divAch: div?.dispAch ?? null },
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
              <th scope="col" className="text-right">{div ? 'Ach% (Field)' : 'Ach%'}</th>
              {div && <th scope="col" className="text-right">Ach% (Div)</th>}
              <th scope="col" className="text-right">Gr%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="text-left">{r.label}</th>
                <td className="text-right" title={full(r.m.value)}>{lakhsAuto(r.m.value)}</td>
                <td className="text-right">{r.ach ? percent(r.m.ach) : ''}</td>
                {div && <td className="text-right">{r.ach ? percent(r.divAch) : ''}</td>}
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
  secondary, pcpm, rcpa, inventory, loading, stale, onOpen,
}: {
  secondary?: SecondaryPanel;
  pcpm?: PcpmPanel;
  rcpa?: RcpaPanel;
  inventory?: InventoryPanel;
  loading: boolean;
  stale: boolean;
  /** Budget TM and PCPM open the HQ headcount when given. */
  onOpen?: OpenDetail;
}) {
  const byHq = onOpen && hasAny(pcpm?.budgetTm) ? () => onOpen('hq-headcount') : undefined;
  const ready = !loading && !!secondary && !!pcpm && !!rcpa;
  const rows = ready
    ? [
        { label: 'Sec (₹ L)', value: lakhsAuto(secondary.value), title: full(secondary.value), pct: secondary.grPct },
        { label: 'Closing Invntry (₹ L)', value: lakhsAuto(inventory?.value), title: full(inventory?.value), pct: null },
        {
          label: 'Budget TM (Nos.)',
          value: <FigureLink label="Headcount by HQ" onClick={byHq}>{count(pcpm.budgetTm)}</FigureLink>,
          pct: null,
        },
        {
          label: 'PCPM Coll (₹ L)',
          value: (
            <FigureLink label="PCPM by HQ" onClick={pcpm.pcpmCollection === null ? undefined : byHq}>
              {lakhs(pcpm.pcpmCollection, 1)}
            </FigureLink>
          ),
          pct: null,
        },
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

const CADRES = [
  { key: 'tm', label: 'TMs' },
  { key: 'rm', label: 'RMs' },
  { key: 'zsm', label: 'ZSMs' },
] as const;

/** The HR views' cadre codes (ZSM is ZM there). */
const CADRE_CODE: Record<string, string> = { tm: 'TM', rm: 'RM', zsm: 'ZM' };

const TENURES = [
  { key: 'under6m', label: '< 6 Months' },
  { key: 'm6to12', label: '6 months to 1 Year' },
  { key: 'over1y', label: '> 1 Year' },
] as const;

/**
 * The report's attrition block: leavers ("Attrition") and joiners ("New
 * Joiners") by cadre, and leavers by tenure at exit ("left with ageing"), from
 * the SAP HR exit and hiring views. Division-level only; in a narrower view the
 * panel keeps its place and says why.
 */
export function ManpowerAttrition({
  data,
  loading,
  stale,
  reason,
  onOpen,
}: {
  /** Null (or absent) when this view cannot show it. */
  data?: ManpowerPanel | null;
  loading: boolean;
  stale: boolean;
  /** Why the panel is empty, from meta.unavailable. */
  reason?: string;
  /** The counts open the leavers and joiners lists when given. */
  onOpen?: OpenDetail;
}) {
  /** A count that lists its people: leavers or joiners of a cadre, maybe of a tenure. */
  const people = (n: number, list: 'leavers' | 'joiners', cadre: string, label: string, tenure?: string) => (
    <FigureLink
      label={label}
      onClick={
        onOpen && hasAny(n)
          ? () => onOpen(list, { cadre: CADRE_CODE[cadre]!, ...(tenure ? { tenure } : {}) })
          : undefined
      }
    >
      {count(n)}
    </FigureLink>
  );
  return (
    <Panel title="Manpower Attrition" tone="teal" stale={stale}>
      {loading ? (
        <div className="p-3">
          <TableSkeleton rows={6} />
        </div>
      ) : !data ? (
        <p className="px-4 py-8 text-center text-[12px] leading-relaxed text-[var(--xl-muted)]">
          {reason ?? 'Attrition is not available for this view.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-[var(--xl-grid)]">
            <table className="xl-table tnum">
              <caption className="sr-only">Attrition: field force who left in the period</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left">Attrition</th>
                  <th scope="col" className="text-right">Left</th>
                </tr>
              </thead>
              <tbody>
                {CADRES.map((c) => (
                  <tr key={c.key}>
                    <th scope="row" className="text-left">{c.label} Left</th>
                    <td className="text-right">
                      {people(data.left[c.key], 'leavers', c.key, `List the ${c.label} who left`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="xl-table tnum">
              <caption className="sr-only">New joiners in the period</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left">New Joiners</th>
                  <th scope="col" className="text-right">Joined</th>
                </tr>
              </thead>
              <tbody>
                {CADRES.map((c) => (
                  <tr key={c.key}>
                    <th scope="row" className="text-left">{c.label}</th>
                    <td className="text-right">
                      {people(data.joined[c.key], 'joiners', c.key, `List the ${c.label} who joined`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* One "left with ageing" table per cadre, as the report lays them out. */}
          <div className="mt-3 grid grid-cols-1 gap-3 px-0 sm:grid-cols-3">
            {CADRES.map((c) => (
              <table key={c.key} className="xl-table tnum">
                <caption className="sr-only">{`${c.label} who left, by tenure at exit`}</caption>
                <thead>
                  <tr>
                    <th scope="col" colSpan={2} className="text-left">
                      No. of {c.label} left with ageing
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TENURES.map((t) => (
                    <tr key={t.key}>
                      <th scope="row" className="text-left !font-semibold">{t.label}</th>
                      <td className="text-right">
                        {people(
                          data.leftByTenure[c.key][t.key], 'leavers', c.key,
                          `List the ${c.label} who left after ${t.label}`, t.key,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
          <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--xl-muted)]">
            Leavers count in the month of their last working day (DOL); ageing is DOL − DOJ. Whole
            division: the HR views carry no zone, region or HQ.
          </p>
        </>
      )}
    </Panel>
  );
}

/**
 * The report's "Rx, Rxber, P/D" table: prescriptions, prescribers and
 * prescriptions per prescriber per month, each with growth on the same months
 * a year earlier.
 */
export function RxRxberPd({
  data,
  loading,
  stale,
  periodFrom,
  periodTo,
  reason,
}: {
  data?: RxPanel;
  loading: boolean;
  stale: boolean;
  /** The selected period, to say when Rx covers only part of it. */
  periodFrom?: number;
  periodTo?: number;
  /** Why there are no figures, from meta.unavailable. */
  reason?: string;
}) {
  const rows = data
    ? [
        { label: 'Rxns', value: count(data.rxns.value), gr: data.rxns.gr, title: 'Prescriptions in the period' },
        { label: 'Rxber', value: count(data.rxber.value), gr: data.rxber.gr, title: 'Prescribers per month' },
        {
          label: 'P/D/M',
          value: data.pdm.value === null ? '—' : data.pdm.value.toFixed(1),
          gr: data.pdm.gr,
          title: 'P/D/M = Rxns ÷ Rxber',
        },
      ]
    : [];
  const months =
    data?.from != null && data.to != null
      ? data.from === data.to
        ? monthLabel(data.from)
        : `${monthLabel(data.from)} – ${monthLabel(data.to)}`
      : null;
  const partial = months !== null && (data!.from !== periodFrom || data!.to !== periodTo);

  return (
    <Panel title="Rx, Rxber, P/D" tone="navy" stale={stale}>
      {loading || !data ? (
        <div className="p-3">
          <TableSkeleton rows={3} />
        </div>
      ) : (
        <>
          <table className="xl-table tnum">
            <caption className="sr-only">Prescriptions, prescribers and prescriptions per prescriber</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left" />
                <th scope="col" className="text-right">No.</th>
                <th scope="col" className="text-right">Gr%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="text-left" title={r.title}>{r.label}</th>
                  <td className="text-right">{r.value}</td>
                  <td className="text-right">{pctCell(r.gr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--xl-muted)]">
            {reason ??
              (partial ? `Rx data covers ${months} only of the selected period. ` : '') +
                'Rxber is prescribers per month; a doctor writing several SKUs counts once for each. P/D/M = Rxns ÷ Rxber.'}
          </p>
        </>
      )}
    </Panel>
  );
}
