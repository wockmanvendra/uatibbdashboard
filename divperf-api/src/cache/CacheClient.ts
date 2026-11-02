/**
 * The only cache surface the rest of the app knows about. (§7.4)
 * Nothing outside src/cache/ imports ioredis or lru-cache.
 */
export interface CacheClient {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  /** Sets only when the key is absent; true when it was set. A lock. */
  setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean>;
  /** Every live key starting with `prefix`. */
  keysByPrefix(prefix: string): Promise<string[]>;
  delByPrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * A cached view's lifetime. Views are kept until the data changes — the
 * version check replaces them — so this only clears out views nobody opens.
 */
export const VIEW_TTL = 60 * 60 * 24 * 7; // 7 days
