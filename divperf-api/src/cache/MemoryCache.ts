import { LRUCache } from 'lru-cache';
import type { CacheClient } from './CacheClient.js';

/**
 * The cache inside the API process. Right for a single instance — the
 * deployments run one — and emptied by a restart, after which the warmer
 * rebuilds the senior users' views. With more than one instance, each would
 * hold its own copy: switch to RedisCache then. (I10)
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

  async setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    if ((await this.get(key)) !== null) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async keysByPrefix(prefix: string): Promise<string[]> {
    const now = Date.now();
    const out: string[] = [];
    // peek: listing must not count as use, or the LRU order means nothing.
    for (const k of this.lru.keys()) {
      if (k.startsWith(prefix) && (this.lru.peek(k)?.exp ?? 0) > now) out.push(k);
    }
    return out;
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
