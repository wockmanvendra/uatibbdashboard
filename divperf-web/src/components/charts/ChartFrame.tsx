/**
 * Wraps every chart so the accessibility floor is met once rather than per
 * chart. (§9.6)
 *
 * Each chart is keyboard-reachable and ships an equivalent data table. That
 * table is not only an a11y nicety here: the inherited series palette needs
 * secondary encoding (the coll/sec pair separates by only ΔE 7.4 under
 * protanopia, and two series sit just under 3:1 contrast against the page), and
 * a readable table is the sanctioned relief for both.
 */
import { useId, useState, type ReactNode } from 'react';
import { EM_DASH, moneyFull, percent } from '../../lib/format';

export interface TableSeries {
  name: string;
  values: (number | null)[];
  format: 'money' | 'percent' | 'number';
}

interface ChartFrameProps {
  title: string;
  /** Optional note under the title, e.g. a source caveat. */
  note?: string;
  height: number;
  children: ReactNode;
  /** Row labels for the data table — usually month labels. */
  categories: string[];
  series: TableSeries[];
  stale?: boolean;
}

function fmt(v: number | null, format: TableSeries['format']): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EM_DASH;
  if (format === 'percent') return percent(v);
  if (format === 'number') return v.toLocaleString('en-IN');
  return moneyFull(v);
}

export function ChartFrame({
  title,
  note,
  height,
  children,
  categories,
  series,
  stale = false,
}: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  return (
    <section className="card flex min-w-0 flex-col" style={stale ? { opacity: 0.55 } : undefined}>
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="panel-title truncate">{title}</h2>
          {note && <p className="mt-0.5 text-[11px] text-ink-3">{note}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          aria-controls={tableId}
          className="btn-ghost shrink-0"
        >
          {showTable ? 'Chart' : 'Table'}
        </button>
      </header>

      {showTable ? (
        <div id={tableId} className="overflow-x-auto" style={{ minHeight: height }}>
          <table className="w-full border-collapse text-[12px] tnum">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-rule text-left">
                <th scope="col" className="py-1 pr-3 font-medium text-ink-3">
                  Month
                </th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="py-1 pl-3 text-right font-medium text-ink-3">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => (
                <tr key={c} className="border-b border-rule-soft">
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-ink-2">
                    {c}
                  </th>
                  {series.map((s) => (
                    <td key={s.name} className="py-1 pl-3 text-right text-ink">
                      {fmt(s.values[i] ?? null, s.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          style={{ height }}
          tabIndex={0}
          role="img"
          aria-label={`${title}. Use the Table button for the underlying values.`}
        >
          {children}
        </div>
      )}
    </section>
  );
}
