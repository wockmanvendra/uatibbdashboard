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
    <nav className="border-b border-rule bg-surface px-5" aria-label="Dashboard tabs">
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
                `-mb-px inline-block whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors ${
                  isActive
                    ? 'border-[var(--series-disp)] font-medium text-ink'
                    : 'border-transparent text-ink-2 hover:text-ink'
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
