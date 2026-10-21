/**
 * GET /api/dashboard/:tab  (§7.5)
 *
 * Routes validate input with zod, call a service, and return. No SQL, no
 * business logic, no cache calls. (§7.3)
 */
import type { FastifyPluginAsync } from 'fastify';
import { getTabData } from '../services/tabService.js';
import { isTabId, tabIds } from '../tabs/registry.js';
import { badRequest } from '../lib/errors.js';
import { getDataVersion } from '../services/versionService.js';
import { checkPeriod, filterQuery, parseQuery } from './params.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/dashboard/:tab', async (req, reply) => {
    const { tab } = req.params as { tab: string };
    if (!isTabId(tab)) {
      throw badRequest(
        `Unknown tab "${tab}". Available tabs: ${tabIds().join(', ')}.`,
      );
    }

    const q = parseQuery(filterQuery, req.query);
    checkPeriod(q);

    const data = await getTabData({ tab, ...q }, req.scope, app.cache, req.log);

    // Closed ranges are immutable, so let the browser hold them. (I7)
    const { openYrMn } = await getDataVersion();
    reply.header(
      'cache-control',
      data.meta.to < openYrMn ? 'private, max-age=3600' : 'private, max-age=60',
    );
    return data;
  });
};
