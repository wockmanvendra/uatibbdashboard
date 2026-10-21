/**
 * The doctors behind "Drs Missed": every doctor the TM did not visit in the
 * period (visit summary, tmVisitCounts = 0), in a panel that slides in from the
 * right. Paged on the server; searchable, filterable by category, exportable.
 *
 * Esc, the close button or a click on the backdrop closes it, and focus goes
 * back to what opened it.
 */
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchMissedDoctors } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { count } from '../../lib/format';
import { label as monthLabel } from '../../lib/yrmn';
import { canon, type Filters } from '../../queries/keys';
import { useSession } from '../../auth/useSession';
import type { MissedDoctorRow } from '../../types/api';

const PAGE_SIZE = 100;

const COLUMNS: { label: string; value: (r: MissedDoctorRow) => string | number; align?: 'right' }[] = [
  { label: 'Month', value: (r) => monthLabel(r.month) },
  { label: 'Zone', value: (r) => r.zone ?? '' },
  { label: 'Region', value: (r) => r.region ?? '' },
  { label: 'HQ', value: (r) => r.hq ?? r.hqCode ?? '' },
  { label: 'TM', value: (r) => r.tmName ?? 'Vacant' },
  { label: 'Doctor', value: (r) => r.doctorName ?? '' },
  { label: 'Doctor code', value: (r) => r.doctorCode ?? '' },
  { label: 'Speciality', value: (r) => r.speciality ?? '' },
  { label: 'Cat.', value: (r) => r.category ?? '' },
  { label: 'RM visits', value: (r) => r.rmVisits ?? '', align: 'right' },
  { label: 'ZSM visits', value: (r) => r.zsmVisits ?? '', align: 'right' },
];

export function MissedDoctorsDrawer({
  open,
  onClose,
  filters,
  periodLabel,
  categories,
  initialCategory = null,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  periodLabel: string;
  /** The categories with missed doctors, for the filter chips. */
  categories: string[];
  /** Open already filtered to one category (a click on its bar). */
  initialCategory?: string | null;
}) {
  const { scopeId } = useSession();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string | null>(initialCategory);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Each opening starts fresh, on the category it was opened for.
  useEffect(() => {
    if (!open) return;
    setPage(1);
    setSearch('');
    setTerm('');
    setCategory(initialCategory);
    setExportError(null);
  }, [open, initialCategory]);

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
    queryKey: ['missed-doctors', scopeId, canon(filters), page, term, category],
    queryFn: ({ signal }) =>
      fetchMissedDoctors(filters, { page, pageSize: PAGE_SIZE, search: term, category }, signal),
    enabled: open,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const all = await fetchMissedDoctors(filters, { all: true, search: term, category });
      downloadCsv(
        'missed-doctors',
        COLUMNS.map((c) => c.label),
        all.rows.map((r) => COLUMNS.map((c) => c.value(r))),
      );
    } catch {
      setExportError('Could not export. Try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="missed-doctors-title"
        className={`absolute right-0 top-0 flex h-full w-full max-w-[1180px] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {open && (
          <>
            <header className="flex items-start justify-between gap-4 bg-[var(--xl-navy)] px-5 py-3 text-white">
              <div>
                <h2 id="missed-doctors-title" className="text-[15px] font-bold uppercase tracking-[0.02em]">
                  Missed doctors
                </h2>
                <p className="text-[12px] text-white/80">
                  {periodLabel} · doctors the TM did not visit
                  {data ? ` · ${count(total)} ${total === 1 ? 'record' : 'records'}` : ''}
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

            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--xl-grid)] px-5 py-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search doctor, code, HQ, TM or speciality"
                aria-label="Search missed doctors"
                maxLength={80}
                className="h-8 w-72 rounded border border-[var(--xl-grid)] px-2 text-[13px] focus:border-[var(--xl-navy)] focus:outline-none"
              />
              <div className="flex flex-wrap gap-1" role="group" aria-label="Category">
                {[null, ...categories].map((c) => (
                  <button
                    key={c ?? 'all'}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => {
                      setCategory(c);
                      setPage(1);
                    }}
                    className={`h-8 rounded border px-3 text-[12px] font-semibold ${
                      category === c
                        ? 'border-[var(--xl-navy)] bg-[var(--xl-navy)] text-white'
                        : 'border-[var(--xl-grid)] bg-white text-[var(--xl-label)] hover:border-[var(--xl-navy)]'
                    }`}
                  >
                    {c ?? 'All'}
                  </button>
                ))}
              </div>
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

            <div className={`min-h-0 flex-1 overflow-auto ${isFetching && data ? 'opacity-60' : ''}`}>
              {isError ? (
                <p className="p-6 text-[13px] text-bad">
                  {error instanceof Error ? error.message : 'Could not load the missed doctors.'}
                </p>
              ) : isPending && !data ? (
                <p className="p-6 text-[13px] text-[var(--xl-muted)]">Loading missed doctors…</p>
              ) : total === 0 ? (
                <p className="p-6 text-[13px] text-[var(--xl-muted)]">
                  {term || category ? 'No missed doctors match this search.' : 'No missed doctors for this selection.'}
                </p>
              ) : (
                <table className="xl-table tnum">
                  <caption className="sr-only">Missed doctors for the selected period</caption>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {COLUMNS.map((c) => (
                        <th key={c.label} scope="col" className={c.align === 'right' ? 'text-right' : 'text-left'}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data!.rows.map((r, i) => (
                      <tr key={`${r.month}-${r.hqCode}-${r.doctorCode}-${i}`}>
                        {COLUMNS.map((c) => (
                          <td
                            key={c.label}
                            className={`whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${
                              c.label === 'TM' && !r.tmName ? 'italic text-[var(--xl-muted)]' : ''
                            }`}
                          >
                            {c.value(r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {total > 0 && (
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
