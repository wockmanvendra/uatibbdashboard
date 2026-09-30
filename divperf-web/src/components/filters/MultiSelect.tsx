/**
 * A compact multi-select for a filter dimension.
 *
 * Built rather than pulled in: the dependency list in §7.1/§8.1 is fixed, and
 * the behaviour needed here is narrow — search, toggle, clear, keyboard.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FilterOption } from '../../types/api';

interface MultiSelectProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  /** Shown when nothing is selected. */
  allLabel?: string;
  loading?: boolean;
}

export function MultiSelect({
  label, options, selected, onChange, disabled = false, allLabel = 'All', loading = false,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q),
    );
  }, [options, query]);

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.code === selected[0])?.name ?? selected[0]!)
        : `${selected.length} selected`;

  const toggle = (code: string) =>
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <label className="kpi-label mb-0.5 block">{label}</label>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        className={`flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded border px-2 text-left text-[12px] ${
          disabled || loading
            ? 'cursor-not-allowed border-rule bg-paper text-ink-3'
            : 'border-rule bg-surface text-ink hover:border-ink-3'
        } ${selected.length > 0 ? 'border-ink-3' : ''}`}
      >
        <span className="truncate">{loading ? '…' : summary}</span>
        <span aria-hidden="true" className="shrink-0 text-ink-3">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="absolute z-40 mt-1 max-h-72 w-64 overflow-hidden rounded border border-rule bg-surface shadow-lg"
        >
          <div className="border-b border-rule p-1.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              className="h-6 w-full rounded border border-rule px-1.5 text-[12px] text-ink placeholder:text-ink-3"
              autoFocus
            />
          </div>

          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-2.5 py-3 text-center text-[12px] text-ink-3">No matches.</p>
            )}
            {filtered.map((o) => {
              const on = selected.includes(o.code);
              return (
                <div
                  key={o.code}
                  role="option"
                  aria-selected={on}
                  tabIndex={0}
                  onClick={() => toggle(o.code)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(o.code);
                    }
                  }}
                  className={`flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[12px] hover:bg-paper ${
                    on ? 'text-ink' : 'text-ink-2'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    readOnly
                    tabIndex={-1}
                    className="pointer-events-none h-3 w-3 accent-[var(--series-disp)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.code !== o.name && (
                    <span className="shrink-0 font-mono text-[10px] text-ink-3">{o.code}</span>
                  )}
                </div>
              );
            })}
          </div>

          {selected.length > 0 && (
            <div className="border-t border-rule p-1.5">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded px-2 py-0.5 text-[11px] text-ink-2 hover:bg-paper"
              >
                Clear {label.toLowerCase()}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
