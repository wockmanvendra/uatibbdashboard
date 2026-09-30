import type { ReactNode } from 'react';
import { EM_DASH, growth, growthClass, money, moneyFull, percent } from '../../lib/format';
import { GapRibbon } from '../panels/GapRibbon';

interface StatProps {
  /** Visible label. Kept as short as the Excel's ("Tgt", "Coll", "Disp"). */
  label: string;
  /**
   * Full-word name for assistive tech. The visible abbreviations are what
   * managers recognise from the report, but "Coll achievement" is a poor thing
   * to hear read aloud.
   */
  srLabel?: string;
  value: number | null | undefined;
  /** How to render the value. Money abbreviates to L/Cr; count is plain. */
  format?: 'money' | 'count' | 'percent';
  /** Achievement drives the gap ribbon. Omit to hide the ribbon entirely. */
  ach?: number | null;
  /** Growth vs the prior-year window, rendered signed and coloured. */
  gr?: number | null;
  /** Small caption under the value, e.g. a definition reminder. */
  hint?: ReactNode;
  size?: 'lg' | 'sm';
}

export function Stat({
  label, srLabel, value, format = 'money', ach, gr, hint, size = 'lg',
}: StatProps) {
  const name = srLabel ?? label;
  const text =
    value === null || value === undefined
      ? EM_DASH
      : format === 'money'
        ? money(value)
        : format === 'percent'
          ? percent(value)
          : value.toLocaleString('en-IN');

  const isNull = value === null || value === undefined;

  return (
    <div className="min-w-0">
      <div className="kpi-label" title={srLabel && srLabel !== label ? srLabel : undefined}>
        {label}
      </div>
      <div
        className={`${size === 'lg' ? 'text-kpi' : 'text-[19px] font-semibold'} tnum mt-0.5 truncate ${
          isNull ? 'text-ink-3' : value < 0 ? 'text-bad' : 'text-ink'
        }`}
        title={format === 'money' && !isNull ? moneyFull(value) : undefined}
      >
        {text}
      </div>

      {ach !== undefined && <GapRibbon ach={ach} label={`${name} achievement`} />}

      {(ach !== undefined || gr !== undefined) && (
        <div className="mt-1.5 flex items-baseline gap-3 text-[11px] tnum">
          {ach !== undefined && (
            <span className="text-ink-2">
              <span className="text-ink-3">Ach </span>
              {percent(ach)}
            </span>
          )}
          {gr !== undefined && (
            <span className={growthClass(gr)}>
              <span className="text-ink-3">Gr </span>
              {growth(gr)}
            </span>
          )}
        </div>
      )}

      {hint && <div className="mt-1 text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
}
