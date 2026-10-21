import { DATA_CACHE_OFF } from './dataCache';

/**
 * Tiered freshness. (§8.4, invariant I7)
 *
 * A closed month cannot change, so do not refetch it. This asymmetry is what
 * makes month-scrubbing through history feel instant.
 */
const DAY = 86_400_000;

export function policy(to: number, openYrMn: number) {
  // Caching switched off: always fetch, keep nothing once a view is left.
  if (DATA_CACHE_OFF) return { staleTime: 0, gcTime: 0, refetchOnWindowFocus: true as const };
  return to < openYrMn
    ? { staleTime: DAY, gcTime: DAY, refetchOnWindowFocus: false as const }
    : { staleTime: 5 * 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: true as const };
}
