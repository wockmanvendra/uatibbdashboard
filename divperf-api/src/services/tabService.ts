/**
 * Tab orchestration. (§7.3)
 *
 * Reads the tab config, fires the panel queries, assembles the response, and
 * handles caching. It does not compute measures — per I3 all aggregation is in
 * SQL (Phase 2+) or in the mock generator (Phase 1). This layer shapes and
 * serialises.
 *
 * Caching — serve at once, rebuild when the data changes:
 *   - Each view (scope × tab × filters) is cached with the data version it
 *     was built on. A view on the current version is served as is.
 *   - A view on an older version (the source has been reloaded) is still
 *     served at once, marked `refreshing`, and rebuilt in the background.
 *   - A view never built is built now — the one slow load.
 *   - Identical concurrent builds share one warehouse round trip.
 *   - Every request is noted as a recently used view, which the cache warmer
 *     rebuilds after a data change (services/cacheWarmer.ts).
 */
import type { FastifyBaseLogger } from 'fastify';
import type { TabResponse, YrMn } from '../types/api.js';
import type { CacheClient } from '../cache/CacheClient.js';
import { VIEW_TTL } from '../cache/CacheClient.js';
import { hotKey, viewKey, type CanonicalFilters } from '../cache/key.js';
import type { Scope } from '../plugins/scope.js';
import { intersectScope, permittedFor } from '../plugins/scope.js';
import { getTab, type TabConfig } from '../tabs/registry.js';
import { notFound } from '../lib/errors.js';
import { createLimiter } from '../lib/limit.js';
import { config } from '../config.js';
import { buildMockTab, type MockFilters } from './mockData.js';
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

/** A cached view: the response and the data version it was built on. */
export interface ViewEntry {
  version: string;
  data: TabResponse;
}

/** What the warmer needs to rebuild a recently used view without its user. */
export interface HotView {
  tab: string;
  filters: CanonicalFilters;
  scope: Scope;
  lastAt: number;
}

const SLOW_QUERY_MS = 200;
/** A recently used view is remembered this long — longer than WARM_HOT_HOURS. */
const HOT_TTL = 60 * 60 * 48;

/** Builds in progress, by view key: concurrent identical requests share one. */
const building = new Map<string, Promise<ViewEntry>>();
/** Background rebuilds of stale views, a few at a time. */
const background = createLimiter(config.WARM_CONCURRENCY);

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
  const filters = canonical(applyScope(req, scope));

  // scopeHash is positional and required — a key cannot be built without it. (I6)
  const key = viewKey(scope.hash, tab.id, filters);
  const hot: HotView = { tab: tab.id, filters, scope, lastAt: Date.now() };
  void cache.set(hotKey(key), hot, HOT_TTL).catch(() => {});

  const [entry, version] = await Promise.all([cache.get<ViewEntry>(key), getDataVersion()]);
  if (entry) {
    const current = entry.version === version.dataVersion;
    if (!current && !building.has(key)) {
      // The source changed: serve the previous figures now, rebuild behind them.
      void background.run(() => buildView(tab, scope, filters, cache, log)).catch((err) =>
        log.warn({ err, tab: tab.id }, 'background view rebuild failed'),
      );
    }
    return { ...entry.data, meta: { ...entry.data.meta, cached: true, refreshing: !current } };
  }

  const built = await buildView(tab, scope, filters, cache, log);
  return { ...built.data, meta: { ...built.data.meta, cached: false, refreshing: false } };
}

/**
 * Reads a view from the warehouse and caches it. Shared by requests and the
 * cache warmer; a build already running for the same view is joined, not
 * repeated.
 */
export function buildView(
  tab: TabConfig,
  scope: Scope,
  filters: CanonicalFilters,
  cache: CacheClient,
  log: FastifyBaseLogger,
): Promise<ViewEntry> {
  const key = viewKey(scope.hash, tab.id, filters);
  const running = building.get(key);
  if (running) return running;

  const job = (async () => {
    // The version is read before the data, so a reload during the build marks
    // the entry old rather than passing new-looking figures off as current.
    const version = await getDataVersion();
    const started = performance.now();
    const data = await loadTab(tab, scope, filters);
    const queryMs = Math.round((performance.now() - started) * 100) / 100;

    data.meta.queryMs = queryMs;
    data.meta.effectiveScope = { level: scope.level, nodes: scope.nodes };

    if (queryMs > SLOW_QUERY_MS) {
      log.warn({ tab: tab.id, queryMs, filters }, 'slow tab query');
    }

    const entry: ViewEntry = { version: version.dataVersion, data };
    await cache.set(key, entry, VIEW_TTL);
    return entry;
  })().finally(() => building.delete(key));

  building.set(key, job);
  return job;
}

/** The data version a view is cached on, if it is cached — the warmer skips current ones. */
export async function cachedVersion(
  cache: CacheClient,
  scope: Scope,
  tab: string,
  filters: CanonicalFilters,
): Promise<string | null> {
  return (await cache.get<ViewEntry>(viewKey(scope.hash, tab, filters)))?.version ?? null;
}

/** The canonical filter set of a scoped request: what view keys are built from. */
export function canonical(f: Omit<TabRequest, 'tab'>): CanonicalFilters {
  return {
    from: f.from,
    to: f.to,
    division: f.division,
    brand: f.brand,
    zone: f.zone,
    region: f.region,
    hq: f.hq,
  };
}

export function applyScope<R extends Omit<TabRequest, 'tab'>>(req: R, scope: Scope): R {
  let out = req;
  // The scope's own level, and the user's divisions beside it.
  for (const key of ['division', 'zone', 'region', 'hq'] as const) {
    const permitted = permittedFor(key, scope);
    if (permitted === null) continue;
    const narrowed = intersectScope(out[key], permitted);
    // Asking only for nodes outside scope yields the user's own scope. Never pass
    // an empty list on: every loader reads [] as "no filter", i.e. everything.
    out = { ...out, [key]: narrowed.length ? narrowed : permitted };
  }
  return out;
}

/** The one place that decides mock vs real. */
async function loadTab(tab: TabConfig, scope: Scope, filters: CanonicalFilters): Promise<TabResponse> {
  if (config.USE_MOCK_DATA) {
    return buildMockTab(tab.id, filters as MockFilters);
  }
  return buildLiveTab(tab, getDb(), scope, filters, await getDataVersion());
}
