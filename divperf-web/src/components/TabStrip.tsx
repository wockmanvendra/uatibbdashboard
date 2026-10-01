/**
 * The tab strip. Hovering a tab prefetches it — a mouseover buys roughly 200 ms
 * of head start, which is usually the entire request. (§8.4)
 */
import { NavLink } from 'react-router-dom';
import { useRef } from 'react';
import { TABS } from '../tabs/registry';
import { useFilters } from '../store/filterStore';
import { usePrefetchTab } from '../queries/usePrefetch';

export function TabStrip() {
  const filters = useFilters();
  const prefetch = usePrefetchTab();
  const cancelRef = useRef<(() => void) | null>(null);

  return (
    <nav className="relative z-20 border-b border-[var(--xl-grid)] bg-white px-5" aria-label="Dashboard tabs">
      <ul className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <li key={t.id}>
            <NavLink
              to={`/${t.path}`}
              onMouseEnter={() => {
                cancelRef.current = prefetch(t.id, filters);
              }}
              onMouseLeave={() => {
                cancelRef.current?.();
                cancelRef.current = null;
              }}
              onFocus={() => {
                cancelRef.current = prefetch(t.id, filters);
              }}
              className={({ isActive }) =>
                `-mb-px inline-block whitespace-nowrap border-b-[3px] px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                  isActive
                    ? 'border-[var(--xl-navy)] text-[var(--xl-navy)]'
                    : 'border-transparent text-[var(--xl-muted)] hover:border-[var(--xl-grid)] hover:text-[var(--xl-text)]'
                }`
              }
            >
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
