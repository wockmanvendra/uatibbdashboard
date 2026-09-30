/**
 * GET /api/dashboard/:tab  (§7.5)
 *
 * Routes validate input with zod, call a service, and return. No SQL, no
 * business logic, no cache calls. (§7.3)
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getTabData } from '../services/tabService.js';
import { isTabId, tabIds } from '../tabs/registry.js';
import { badRequest } from '../lib/errors.js';
import { isValidYrMn, monthCount } from '../lib/yrmn.js';
import { getDataVersion } from '../services/versionService.js';

/** Repeated query params arrive as a string or an array of strings. */
const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return [];
    const raw = Array.isArray(v) ? v : [v];
    // Also accept a single comma-separated value, which is what a URL built by
    // hand usually looks like.
    return [...new Set(raw.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean))];
  });

const querySchema = z.object({
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  division: list,
  brand: list,
  zone: list,
  region: list,
  hq: list,
});

const MAX_MONTHS = 36;

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/dashboard/:tab', async (req, reply) => {
    const { tab } = req.params as { tab: string };
    if (!isTabId(tab)) {
      throw badRequest(
        `Unknown tab "${tab}". Available tabs: ${tabIds().join(', ')}.`,
      );
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw badRequest(
        `Invalid ${first?.path.join('.') ?? 'request'}: ${first?.message ?? 'check the parameters'}.`,
      );
    }
    const q = parsed.data;

    if (!isValidYrMn(q.from) || !isValidYrMn(q.to)) {
      throw badRequest('Period must be a month key such as 202608 (YYYYMM).');
    }
    if (q.to < q.from) {
      throw badRequest('Period "to" cannot be earlier than "from".');
    }
    const span = monthCount(q.from, q.to);
    if (span > MAX_MONTHS) {
      throw badRequest(`Period is ${span} months. Select ${MAX_MONTHS} months or fewer.`);
    }

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
