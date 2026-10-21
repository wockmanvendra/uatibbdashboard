import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchTab } from '../lib/api';
import { dashKeys, type Filters } from './keys';
import { policy } from './policy';
import { useSession } from '../auth/useSession';
import { nextYrMn, prevYrMn } from '../lib/yrmn';
import { DATA_CACHE_OFF } from './dataCache';

/**
 * Prefetch the adjacent months on idle. (§8.4)
 * Debounced so rapid clicking through the month picker does not fire a storm.
 */
export function usePrefetchMonths(tab: string, filters: Filters) {
  const qc = useQueryClient();
  const { scopeId, openYrMn } = useSession();

  useEffect(() => {
    if (DATA_CACHE_OFF) return;
    const id = setTimeout(() => {
      for (const to of [prevYrMn(filters.to), nextYrMn(filters.to)]) {
        if (to > openYrMn) continue;
        const f = { ...filters, to };
        void qc.prefetchQuery({
          queryKey: dashKeys.tab(tab, scopeId, f),
          queryFn: ({ signal }) => fetchTab(tab, f, signal),
          ...policy(to, openYrMn),
        });
      }
    }, 400);
    return () => clearTimeout(id);
    // Intentionally not keyed on the whole filters object: prefetching on every
    // dimension change would multiply requests for little gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filters.to, scopeId, openYrMn]);
}

/**
 * Prefetch a sibling tab on tab-strip hover. (§8.4)
 * A mouseover buys roughly 200 ms of head start, which is usually the entire
 * request — hence the sub-50 ms target for a prefetched tab switch.
 */
export function usePrefetchTab() {
  const qc = useQueryClient();
  const { scopeId, openYrMn } = useSession();

  return (tab: string, filters: Filters) => {
    if (DATA_CACHE_OFF) return () => {};
    const timer = setTimeout(() => {
      void qc.prefetchQuery({
        queryKey: dashKeys.tab(tab, scopeId, filters),
        queryFn: ({ signal }) => fetchTab(tab, filters, signal),
        ...policy(filters.to, openYrMn),
      });
    }, 150);
    return () => clearTimeout(timer);
  };
}
