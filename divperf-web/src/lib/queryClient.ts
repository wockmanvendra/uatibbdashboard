import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';
import { useAuthStore } from '../auth/authStore';

/**
 * TanStack's defaults are tuned for chatty CRUD apps. (§8.3)
 * This is a read-only reporting tool projected in meetings: refetching on every
 * window focus is noise, and a 4xx is never worth retrying.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 1;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});

// Nothing fetched under one session survives into the next.
useAuthStore.subscribe((state, prev) => {
  if (prev.token && state.token !== prev.token) queryClient.clear();
});
