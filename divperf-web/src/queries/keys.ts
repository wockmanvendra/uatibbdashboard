/**
 * Query key factory. (§8.4)
 *
 * Canonicalize filters or you will get cache misses from array ordering alone.
 */

export type Filters = {
  from: number;
  to: number;
  division: string[];
  brand: string[];
  zone: string[];
  region: string[];
  hq: string[];
};

export const canon = (f: Filters) => ({
  from: f.from,
  to: f.to,
  division: [...f.division].sort().join(','),
  brand: [...f.brand].sort().join(','),
  zone: [...f.zone].sort().join(','),
  region: [...f.region].sort().join(','),
  hq: [...f.hq].sort().join(','),
});

export type CanonFilters = ReturnType<typeof canon>;

export const dashKeys = {
  all: ['dash'] as const,
  /**
   * `scopeId` is in the key for the same reason as invariant I6 — without it,
   * switching users in the same browser session serves the previous user's
   * numbers straight from the client cache.
   */
  tab: (tab: string, scopeId: string, f: Filters) =>
    ['dash', tab, scopeId, canon(f)] as const,
};

export const metaKeys = {
  version: ['dataVersion'] as const,
  filters: (scopeId: string, sel: { division: string[]; zone: string[]; region: string[] }) =>
    [
      'filters',
      scopeId,
      [...sel.division].sort().join(','),
      [...sel.zone].sort().join(','),
      [...sel.region].sort().join(','),
    ] as const,
};
