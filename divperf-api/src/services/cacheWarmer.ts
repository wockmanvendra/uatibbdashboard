/**
 * Keeps the cached views current without users waiting for them.
 *
 * Every DATA_CHECK_MINUTES it re-reads the data fingerprint. When the version
 * differs from the one it last warmed — at startup, or after a source reload —
 * it rebuilds, WARM_CONCURRENCY at a time:
 *   1. the senior users' default views: every tab, for each NSM, ZSM and BU
 *      head, on the default period (fiscal year to date) with no filters;
 *   2. the views opened in the last WARM_HOT_HOURS, most recent first, up to
 *      WARM_MAX_VIEWS.
 * Views already on the new version are skipped. Meanwhile users are served the
 * previous figures at once (tabService). A newer version arriving mid-run stops
 * the run; the next check starts over on it.
 *
 * One process warms at a time (a cache lock), so a second instance does not
 * double the load on Synapse.
 */
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { CacheClient } from '../cache/CacheClient.js';
import { hotPrefix, viewKey, warmLockKey, type CanonicalFilters } from '../cache/key.js';
import { makeScope, scopeFor, type Scope } from '../plugins/scope.js';
import { TABS, getTab, type TabConfig } from '../tabs/registry.js';
import { createLimiter } from '../lib/limit.js';
import { defaultPeriod } from '../lib/yrmn.js';
import { config } from '../config.js';
import { listUsers } from './centralAuth.js';
import { sessionUser } from '../users/sessionUser.js';
import { getDataVersion, refreshDataVersion, type DataVersion } from './versionService.js';
import { applyScope, buildView, cachedVersion, canonical, type HotView } from './tabService.js';

export interface WarmerDeps {
  cache: CacheClient;
  log: FastifyBaseLogger;
  /** Re-reads the fingerprint now. */
  refreshVersion: () => Promise<DataVersion>;
  /** The version as currently held, without a re-read. */
  currentVersion: () => Promise<DataVersion>;
  seniorScopes: () => Promise<Scope[]>;
  build: (tab: TabConfig, scope: Scope, filters: CanonicalFilters) => Promise<unknown>;
  cachedVersion: (scope: Scope, tab: string, filters: CanonicalFilters) => Promise<string | null>;
  concurrency: number;
  maxViews: number;
  hotHours: number;
  /** How long the lock is held at most — a crashed run frees it after this. */
  lockSeconds: number;
  now?: () => number;
}

interface Task {
  key: string;
  tab: TabConfig;
  scope: Scope;
  filters: CanonicalFilters;
}

export interface WarmResult {
  version: string;
  built: number;
  skipped: number;
  failed: number;
  stopped: boolean;
}

export function createWarmer(deps: WarmerDeps) {
  const now = deps.now ?? Date.now;
  let warmedVersion: string | null = null;
  let running = false;

  /** The senior defaults first, then recent views by recency; one task per view. */
  async function plan(version: DataVersion): Promise<Task[]> {
    const tasks: Task[] = [];
    const seen = new Set<string>();
    const add = (tab: TabConfig | undefined, scope: Scope, filters: CanonicalFilters) => {
      if (!tab) return;
      const key = viewKey(scope.hash, tab.id, filters);
      if (seen.has(key)) return;
      seen.add(key);
      tasks.push({ key, tab, scope, filters });
    };

    let seniors: Scope[] = [];
    try {
      seniors = await deps.seniorScopes();
    } catch (err) {
      deps.log.warn({ err }, 'cache warmer: could not list senior users; warming recent views only');
    }
    const period = defaultPeriod(version.openYrMn);
    const none = { division: [], brand: [], zone: [], region: [], hq: [] };
    for (const scope of seniors) {
      for (const tab of TABS) add(tab, scope, canonical(applyScope({ ...period, ...none }, scope)));
    }

    const since = now() - deps.hotHours * 3_600_000;
    const keys = await deps.cache.keysByPrefix(hotPrefix());
    const hot = (await Promise.all(keys.map((k) => deps.cache.get<HotView>(k))))
      .filter((h): h is HotView => !!h && h.lastAt >= since)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, deps.maxViews);
    for (const h of hot) add(getTab(h.tab), h.scope, h.filters);
    return tasks;
  }

  /** Rebuilds what is not on `version` yet. */
  async function warm(version: DataVersion): Promise<WarmResult> {
    const result: WarmResult = { version: version.dataVersion, built: 0, skipped: 0, failed: 0, stopped: false };
    const tasks = await plan(version);
    const limiter = createLimiter(deps.concurrency);

    await Promise.all(
      tasks.map((t) =>
        limiter.run(async () => {
          if (result.stopped) return;
          // A newer version makes this run's work obsolete: stop, the next check restarts.
          if ((await deps.currentVersion()).dataVersion !== version.dataVersion) {
            result.stopped = true;
            return;
          }
          if ((await deps.cachedVersion(t.scope, t.tab.id, t.filters)) === version.dataVersion) {
            result.skipped++;
            return;
          }
          try {
            await deps.build(t.tab, t.scope, t.filters);
            result.built++;
          } catch (err) {
            result.failed++;
            deps.log.warn({ err, tab: t.tab.id, scope: t.scope.scopeId }, 'cache warmer: view build failed');
          }
        }),
      ),
    );
    return result;
  }

  /** One check: warm when the data version is not the one last warmed. */
  async function tick(): Promise<WarmResult | null> {
    if (running) return null;
    running = true;
    try {
      const version = await deps.refreshVersion();
      if (version.dataVersion === warmedVersion) return null;

      if (!(await deps.cache.setIfAbsent(warmLockKey(), { at: now() }, deps.lockSeconds))) {
        deps.log.info('cache warmer: another process is warming; skipping');
        return null;
      }
      const started = now();
      try {
        const result = await warm(version);
        if (!result.stopped) warmedVersion = version.dataVersion;
        deps.log.info({ ...result, ms: now() - started }, 'cache warmer: views rebuilt');
        return result;
      } finally {
        await deps.cache.delByPrefix(warmLockKey());
      }
    } catch (err) {
      deps.log.warn({ err }, 'cache warmer: check failed');
      return null;
    } finally {
      running = false;
    }
  }

  return { tick, warm, plan };
}

/** Senior users' scopes, one per distinct scope. */
/**
 * Senior users' scopes, one per distinct scope: NSMs, ZSMs, BU heads and
 * admins in the Central User Service, and everyone who sees all divisions.
 */
async function seniorScopes(): Promise<Scope[]> {
  const lists = await Promise.all(['nsm', 'zsm', 'bu-head', 'admin'].map(listUsers));
  const byHash = new Map<string, Scope>();
  if (config.ALL_DIVISION_MOBILES.size) {
    const all = makeScope('ALL', []);
    byHash.set(all.hash, all);
  }
  for (const u of lists.flat()) {
    try {
      const scope = scopeFor(await sessionUser(u));
      if (scope.level === 'ALL' || scope.nodes.length) byHash.set(scope.hash, scope);
    } catch {
      // An account this dashboard does not serve: nothing to warm.
    }
  }
  return [...byHash.values()];
}

/**
 * Starts the warmer for a running server: a first check shortly after start,
 * then every DATA_CHECK_MINUTES. Not started with CACHE_DRIVER=none (nothing
 * to warm) or under tests. Returns a stop function.
 */
export function startCacheWarmer(app: FastifyInstance): () => void {
  if (config.CACHE_DRIVER === 'none') return () => {};
  const interval = config.DATA_CHECK_MINUTES * 60_000;
  const warmer = createWarmer({
    cache: app.cache,
    log: app.log,
    refreshVersion: async () => (await refreshDataVersion()).version,
    currentVersion: getDataVersion,
    seniorScopes,
    build: (tab, scope, filters) => buildView(tab, scope, filters, app.cache, app.log),
    cachedVersion: (scope, tab, filters) => cachedVersion(app.cache, scope, tab, filters),
    concurrency: config.WARM_CONCURRENCY,
    maxViews: config.WARM_MAX_VIEWS,
    hotHours: config.WARM_HOT_HOURS,
    lockSeconds: Math.max(interval / 1000, 3600),
  });

  const first = setTimeout(() => void warmer.tick(), 5_000);
  const every = setInterval(() => void warmer.tick(), interval);
  first.unref();
  every.unref();
  app.log.info({ everyMinutes: config.DATA_CHECK_MINUTES }, 'cache warmer started');
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
