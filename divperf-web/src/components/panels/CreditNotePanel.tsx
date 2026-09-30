/**
 * The Excel "CN and O/S" card: Total CN / Exp CN / SRCN / PD CN / Total O/S,
 * each with a Value and a % column.
 */
import type { CreditNotePanel as CnData } from '../../types/api';
import { Card } from '../ui/Card';
import { TableSkeleton } from '../ui/States';
import { EM_DASH, money, moneyFull, percent } from '../../lib/format';

const ROWS = [
  { label: 'Total CN', value: 'totalCn', pct: 'cnPct', emphasis: true },
  { label: 'Exp CN', value: 'expCn', pct: 'expCnPct', emphasis: false },
  { label: 'SRCN', value: 'srCn', pct: 'srCnPct', emphasis: false },
  { label: 'PD CN', value: 'pdCn', pct: 'pdCnPct', emphasis: false },
  { label: 'Total O/S', value: 'totalOs', pct: 'osPct', emphasis: true },
] as const;

export function CreditNoteCard({
  cn,
  loading,
  stale,
}: {
  cn?: CnData;
  loading: boolean;
  stale: boolean;
}) {
  return (
    <Card title="CN and O/S" stale={stale}>
      {loading || !cn ? (
        <TableSkeleton rows={5} />
      ) : (
        <table className="w-full border-separate border-spacing-0 text-[13px] tnum">
          <thead>
            <tr>
              <th scope="col" className="rounded-l-md bg-[var(--table-head)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                <span className="sr-only">Measure</span>
              </th>
              <th scope="col" className="bg-[var(--table-head)] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                Value
              </th>
              <th scope="col" className="rounded-r-md bg-[var(--table-head)] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const v = cn[r.value] as number | null;
              const p = cn[r.pct] as number | null;
              return (
                <tr
                  key={r.label}
                  className={r.emphasis ? 'bg-[var(--table-total)]' : 'bg-surface'}
                  style={{ height: 'var(--row-h)' }}
                >
                  <th
                    scope="row"
                    className={`border-b border-rule-soft text-left ${r.emphasis ? 'px-3 font-semibold text-ink' : 'pl-6 pr-3 font-normal text-ink-2'}`}
                  >
                    {r.label}
                  </th>
                  <td
                    className={`border-b border-rule-soft px-3 text-right ${r.emphasis ? 'font-semibold text-ink' : 'text-ink-2'}`}
                    title={v === null ? undefined : moneyFull(v)}
                  >
                    {v === null ? EM_DASH : money(v)}
                  </td>
                  <td className="border-b border-rule-soft px-3 text-right text-ink-3">{p === null ? EM_DASH : percent(p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-[11px] text-ink-3">% of gross sales for the selected period.</p>
    </Card>
  );
}
