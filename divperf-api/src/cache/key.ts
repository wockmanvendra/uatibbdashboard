/**
 * Cache key builders.
 *
 * Invariant I6: a cache key without a scope segment will serve national numbers
 * to an area manager. This is the highest-severity bug available in this
 * codebase, so `scopeHash` is the FIRST POSITIONAL ARGUMENT of every builder —
 * it is impossible to construct a key without one, and impossible to forget it
 * in an options object.
 *
 * Acceptance check (§11): grep for `dash:v1:` and confirm every producer is in
 * this file.
 */

/** Bump to invalidate everything on deploy. (§7.4) */
export const CACHE_NS = 'dash:v1';

export interface CanonicalFilters {
  from: number;
  to: number;
  division: string[];
  brand: string[];
  zone: string[];
  region: string[];
  hq: string[];
}

/**
 * Sort and join so that ['a','b'] and ['b','a'] produce the same key.
 * Array ordering alone is enough to halve a cache hit rate.
 */
export function canonToString(f: CanonicalFilters): string {
  const part = (xs: string[]) => [...xs].sort().join(',');
  return [
    f.from,
    f.to,
    part(f.division),
    part(f.brand),
    part(f.zone),
    part(f.region),
    part(f.hq),
  ].join('|');
}

export function tabKey(scopeHash: string, tab: string, filters: CanonicalFilters): string {
  assertScope(scopeHash);
  return `${CACHE_NS}:${scopeHash}:tab:${tab}:${canonToString(filters)}`;
}

export function filtersKey(
  scopeHash: string,
  selected: Pick<CanonicalFilters, 'division' | 'zone' | 'region'>,
): string {
  assertScope(scopeHash);
  const part = (xs: string[]) => [...xs].sort().join(',');
  return `${CACHE_NS}:${scopeHash}:filters:${part(selected.division)}|${part(selected.zone)}|${part(selected.region)}`;
}

/** The version token is scope-independent — it is the same for everyone. */
export const versionKey = (): string => `${CACHE_NS}:meta:version`;

/** Everything the load pipeline flushes on completion. */
export const flushPrefix = (): string => `${CACHE_NS}:`;

function assertScope(scopeHash: string): void {
  if (!scopeHash || scopeHash.includes(':')) {
    throw new Error(
      `Refusing to build a cache key with an invalid scope segment (${JSON.stringify(scopeHash)}). See invariant I6.`,
    );
  }
}
