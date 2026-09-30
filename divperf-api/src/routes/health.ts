import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  /** Liveness. Must not touch the database — it answers while the DB is down. */
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  /**
   * Readiness, and the warmup target. App Service pings this on start so the
   * first real user does not pay for the cold connection. (§7.8)
   */
  app.get('/ready', async () => ({
    status: 'ready',
    mode: config.USE_MOCK_DATA ? 'mock' : config.DATA_SOURCE,
    cacheDriver: config.CACHE_DRIVER,
  }));
};
