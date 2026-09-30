/**
 * Tab orchestration. (§7.3)
 *
 * Reads the tab config, fires the panel queries, assembles the response, and
 * handles caching. It does not compute measures — per I3 all aggregation is in
 * SQL (Phase 2+) or in the mock generator (Phase 1). This layer shapes and
 * serialises.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { TabResponse, YrMn } from '../types/api.js';
import type { CacheClient } from '../cache/CacheClient.js';
import { ttlFor } from '../cache/CacheClient.js';
import { tabKey, type CanonicalFilters } from '../cache/key.js';
import type { Scope } from '../plugins/scope.js';
import { intersectScope } from '../plugins/scope.js';
import { getTab, type TabConfig } from '../tabs/registry.js';
import { notFound } from '../lib/errors.js';
import { config } from '../config.js';
import { buildMockTab, OPEN_YR_MN, type MockFilters } from './mockData.js';
import { getDb } from '../data/db.js';
import { buildLiveTab } from './liveData.js';
import { getDataVersion } from './versionService.js';

export interface TabRequest {
  tab: string;
  from: YrMn;
  to: YrMn;
  division: string[];
  brand: string[];
  zone: string[];
  region: string[];
  hq: string[];
}

const SLOW_QUERY_MS = 200;

export async function getTabData(
  req: TabRequest,
  scope: Scope,
  cache: CacheClient,
  log: FastifyBaseLogger,
): Promise<TabResponse> {
  const tab = getTab(req.tab);
  if (!tab) {
    throw notFound(`Unknown tab "${req.tab}". Check the URL and try again.`);
  }

  // Narrow every requested node set to what the user may see, before anything
  // is read and before the cache key is built. A request cannot widen its own
  // scope. (I5, §6.2)
  const scoped = applyScope(req, scope);

  const filters: CanonicalFilters = {
    from: scoped.from,
    to: scoped.to,
    division: scoped.division,
    brand: scoped.brand,
    zone: scoped.zone,
    region: scoped.region,
    hq: scoped.hq,
  };

  // scopeHash is positional and required — a key cannot be built without it. (I6)
  const key = tabKey(scope.hash, tab.id, filters);

  const cached = await cache.get<TabResponse>(key);
  if (cached) {
    return { ...cached, meta: { ...cached.meta, cached: true } };
  }

  const started = performance.now();
  const data = await loadTab(tab, scope, scoped);
  const queryMs = Math.round((performance.now() - started) * 100) / 100;

  data.meta.cached = false;
  data.meta.queryMs = queryMs;
  data.meta.effectiveScope = { level: scope.level, nodes: scope.nodes };

  if (queryMs > SLOW_QUERY_MS) {
    log.warn({ tab: tab.id, queryMs, filters }, 'slow tab query');
  }

  const openYrMn = config.USE_MOCK_DATA ? OPEN_YR_MN : (await getDataVersion()).openYrMn;
  await cache.set(key, data, ttlFor(scoped.to, openYrMn));
  return data;
}

function applyScope(req: TabRequest, scope: Scope): TabRequest {
  if (scope.level === 'ALL') return req;
  const key = ({ DIVISION: 'division', ZONE: 'zone', REGION: 'region', HQ: 'hq' } as const)[
    scope.level
  ];
  const narrowed = intersectScope(req[key], scope.nodes);
  // Asking only for nodes outside scope yields the user's own scope. Never pass
  // an empty list on: every loader reads [] as "no filter", i.e. everything.
  return { ...req, [key]: narrowed.length ? narrowed : scope.nodes };
}

/** The one place that decides mock vs real. */
async function loadTab(tab: TabConfig, scope: Scope, f: TabRequest): Promise<TabResponse> {
  const filters = {
    from: f.from, to: f.to,
    division: f.division, brand: f.brand,
    zone: f.zone, region: f.region, hq: f.hq,
  };

  if (config.USE_MOCK_DATA) {
    return buildMockTab(tab.id, filters as MockFilters);
  }

  const { dataVersion, openYrMn } = await getDataVersion();
  return buildLiveTab(tab, getDb(), scope, filters, openYrMn, dataVersion);
}
