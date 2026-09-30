/**
 * The four mix donuts in one card, sharing a single legend and a single Table
 * view — four copies of the same legend would be noise.
 */
import { useId, useState } from 'react';
import type { MixPanel as MixPanelData } from '../../types/api';
import { MixDonut } from './MixDonut';
import { MIX_COLORS } from './chartTheme';
import { EM_DASH, moneyFull } from '../../lib/format';

const DIMENSION_LABEL: Record<MixPanelData['dimension'], string> = {
  brandGroup: 'brand group',
  brand: 'brand',
  zone: 'zone',
  region: 'region',
  hq: 'HQ',
};

export function MixPanelCard({
  mix,
  stale = false,
  note,
}: {
  mix: MixPanelData;
  stale?: boolean;
  /** Why some measures are missing, when the server said. */
  note?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const all = [
    { key: 'disp', title: 'Disp', values: mix.disp },
    { key: 'coll', title: 'Coll', values: mix.coll },
    { key: 'sec', title: 'Sec', values: mix.sec },
    { key: 'rcpa', title: 'RCPA', values: mix.rcpa },
  ] as const;

  // A donut of four em dashes teaches nothing. Only measures with real values
  // get a chart; the rest are named in the note instead.
  const measures = all.filter((m) => m.values.some((v) => v !== null && v !== 0));
  const missing = all.filter((m) => !measures.includes(m)).map((m) => m.title);

  if (measures.length === 0) return null;

  return (
    <section className="card min-w-0" style={stale ? { opacity: 0.55 } : undefined}>
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="panel-title">Mix by {DIMENSION_LABEL[mix.dimension]}</h2>
          {missing.length > 0 && (
            <p className="mt-0.5 text-[11px] text-ink-3">
              {missing.join(', ')} not shown — {note ?? 'no source in the warehouse.'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          aria-controls={tableId}
          className="shrink-0 rounded border border-rule px-2 py-0.5 text-[11px] text-ink-2 hover:bg-paper"
        >
          {showTable ? 'Charts' : 'Table'}
        </button>
      </header>

      {showTable ? (
        <div id={tableId} className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px] tnum">
            <thead>
              <tr className="border-b border-rule text-left">
                <th scope="col" className="py-1 pr-3 font-medium text-ink-3">
                  {DIMENSION_LABEL[mix.dimension]}
                </th>
                {measures.map((m) => (
                  <th key={m.key} scope="col" className="py-1 pl-3 text-right font-medium text-ink-3">
                    {m.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mix.labels.map((l, i) => (
                <tr key={l} className="border-b border-rule-soft">
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-ink-2">
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-sm align-middle"
                      style={{ background: MIX_COLORS[i % MIX_COLORS.length] }}
                      aria-hidden="true"
                    />
                    {l}
                  </th>
                  {measures.map((m) => (
                    <td key={m.key} className="py-1 pl-3 text-right text-ink">
                      {m.values[i] === null || m.values[i] === undefined
                        ? EM_DASH
                        : moneyFull(m.values[i] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div
            className={`grid gap-2 ${
              measures.length === 1
                ? 'mx-auto max-w-xs grid-cols-1'
                : measures.length === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-2 xl:grid-cols-4'
            }`}
          >
            {measures.map((m) => (
              <MixDonut key={m.key} title={m.title} labels={mix.labels} values={m.values} />
            ))}
          </div>

          {/* One legend for all four donuts. */}
          <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-rule pt-2">
            {mix.labels.map((l, i) => (
              <li key={l} className="flex items-center gap-1.5 text-[11px] text-ink-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: MIX_COLORS[i % MIX_COLORS.length] }}
                  aria-hidden="true"
                />
                {l}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
