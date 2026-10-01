/**
 * Period From / To.
 *
 * Only months that exist in the source are offered — the warehouse has a
 * 12-month hole (202504–202603), and letting a user select into it produces an
 * empty dashboard with no explanation. Missing months are shown disabled rather
 * than hidden, so the gap is visible instead of mysterious.
 */
import type { MonthOption } from '../../types/api';
import { monthCount } from '../../lib/yrmn';

interface MonthRangePickerProps {
  months: MonthOption[];
  from: number;
  to: number;
  onChange: (from: number, to: number) => void;
  loading?: boolean;
}

export function MonthRangePicker({ months, from, to, onChange, loading }: MonthRangePickerProps) {
  const available = months.map((m) => m.yrMn);
  const min = available.length ? Math.min(...available) : from;
  const max = available.length ? Math.max(...available) : to;

  // Every month between the first and last available one, so the gap renders.
  const all: MonthOption[] = [];
  for (let y = Math.floor(min / 100); y <= Math.floor(max / 100); y++) {
    for (let m = 1; m <= 12; m++) {
      const k = y * 100 + m;
      if (k < min || k > max) continue;
      const found = months.find((x) => x.yrMn === k);
      all.push(found ?? { yrMn: k, label: labelOf(k), isClosed: true });
    }
  }

  const span = monthCount(from, to);

  return (
    <div className="flex items-end gap-2">
      <Select
        label="Period from"
        value={from}
        options={all}
        available={available}
        disabled={loading}
        onChange={(v) => onChange(v, Math.max(v, to))}
      />
      <Select
        label="To"
        value={to}
        options={all}
        available={available}
        disabled={loading}
        onChange={(v) => onChange(Math.min(from, v), v)}
      />
      <span className="pb-1.5 whitespace-nowrap text-[11px] font-semibold text-[var(--xl-label)] tnum">
        {span} {span === 1 ? 'month' : 'months'}
      </span>
    </div>
  );
}

function Select({
  label, value, options, available, onChange, disabled,
}: {
  label: string;
  value: number;
  options: MonthOption[];
  available: number[];
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label className="xl-label">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="xl-field tnum"
      >
        {options.map((m) => {
          const has = available.includes(m.yrMn);
          return (
            <option key={m.yrMn} value={m.yrMn} disabled={!has}>
              {m.label}
              {!has ? ' — no data' : m.isClosed ? '' : ' (open)'}
            </option>
          );
        })}
      </select>
    </div>
  );
}

const ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const labelOf = (k: number) => `${ABBR[(k % 100) - 1]}-${String(Math.floor(k / 100) % 100).padStart(2, '0')}`;
