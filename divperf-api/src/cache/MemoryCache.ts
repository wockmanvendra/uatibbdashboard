import { LRUCache } from 'lru-cache';
import type { CacheClient } from './CacheClient.js';

/**
 * Phase 2 cache. Correct for a single instance only — once more than one App
 * Service instance is running, in-process caches diverge and users see
 * different numbers depending on which instance answered. Swap for RedisCache
 * at Phase 3. (I10)
 */
export class MemoryCache implements CacheClient {
  private readonly lru: LRUCache<string, { v: unknown; exp: number }>;

  constructor(max = 2000) {
    this.lru = new LRUCache({ max });
  }

  async get<T>(key: string): Promise<T | null> {
    const hit = this.lru.get(key);
    if (!hit) return null;
    if (hit.exp <= Date.now()) {
      this.lru.delete(key);
      return null;
    }
    return hit.v as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.lru.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const k of [...this.lru.keys()]) {
      if (k.startsWith(prefix)) this.lru.delete(k);
    }
  }

  async close(): Promise<void> {
    this.lru.clear();
  }
}
