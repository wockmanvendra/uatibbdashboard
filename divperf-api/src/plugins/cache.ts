import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config.js';
import type { CacheClient } from '../cache/CacheClient.js';
import { MemoryCache } from '../cache/MemoryCache.js';
import { NoCache } from '../cache/NoCache.js';

declare module 'fastify' {
  interface FastifyInstance {
    cache: CacheClient;
  }
}

/**
 * Registers the cache on the fastify instance. Selecting the driver is the only
 * thing that changes between Phase 2 and Phase 3 — nothing outside src/cache/
 * knows which implementation is in use. (§7.3)
 */
const plugin: FastifyPluginAsync = async (app) => {
  let client: CacheClient;

  if (config.CACHE_DRIVER === 'none') {
    client = new NoCache();
    app.log.warn('cache driver: none — every request reads the warehouse directly.');
  } else if (config.CACHE_DRIVER === 'redis') {
    // Phase 3. Imported lazily so ioredis is not loaded when unused.
    const { RedisCache } = await import('../cache/RedisCache.js');
    client = new RedisCache(config.REDIS_URL!);
    app.log.info('cache driver: redis');
  } else {
    client = new MemoryCache();
    app.log.warn(
      'cache driver: memory — correct for a single instance only. ' +
        'Switch to redis before running more than one instance (I10).',
    );
  }

  app.decorate('cache', client);
  app.addHook('onClose', async () => {
    await client.close();
  });
};

export const cachePlugin = fp(plugin, { name: 'cache' });
