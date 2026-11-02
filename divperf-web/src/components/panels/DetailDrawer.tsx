/**
 * The side panel behind every clickable figure: a detail list — missed
 * doctors, leavers, TM-wise effort, HQ headcount — that slides in from the
 * right. The server describes each list (columns, filter chips, notes), so
 * this one component shows them all. Paged on the server; searchable,
 * filterable, exportable.
 *
 * Esc, the close button or a click on the backdrop closes it, and focus goes
 * back to what opened it.
 */
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchDetailList } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { count, lakhs, percent } from '../../lib/format';
import { label as monthLabel } from '../../lib/yrmn';
import { canon, type Filters } from '../../queries/keys';
import { useSession } from '../../auth/useSession';
import type { DetailColumn, DetailListId } from '../../types/api';

const PAGE_SIZE = 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Cell = string | number | null | undefined;

/** "20260903" → "03-Sep-2026". */
function date(v: Cell): string {
  const s = String(v ?? '');
  if (!/^\d{8}$/.test(s)) return s;
  return `${s.slice(6, 8)}-${MONTHS[Number(s.slice(4, 6)) - 1] ?? s.slice(4, 6)}-${s.slice(0, 4)}`;
}

/** A cell as shown on screen. */
function show(v: Cell, format: DetailColumn['format']): string {
  if (v === null || v === undefined || v === '') return format === 'text' ? '' : '—';
  switch (format) {
    case 'number':
      return count(Number(v));
    case 'decimal':
      return Number(v).toFixed(1);
    case 'percent':
      return percent(Number(v));
    case 'money':
      return lakhs(Number(v), 2);
    case 'month':
      return monthLabel(Number(v));
    case 'date':
      return date(v);
    default:
      return String(v);
  }
}

/** A cell as exported: numbers raw, months and dates readable. */
const exported = (v: Cell, format: DetailColumn['format']): string | number =>
  v === null || v === undefined ? '' : format === 'month' || format === 'date' ? show(v, format) : v;

const RIGHT = new Set<DetailColumn['format']>(['number', 'decimal', 'percent', 'money']);

/** One opening of the panel: the list, and the facet values chosen by what opened it. */
export interface DetailRequest {
  list: DetailListId;
  /** e.g. { cadre: 'TM' } for the TMs who left. */
  initial?: Record<string, string>;
}

export function DetailDrawer({
  request,
  onClose,
  filters,
  periodLabel,
}: {
  /** Null when closed; a new object for every opening. */
  request: DetailRequest | null;
  onClose: () => void;
  filters: Filters;
  periodLabel: string;
}) {
  const { scopeId } = useSession();
  const open = request !== null;
  const list = request?.list ?? null;
  const [opened, setOpened] = useState<DetailRequest | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [facets, setFacets] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Each opening starts fresh, on the facets it was opened with. Reset during
  // render, so the first request already carries them.
  if (request && request !== opened) {
    setOpened(request);
    setPage(1);
    setSearch('');
    setTerm('');
    setFacets(request.initial ?? {});
    setExportError(null);
  }

  // Search as the user types, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Esc closes; the page behind does not scroll; focus moves in, then back.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  const { data, isPending, isFetching, isError, error } = useQuery({
    queryKey: ['detail', list, scopeId, canon(filters), page, term, facets],
    queryFn: ({ signal }) =>
      fetchDetailList(list!, filters, { page, pageSize: PAGE_SIZE, search: term, facets }, signal),
    enabled: open && list !== null,
    // Keep the rows on screen while paging or filtering the same list — never
    // carry one list's rows over to another.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === list ? keepPreviousData(previous) : undefined,
    staleTime: 60_000,
  });

  const current = data && open ? data : undefined;
  const total = current?.total ?? 0;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const chosen = (key: string, options: { value: string }[]) => facets[key] ?? options[0]?.value;
  const filtered = !!term || Object.keys(facets).length > 0;

  async function exportCsv() {
    if (!list || !current) return;
    setExporting(true);
    setExportError(null);
    try {
      const all = await fetchDetailList(list, filters, { all: true, search: term, facets });
      downloadCsv(
        list,
        all.columns.map((c) => c.label),
        all.rows.map((r) => all.columns.map((c) => exported(r[c.key], c.format))),
      );
    } catch {
      setExportError('Could not export. Try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-drawer-title"
        className={`absolute right-0 top-0 flex h-full w-full max-w-[1180px] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {open && (
          <>
            <header className="flex items-start justify-between gap-4 bg-[var(--xl-navy)] px-5 py-3 text-white">
              <div>
                <h2 id="detail-drawer-title" className="text-[15px] font-bold uppercase tracking-[0.02em]">
                  {current?.title ?? 'Loading…'}
                </h2>
                <p className="text-[12px] text-white/80">
                  {periodLabel}
                  {current && !current.unavailable ? ` · ${count(total)} ${total === 1 ? 'record' : 'records'}` : ''}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="rounded px-2 py-1 text-[20px] leading-none text-white/90 hover:bg-white/15"
                aria-label="Close"
              >
                ×
              </button>
            </header>

            {current && !current.unavailable && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--xl-grid)] px-5 py-3">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  aria-label={`Search ${current.title.toLowerCase()}`}
                  maxLength={80}
                  className="h-8 w-60 rounded border border-[var(--xl-grid)] px-2 text-[13px] focus:border-[var(--xl-navy)] focus:outline-none"
                />
                {current.facets.map((f) => (
                  <div key={f.key} className="flex flex-wrap items-center gap-1" role="group" aria-label={f.label}>
                    <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--xl-muted)]">
                      {f.label}
                    </span>
                    {f.options.map((o) => {
                      const on = chosen(f.key, f.options) === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setFacets((cur) => ({ ...cur, [f.key]: o.value }));
                            setPage(1);
                          }}
                          className={`h-7 rounded border px-2.5 text-[12px] font-semibold ${
                            on
                              ? 'border-[var(--xl-navy)] bg-[var(--xl-navy)] text-white'
                              : 'border-[var(--xl-grid)] bg-white text-[var(--xl-label)] hover:border-[var(--xl-navy)]'
                          }`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  {exportError && <span className="text-[12px] text-bad">{exportError}</span>}
                  <button
                    type="button"
                    className="xl-btn h-8"
                    onClick={() => void exportCsv()}
                    disabled={exporting || total === 0}
                  >
                    {exporting ? 'Exporting…' : 'Export CSV'}
                  </button>
                </div>
              </div>
            )}
            {current?.note && !current.unavailable && (
              <p className="border-b border-[var(--xl-grid)] bg-[var(--xl-zebra)] px-5 py-1.5 text-[11px] text-[var(--xl-muted)]">
                {current.note}
              </p>
            )}

            <div className={`min-h-0 flex-1 overflow-auto ${isFetching && current ? 'opacity-60' : ''}`}>
              {isError ? (
                <p className="p-6 text-[13px] text-bad">
                  {error instanceof Error ? error.message : 'Could not load this list.'}
                </p>
              ) : !current || (isPending && !current) ? (
                <p className="p-6 text-[13px] text-[var(--xl-muted)]">Loading…</p>
              ) : current.unavailable ? (
                <p className="p-6 text-[13px] leading-relaxed text-[var(--xl-muted)]">{current.unavailable}</p>
              ) : total === 0 ? (
                <p className="p-6 text-[13px] text-[var(--xl-muted)]">
                  {filtered ? 'Nothing matches this search or filter.' : 'Nothing to list for this selection.'}
                </p>
              ) : (
                <table className="xl-table tnum">
                  <caption className="sr-only">{`${current.title} for the selected period`}</caption>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {current.columns.map((c) => (
                        <th key={c.key} scope="col" className={RIGHT.has(c.format) ? 'text-right' : 'text-left'}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.rows.map((r, i) => (
                      <tr key={i}>
                        {current.columns.map((c) => (
                          <td
                            key={c.key}
                            className={`whitespace-nowrap ${RIGHT.has(c.format) ? 'text-right' : 'text-left'} ${
                              r[c.key] === 'Vacant' ? 'italic text-[var(--xl-muted)]' : ''
                            }`}
                          >
                            {show(r[c.key], c.format)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {current && total > 0 && !current.unavailable && (
              <footer className="flex items-center justify-between border-t border-[var(--xl-grid)] px-5 py-2 text-[12px] text-[var(--xl-label)]">
                <span>
                  {count(first)}–{count(last)} of {count(total)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="xl-btn h-7"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    ‹ Previous
                  </button>
                  <span>
                    Page {page} of {pages}
                  </span>
                  <button
                    type="button"
                    className="xl-btn h-7"
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page >= pages}
                  >
                    Next ›
                  </button>
                </div>
              </footer>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
