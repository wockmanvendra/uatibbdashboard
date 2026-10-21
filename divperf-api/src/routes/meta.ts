/**
 * GET /api/meta/version   — the data version token the frontend polls (§4.9)
 * GET /api/meta/filters   — cascading, scope-filtered option lists (§7.5)
 * GET /api/meta/model     — dimensions and measures (§13, keeps v2 cheap)
 * POST /api/meta/flush    — cache flush, called by the load pipeline (§4.7 step 9)
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { VersionResponse } from '../types/api.js';
import { getFilterOptions, resetFilterCache } from '../services/filterService.js';
import { getDataVersion, resetDataVersionCache } from '../services/versionService.js';
import { flushPrefix, versionKey } from '../cache/key.js';
import { badRequest } from '../lib/errors.js';
import { TABS } from '../tabs/registry.js';

const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return [];
    const raw = Array.isArray(v) ? v : [v];
    return [...new Set(raw.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean))];
  });

export const metaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/meta/version', async (_req, reply) => {
    const cached = await app.cache.get<VersionResponse>(versionKey());
    if (cached) {
      reply.header('cache-control', 'no-cache');
      return cached;
    }
    const { dataVersion, openYrMn, updatedAt } = await getDataVersion();
    const body: VersionResponse = { dataVersion, openYrMn, updatedAt };
    await app.cache.set(versionKey(), body, 60);
    reply.header('cache-control', 'no-cache');
    return body;
  });

  app.get('/api/meta/filters', async (req) => {
    const schema = z.object({ division: list, zone: list, region: list });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid filter selection.');
    return getFilterOptions(parsed.data, req.scope);
  });

  /**
   * Metadata for the deferred chart builder. Exposed from the start so the
   * builder is mostly UI when it arrives, and so dimension/measure ids can be
   * strictly whitelisted against it — user input never reaches SQL. (§13)
   */
  app.get('/api/meta/model', async () => ({
    dimensions: [
      { id: 'division', label: 'Division', table: 'dim_division' },
      { id: 'brand', label: 'Brand', table: 'dim_brand' },
      { id: 'zone', label: 'Zone', table: 'dim_geo' },
      { id: 'region', label: 'Region', table: 'dim_geo' },
      { id: 'hq', label: 'HQ', table: 'dim_geo' },
      { id: 'month', label: 'Month', table: 'dim_date' },
    ],
    measures: [
      { id: 'budget', label: 'Target', agg: 'sum', format: 'currency' },
      { id: 'net_sales', label: 'Dispatch', agg: 'sum', format: 'currency' },
      { id: 'collection', label: 'Collection', agg: 'sum', format: 'currency' },
      { id: 'cr_notes', label: 'Credit note', agg: 'sum', format: 'currency' },
      // Balances: a period's value is its closing (last month's), never a sum.
      { id: 'os', label: 'Outstanding', agg: 'closing', format: 'currency' },
      { id: 'inventory', label: 'Inventory', agg: 'closing', format: 'currency' },
      { id: 'ach_pct', label: 'Ach%', agg: 'derived', format: 'percent' },
      { id: 'gr_pct', label: 'Gr%', agg: 'derived', format: 'percent' },
      { id: 'pcpm', label: 'PCPM', agg: 'derived', format: 'currency' },
      { id: 'cn_pct', label: 'CN%', agg: 'derived', format: 'percent' },
    ],
    tabs: TABS.map((t) => ({ id: t.id, label: t.label, grain: t.grain, panels: t.panels })),
  }));

  /** Called at the end of the load pipeline so the response cache reloads. */
  app.post('/api/meta/flush', async (req) => {
    await app.cache.delByPrefix(flushPrefix());
    // The in-process caches must go too, or the flush appears to do nothing
    // for up to ten minutes while stale filter options are still served.
    resetDataVersionCache();
    resetFilterCache();
    req.log.info('cache flushed');
    return { flushed: true, prefix: flushPrefix() };
  });
};
