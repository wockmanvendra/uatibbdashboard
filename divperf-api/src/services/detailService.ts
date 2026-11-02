/**
 * The detail lists behind clickable figures (GET /api/details/:list).
 *
 * Narrows the request to the user's scope exactly as a tab does (applyScope),
 * then reads the list's source — or, with USE_MOCK_DATA, generated rows. Not
 * cached: lists are paged and searched, and read only when the panel opens.
 */
import type { Scope } from '../plugins/scope.js';
import type { DetailListId, DetailListResponse, YrMn } from '../types/api.js';
import { config } from '../config.js';
import { getDb } from '../data/db.js';
import { DETAIL_LISTS } from '../data/details/index.js';
import type { DetailListDef, DetailRequest, DetailResult, DetailRow } from '../data/details/types.js';
import type { PanelFilters } from '../data/queryBuilder.js';
import { applyScope } from './tabService.js';
import { HQS } from './mockData.js';
import { monthRange } from '../lib/yrmn.js';

export interface DetailFilters {
  from: YrMn;
  to: YrMn;
  division: string[];
  brand: string[];
  zone: string[];
  region: string[];
  hq: string[];
}

export async function getDetailList(
  list: DetailListId,
  req: DetailFilters,
  options: DetailRequest,
  scope: Scope,
): Promise<DetailListResponse> {
  const def = DETAIL_LISTS[list];
  const filters = applyScope(req, scope);
  const result = config.USE_MOCK_DATA
    ? mockList(def, filters, options)
    : await def.fetch(getDb(), scope, filters, options);

  return {
    title: def.title,
    columns: def.columns,
    facets: def.facets(filters),
    rows: result.rows,
    total: result.total,
    page: options.page,
    pageSize: options.pageSize,
    ...(result.note ? { note: result.note } : {}),
    ...(result.unavailable ? { unavailable: result.unavailable } : {}),
  };
}

/**
 * A small generated list: four rows per HQ for each month, each column filled
 * by its format. Facets filter on the column of the same key; search matches
 * any text column. Enough to exercise the panel and the route.
 */
function mockList(def: DetailListDef, f: PanelFilters, { page, pageSize, search, facets }: DetailRequest): DetailResult {
  const all: DetailRow[] = [];
  for (const month of monthRange(f.from, f.to)) {
    HQS.slice(0, 6).forEach((hq, h) => {
      for (let i = 0; i < 4; i++) {
        const row: DetailRow = {};
        for (const c of def.columns) {
          row[c.key] =
            c.format === 'month' ? month
            : c.format === 'date' ? `${month}${String(10 + i).padStart(2, '0')}`
            : c.format === 'text' ? `${c.label} ${h * 4 + i + 1}`
            : c.format === 'percent' ? 60 + i * 10
            : c.format === 'money' ? (h + 1) * 100_000
            : i + h;
        }
        if ('hq' in row) row.hq = hq.name;
        if ('category' in row) row.category = ['A', 'B', 'C', 'B'][i]!;
        if ('status' in row) row.status = 'missed';
        if ('cadre' in row) row.cadre = ['TM', 'RM', 'ZSM', 'TM'][i]!;
        all.push(row);
      }
    });
  }
  const term = search?.trim().toLowerCase();
  const rows = all.filter(
    (r) =>
      (!term || Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(term))) &&
      Object.entries(facets).every(([k, v]) => v === 'all' || !(k in r) || String(r[k]) === v || (k === 'cadre' && v === 'ZM' && r[k] === 'ZSM')),
  );
  return { total: rows.length, rows: rows.slice((page - 1) * pageSize, page * pageSize) };
}
