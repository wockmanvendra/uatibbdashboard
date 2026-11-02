import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchTab } from '../lib/api';
import { dashKeys, type Filters } from './keys';
import { policy } from './policy';
import { useSession } from '../auth/useSession';
import { useFilterStore } from '../store/filterStore';

/**
 * The one query per tab. (invariant I2)
 *
 * `keepPreviousData` keeps the previous month's charts on screen, dimmed,
 * instead of flashing skeletons on every month change.
 *
 * Do NOT split panels into separate useQuery calls. It is the natural React
 * instinct and it puts you back at 14 round trips. Derive panel props from this
 * one result; TanStack's structural sharing means a panel re-renders only when
 * its own slice actually changed. (§8.4)
 */
export function useDashTab(tab: string, filters: Filters) {
  const { scopeId, openYrMn } = useSession();
  // Not before the period is settled: a request on the placeholder period
  // would make the API build a view nobody looks at.
  const periodReady = useFilterStore((s) => s.periodReady);

  return useQuery({
    queryKey: dashKeys.tab(tab, scopeId, filters),
    queryFn: ({ signal }) => fetchTab(tab, filters, signal),
    enabled: periodReady,
    placeholderData: keepPreviousData,
    ...policy(filters.to, openYrMn),
    // The API served the previous figures while it rebuilds: ask again shortly.
    refetchInterval: (q) => (q.state.data?.meta.refreshing ? 30_000 : false),
  });
}
