/**
 * The Excel "CN and O/S" card: Total CN / Exp CN / SRCN / PD CN / Closing O/S,
 * each with a Value and a % column. Credit notes cover the whole period; O/S is
 * a balance, so it is the one in the period's last month, never a sum.
 */
import type { CreditNotePanel as CnData } from '../../types/api';
import { Panel } from '../ui/Panel';
import { TableSkeleton } from '../ui/States';
import { EM_DASH, lakhs, moneyFull, percent } from '../../lib/format';

const ROWS = [
  { label: 'Total CN', value: 'totalCn', pct: 'cnPct', emphasis: true },
  { label: 'Exp CN', value: 'expCn', pct: 'expCnPct', emphasis: false },
  { label: 'SRCN', value: 'srCn', pct: 'srCnPct', emphasis: false },
  { label: 'PD CN', value: 'pdCn', pct: 'pdCnPct', emphasis: false },
  { label: 'Closing O/S', value: 'totalOs', pct: 'osPct', emphasis: true },
] as const;

export function CreditNoteCard({
  cn,
  loading,
  stale,
  pctNote,
  closingMonth,
}: {
  cn?: CnData;
  loading: boolean;
  stale: boolean;
  /** Which months the % column covers, when narrower than the period. */
  pctNote?: string;
  /** The month the closing O/S is from, e.g. "Aug-26". */
  closingMonth?: string;
}) {
  return (
    <Panel title="Credit Notes & Outstanding" tone="teal" stale={stale}>
      {loading || !cn ? (
        <div className="p-3">
          <TableSkeleton rows={5} />
        </div>
      ) : (
        <table className="xl-table tnum">
          <caption className="sr-only">Credit notes and outstanding for the selected period</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">Head</th>
              <th scope="col" className="text-right">Value (₹ L)</th>
              <th scope="col" className="text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const v = cn[r.value] as number | null;
              const p = cn[r.pct] as number | null;
              return (
                <tr key={r.label}>
                  <th scope="row" className={`text-left ${r.emphasis ? '' : 'pl-6 !font-semibold'}`}>
                    {r.label}
                  </th>
                  <td className="text-right" title={v === null ? undefined : moneyFull(v)}>
                    {v === null ? EM_DASH : lakhs(v, 1)}
                  </td>
                  <td className="text-right">{p === null ? EM_DASH : percent(p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="space-y-0.5 px-3 py-2 text-[11px] text-[var(--xl-muted)]">
        <p>{pctNote ?? '% of gross sales for the selected period.'}</p>
        {closingMonth && <p>Closing O/S is the outstanding balance in {closingMonth}.</p>}
      </div>
    </Panel>
  );
}
