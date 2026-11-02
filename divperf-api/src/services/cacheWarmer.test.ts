import { describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { MemoryCache } from '../cache/MemoryCache.js';
import { hotKey, viewKey, warmLockKey, type CanonicalFilters } from '../cache/key.js';
import { makeScope, type Scope } from '../plugins/scope.js';
import { TABS } from '../tabs/registry.js';
import type { DataVersion } from './versionService.js';
import type { HotView } from './tabService.js';
import { createWarmer, type WarmerDeps } from './cacheWarmer.js';

const log = { warn: () => {}, info: () => {} } as unknown as FastifyBaseLogger;
const NSM = makeScope('DIVISION', ['85'], ['85']);
const TM = makeScope('HQ', ['WTKANN'], ['85']);
const ver = (dataVersion: string): DataVersion => ({
  dataVersion, openYrMn: 202610, updatedAt: '', salesFrom: 202604, salesTo: 202610,
  rxFrom: null, rxTo: null, effortFrom: null, effortTo: null,
});
const F = (over: Partial<CanonicalFilters> = {}): CanonicalFilters => ({
  from: 202604, to: 202610, division: ['85'], brand: [], zone: [], region: [], hq: [], ...over,
});

function setup(over: Partial<WarmerDeps> = {}) {
  const cache = new MemoryCache();
  const state = { version: 'v1', built: [] as string[], inFlight: 0, maxInFlight: 0, onBuild: () => {} };
  const cached = new Map<string, string>();
  const deps: WarmerDeps = {
    cache,
    log,
    refreshVersion: async () => ver(state.version),
    currentVersion: async () => ver(state.version),
    seniorScopes: async () => [NSM],
    build: async (tab, scope, filters) => {
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((r) => setTimeout(r, 2));
      state.onBuild();
      state.built.push(`${scope.scopeId}/${tab.id}/${filters.from}-${filters.to}/${filters.hq.join(',')}`);
      cached.set(viewKey(scope.hash, tab.id, filters), state.version);
      state.inFlight--;
    },
    cachedVersion: async (scope, tab, filters) => cached.get(viewKey(scope.hash, tab, filters)) ?? null,
    concurrency: 2,
    maxViews: 10,
    hotHours: 24,
    lockSeconds: 600,
    now: () => 1_000_000_000,
    ...over,
  };
  const hot = (scope: Scope, tab: string, filters: CanonicalFilters, lastAt: number) =>
    cache.set(hotKey(viewKey(scope.hash, tab, filters)), { tab, scope, filters, lastAt } satisfies HotView, 3600);
  return { cache, state, deps, hot, warmer: createWarmer(deps) };
}

describe('cache warmer', () => {
  it('at startup builds the senior defaults on the fiscal year to date, then recent views by recency', async () => {
    const { state, hot, warmer } = setup();
    await hot(TM, 'hq-performance', F({ hq: ['WTKANN'] }), 1_000_000_000 - 1000); // newer
    await hot(TM, 'zone-performance', F({ hq: ['WTKANN'], to: 202609 }), 1_000_000_000 - 5000);
    await hot(TM, 'hq-performance', F({ hq: ['OLD'] }), 1_000_000_000 - 30 * 3_600_000); // too old

    const result = await warmer.tick();

    expect(result).toMatchObject({ version: 'v1', built: TABS.length + 2, failed: 0, stopped: false });
    // Seniors first: every tab, Apr-26 – Oct-26, no filters beyond the scope.
    expect(state.built.slice(0, TABS.length).every((b) => b.startsWith(`${NSM.scopeId}/`) && b.includes('202604-202610'))).toBe(true);
    expect(state.built.slice(TABS.length)).toEqual([
      `${TM.scopeId}/hq-performance/202604-202610/WTKANN`,
      `${TM.scopeId}/zone-performance/202604-202609/WTKANN`,
    ]);
    expect(state.maxInFlight).toBeLessThanOrEqual(2);
  });

  it('does nothing while the data is unchanged, and rebuilds after a change', async () => {
    const { state, warmer } = setup();
    await warmer.tick();
    const first = state.built.length;

    expect(await warmer.tick()).toBeNull();
    expect(state.built).toHaveLength(first);

    state.version = 'v2';
    expect(await warmer.tick()).toMatchObject({ version: 'v2', built: first });
  });

  it('skips views a user already rebuilt on the new version', async () => {
    const { warmer } = setup({ cachedVersion: async () => 'v1' });
    expect(await warmer.tick()).toMatchObject({ built: 0, skipped: TABS.length });
  });

  it('stops when a newer version arrives mid-run, and starts over at the next check', async () => {
    const { state, warmer } = setup({ concurrency: 1 });
    state.onBuild = () => {
      if (state.built.length === 0) state.version = 'v2';
    };
    const stopped = await warmer.tick();
    expect(stopped).toMatchObject({ stopped: true, built: 1 });

    state.onBuild = () => {};
    expect(await warmer.tick()).toMatchObject({ version: 'v2', stopped: false });
  });

  it('leaves the warming to the process holding the lock', async () => {
    const { cache, state, warmer } = setup();
    await cache.setIfAbsent(warmLockKey(), { at: 1 }, 600);
    expect(await warmer.tick()).toBeNull();
    expect(state.built).toHaveLength(0);
  });

  it('still warms recent views when the user list cannot be read', async () => {
    const { hot, warmer } = setup({ seniorScopes: async () => { throw new Error('db down'); } });
    await hot(TM, 'hq-performance', F({ hq: ['WTKANN'] }), 1_000_000_000);
    expect(await warmer.tick()).toMatchObject({ built: 1 });
  });
});
