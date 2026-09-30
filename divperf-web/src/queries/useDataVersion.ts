import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dashKeys, type CanonFilters } from './keys';
import { useSession } from '../auth/useSession';

/**
 * Version-based invalidation. (§8.4)
 *
 * Poll the cheap version endpoint; when it moves, invalidate ONLY open-month
 * queries. Closed months survive untouched — a manager scrubbing through last
 * year's numbers should never see them refetch because the open month reloaded.
 */
export function useDataVersionSync() {
  const qc = useQueryClient();
  const { openYrMn, dataVersion } = useSession();

  useEffect(() => {
    if (!dataVersion) return;
    void qc.invalidateQueries({
      queryKey: dashKeys.all,
      predicate: (q) => {
        const f = q.queryKey[3] as CanonFilters | undefined;
        return !!f && f.to >= openYrMn;
      },
    });
  }, [dataVersion, openYrMn, qc]);
}
