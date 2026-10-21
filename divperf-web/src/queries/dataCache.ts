/**
 * VITE_DATA_CACHE=off (divperf-web/.env): the browser keeps no dashboard data
 * between views — every tab and filter change fetches afresh, and nothing is
 * prefetched (with the API's cache also off, a prefetch is a full warehouse
 * round trip nobody may look at). Pair it with CACHE_DRIVER=none in the API.
 */
export const DATA_CACHE_OFF = import.meta.env.VITE_DATA_CACHE === 'off';
