/**
 * VITE_DATA_CACHE=off (divperf-web/.env): the browser keeps no dashboard data
 * between views — every tab and filter change fetches afresh, and nothing is
 * prefetched. Pair it with CACHE_DRIVER=none in the API.
 */
export const DATA_CACHE_OFF = import.meta.env.VITE_DATA_CACHE === 'off';

/**
 * VITE_PREFETCH=on: fetch the neighbouring months and a hovered tab ahead of
 * the click. Off by default — a prefetch the user never looks at still makes
 * the API build that view from Synapse.
 */
export const PREFETCH_ON = !DATA_CACHE_OFF && import.meta.env.VITE_PREFETCH === 'on';
