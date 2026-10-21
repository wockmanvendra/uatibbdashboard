/**
 * GET /api/effort/missed-doctors  — the doctors behind "Drs Missed"
 *
 * The dashboard's filters and period, plus:
 *   page, pageSize   one page of the list (pageSize up to 500)
 *   all=true         the whole list, up to 50,000 rows — the CSV export
 *   search           doctor name or code, HQ, TM or speciality
 *   category         A, B, C, … (repeatable)
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getMissedDoctors } from '../services/missedDoctorsService.js';
import { checkPeriod, filterQuery, list, parseQuery } from './params.js';

const EXPORT_LIMIT = 50_000;

const missedQuery = filterQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  all: z.enum(['true', 'false']).optional(),
  search: z.string().max(80).optional(),
  category: list,
});

export const effortRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/effort/missed-doctors', async (req, reply) => {
    const q = parseQuery(missedQuery, req.query);
    checkPeriod(q);

    const all = q.all === 'true';
    const data = await getMissedDoctors(
      { from: q.from, to: q.to, division: q.division, brand: q.brand, zone: q.zone, region: q.region, hq: q.hq },
      {
        page: all ? 1 : q.page,
        pageSize: all ? EXPORT_LIMIT : q.pageSize,
        search: q.search,
        categories: q.category,
      },
      req.scope,
    );
    reply.header('cache-control', 'private, no-cache');
    return data;
  });
};
