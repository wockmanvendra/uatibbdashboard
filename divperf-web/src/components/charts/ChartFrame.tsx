/**
 * Wraps every chart so the accessibility floor is met once rather than per
 * chart. (§9.6)
 *
 * Styled as an Excel chart object — thin border, centred title — and each one
 * is keyboard-reachable and ships an equivalent data table.
 */
import { useId, useState, type ReactNode } from 'react';
import { EM_DASH, percent } from '../../lib/format';
import { lakhLabel } from './chartTheme';

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
  /** Header for the table's first column. */
  categoryLabel?: string;
}

function fmt(v: number | null, format: TableSeries['format']): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EM_DASH;
  if (format === 'percent') return percent(v);
  if (format === 'number') return v.toLocaleString('en-IN');
  return lakhLabel(v);
}

export function ChartFrame({
  title,
  note,
  height,
  children,
  categories,
  series,
  stale = false,
  categoryLabel = 'Month',
}: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  return (
    <section className="xl-chart" style={stale ? { opacity: 0.55 } : undefined}>
      <h2 className="xl-chart-title">{title}</h2>
      {note && <p className="mt-0.5 px-2 text-center text-[11px] text-[var(--xl-muted)]">{note}</p>}
      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        aria-expanded={showTable}
        aria-controls={tableId}
        className="xl-btn absolute right-2 top-2"
      >
        {showTable ? 'Chart' : 'Table'}
      </button>

      <div className="mt-1">
        {showTable ? (
          <div id={tableId} className="overflow-auto" style={{ height }}>
            <table className="xl-table tnum text-[12px]">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left">{categoryLabel}</th>
                  {series.map((s) => (
                    <th key={s.name} scope="col" className="text-right">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((c, i) => (
                  <tr key={c}>
                    <th scope="row" className="text-left">{c}</th>
                    {series.map((s) => (
                      <td key={s.name} className="text-right">
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
      </div>
    </section>
  );
}
