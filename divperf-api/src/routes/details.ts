/**
 * GET /api/details/:list  — the rows behind a clickable figure
 *
 * :list is doctors | leavers | joiners | tm-effort | hq-headcount | hospitals. The
 * dashboard's filters and period, plus:
 *   page, pageSize   one page (pageSize up to 500)
 *   all=true         the whole list, up to 50,000 rows — the CSV export
 *   search           free text, matched by each list against its own columns
 *   status, category, cadre, tenure, month, tm, vacancy
 *                    facet values — each list reads the ones it offers
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDetailList } from '../services/detailService.js';
import { isDetailListId } from '../data/details/index.js';
import { badRequest } from '../lib/errors.js';
import { checkPeriod, filterQuery, parseQuery } from './params.js';

const EXPORT_LIMIT = 50_000;
const FACETS = ['status', 'category', 'cadre', 'tenure', 'month', 'tm', 'vacancy', 'tier'] as const;

const facet = z.string().trim().max(40).regex(/^[A-Za-z0-9 _+-]*$/).optional();

const detailQuery = filterQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  all: z.enum(['true', 'false']).optional(),
  search: z.string().max(80).optional(),
  ...Object.fromEntries(FACETS.map((k) => [k, facet])),
});

export const detailRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/details/:list', async (req, reply) => {
    const { list } = req.params as { list: string };
    if (!isDetailListId(list)) throw badRequest(`Unknown list "${list}".`);

    const q = parseQuery(detailQuery, req.query) as z.infer<typeof filterQuery> & {
      page: number; pageSize: number; all?: string; search?: string;
    } & Partial<Record<(typeof FACETS)[number], string>>;
    checkPeriod(q);

    const all = q.all === 'true';
    const facets: Record<string, string> = {};
    for (const k of FACETS) if (q[k]) facets[k] = q[k]!;

    const data = await getDetailList(
      list,
      { from: q.from, to: q.to, division: q.division, brand: q.brand, zone: q.zone, region: q.region, hq: q.hq },
      { page: all ? 1 : q.page, pageSize: all ? EXPORT_LIMIT : q.pageSize, search: q.search, facets },
      req.scope,
    );
    reply.header('cache-control', 'private, no-cache');
    return data;
  });
};
