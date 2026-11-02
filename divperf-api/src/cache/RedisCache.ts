import Redis from 'ioredis';
import type { CacheClient } from './CacheClient.js';

/**
 * Phase 3 cache. The only file in the codebase that imports ioredis. (§7.3)
 */
export class RedisCache implements CacheClient {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, {
      // Warm the connection before the first request rather than paying for it
      // on a user's cold load. (§7.8)
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A poisoned entry must not take down a request. Drop it and miss.
      await this.redis.del(key);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  /**
   * SCAN rather than KEYS: KEYS blocks the server for the whole keyspace scan,
   * which on a shared cache is a production incident.
   */
  async keysByPrefix(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      out.push(...keys);
    } while (cursor !== '0');
    return out;
  }

  async delByPrefix(prefix: string): Promise<void> {
    const keys = await this.keysByPrefix(prefix);
    for (let i = 0; i < keys.length; i += 500) await this.redis.unlink(...keys.slice(i, i + 500));
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
