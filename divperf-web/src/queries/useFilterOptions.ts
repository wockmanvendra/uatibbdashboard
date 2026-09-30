import { useQuery } from '@tanstack/react-query';
import { fetchFilterOptions } from '../lib/api';
import { metaKeys } from './keys';
import { useSession } from '../auth/useSession';

/**
 * Cascading filter options, already scope-filtered by the API.
 * Options change only when a parent level changes, so this is keyed on the
 * parent selection and not on the full filter set.
 */
export function useFilterOptions(sel: { division: string[]; zone: string[]; region: string[] }) {
  const { scopeId } = useSession();

  return useQuery({
    queryKey: metaKeys.filters(scopeId, sel),
    queryFn: ({ signal }) => fetchFilterOptions(sel, signal),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
}
