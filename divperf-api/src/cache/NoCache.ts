import type { CacheClient } from './CacheClient.js';

/**
 * No caching: every request reads the warehouse. Selected by CACHE_DRIVER=none,
 * for when figures must be current to the minute — while source data is being
 * reloaded and checked. Every tab load then costs the full Synapse round trips.
 */
export class NoCache implements CacheClient {
  async get<T>(): Promise<T | null> {
    return null;
  }

  async set(): Promise<void> {}

  async setIfAbsent(): Promise<boolean> {
    return true;
  }

  async keysByPrefix(): Promise<string[]> {
    return [];
  }

  async delByPrefix(): Promise<void> {}

  async close(): Promise<void> {}
}
