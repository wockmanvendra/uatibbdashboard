/**
 * Session: who the user is and what they may see.
 *
 * The user and their scope id come from the signed-in session. `openYrMn`
 * comes from the server (§4.9) and never from the browser clock — fiscal month
 * close does not follow the calendar and client clocks lie.
 */
import { useQuery } from '@tanstack/react-query';
import { fetchDataVersion } from '../lib/api';
import { metaKeys } from '../queries/keys';
import { useAuthStore } from './authStore';

export interface Session {
  scopeId: string;
  displayName: string;
  openYrMn: number;
  dataVersion: string;
  isLoading: boolean;
}

/** Used until the version endpoint answers, so hooks always have a number. */
const FALLBACK_OPEN_YR_MN = 202608;

export function useSession(): Session {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading } = useQuery({
    queryKey: metaKeys.version,
    queryFn: ({ signal }) => fetchDataVersion(signal),
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  return {
    scopeId: user?.scopeId ?? 'signed-out',
    displayName: user?.name ?? '',
    openYrMn: data?.openYrMn ?? FALLBACK_OPEN_YR_MN,
    dataVersion: data?.dataVersion ?? '',
    isLoading,
  };
}
