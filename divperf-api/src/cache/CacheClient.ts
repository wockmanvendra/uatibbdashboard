/**
 * The only cache surface the rest of the app knows about. (§7.4)
 * Nothing outside src/cache/ imports ioredis or lru-cache.
 */
export interface CacheClient {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delByPrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

/** Closed months are immutable, so they cache indefinitely. (I7) */
export const CLOSED_MONTH_TTL = 60 * 60 * 24 * 7; // 7 days
export const OPEN_MONTH_TTL = 60 * 5; // 5 minutes

/**
 * TTL for a response whose range ends at `toYrMn`.
 * A range ending in a closed month cannot change; anything touching the open
 * month needs freshness.
 */
export function ttlFor(toYrMn: number, openYrMn: number): number {
  return toYrMn < openYrMn ? CLOSED_MONTH_TTL : OPEN_MONTH_TTL;
}
