import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { fetchFilterOptions } from '../lib/api';
import { metaKeys } from './keys';
import { useSession } from '../auth/useSession';

type Selection = { division: string[]; zone: string[]; region: string[] };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));

/**
 * Cascading filter options, already scope-filtered by the API.
 * Options change only when a parent level changes, so this is keyed on the
 * parent selection and not on the full filter set.
 *
 * While a new selection's lists load, the previous lists stay on screen and
 * only the levels below the change are marked pending — choosing a zone does
 * not blank the Division and Brand dropdowns.
 */
export function useFilterOptions(sel: Selection) {
  const { scopeId } = useSession();

  const query = useQuery({
    queryKey: metaKeys.filters(scopeId, sel),
    queryFn: ({ signal }) => fetchFilterOptions(sel, signal),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  // The selection the lists on screen were fetched for.
  const shown = useRef<Selection>(sel);
  if (query.data && !query.isPlaceholderData) shown.current = sel;

  const waiting = query.isPlaceholderData;
  const divisionChanged = !sameSet(shown.current.division, sel.division);
  const zoneChanged = divisionChanged || !sameSet(shown.current.zone, sel.zone);
  const regionChanged = zoneChanged || !sameSet(shown.current.region, sel.region);

  return {
    ...query,
    pending: {
      brand: waiting && divisionChanged,
      zone: waiting && divisionChanged,
      region: waiting && zoneChanged,
      hq: waiting && regionChanged,
    },
  };
}
