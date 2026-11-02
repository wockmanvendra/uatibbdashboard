import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { MemoryCache } from '../cache/MemoryCache.js';
import { hotKey, hotPrefix, viewKey } from '../cache/key.js';
import { makeScope } from '../plugins/scope.js';
import type { HotView } from './tabService.js';

// The data version, under the test's control.
let version = 'v1';
vi.mock('./versionService.js', () => ({
  getDataVersion: async () => ({
    dataVersion: version, openYrMn: 202610, updatedAt: '', salesFrom: 202604, salesTo: 202610,
    rxFrom: null, rxTo: null, effortFrom: null, effortTo: null,
  }),
}));

// Count warehouse reads: every build goes through buildMockTab in mock mode.
const builds = vi.fn();
vi.mock('./mockData.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./mockData.js')>();
  return {
    ...real,
    buildMockTab: (...args: Parameters<typeof real.buildMockTab>) => {
      builds(...args);
      return real.buildMockTab(...args);
    },
  };
});

const { getTabData } = await import('./tabService.js');

const log = { warn: () => {}, info: () => {} } as unknown as FastifyBaseLogger;
const NSM = makeScope('DIVISION', ['85'], ['85']);
const ZSM = makeScope('ZONE', ['WL'], ['85']);
const req = (over = {}) => ({
  tab: 'division-performance', from: 202604, to: 202610,
  division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('tab cache', () => {
  let cache: MemoryCache;
  beforeEach(() => {
    cache = new MemoryCache();
    builds.mockClear();
    version = 'v1';
  });

  it('builds a view once, then serves it from the cache', async () => {
    const first = await getTabData(req(), NSM, cache, log);
    const again = await getTabData(req(), NSM, cache, log);

    expect(builds).toHaveBeenCalledTimes(1);
    expect(first.meta).toMatchObject({ cached: false, refreshing: false });
    expect(again.meta).toMatchObject({ cached: true, refreshing: false, builtAt: first.meta.builtAt });
  });

  it('after a data change serves the previous figures at once and rebuilds once behind them', async () => {
    const before = await getTabData(req(), NSM, cache, log);
    version = 'v2';

    const stale = await getTabData(req(), NSM, cache, log);
    const staleAgain = await getTabData(req(), NSM, cache, log);
    expect(stale.meta).toMatchObject({ cached: true, refreshing: true, builtAt: before.meta.builtAt });
    expect(staleAgain.meta.refreshing).toBe(true);

    await settle();
    expect(builds).toHaveBeenCalledTimes(2); // the first build, and one rebuild
    const fresh = await getTabData(req(), NSM, cache, log);
    expect(fresh.meta).toMatchObject({ cached: true, refreshing: false });
    expect(fresh.meta.builtAt >= before.meta.builtAt).toBe(true);
  });

  it('shares one build between concurrent requests for the same view', async () => {
    await Promise.all([1, 2, 3, 4].map(() => getTabData(req(), NSM, cache, log)));
    expect(builds).toHaveBeenCalledTimes(1);
  });

  it('never serves one scope another scope’s view (I6)', async () => {
    await getTabData(req(), NSM, cache, log);
    const zsm = await getTabData(req(), ZSM, cache, log);
    expect(zsm.meta.cached).toBe(false);
    expect(builds).toHaveBeenCalledTimes(2);
    expect(zsm.meta.effectiveScope).toEqual({ level: 'ZONE', nodes: ['WL'] });
  });

  it('notes each request as a recently used view, with what the warmer needs to rebuild it', async () => {
    await getTabData(req({ zone: ['WL'] }), NSM, cache, log);
    await settle();
    const keys = await cache.keysByPrefix(hotPrefix());
    expect(keys).toHaveLength(1);
    const hot = (await cache.get<HotView>(keys[0]!))!;
    expect(hot).toMatchObject({ tab: 'division-performance', scope: { hash: NSM.hash } });
    expect(hot.filters).toMatchObject({ division: ['85'], zone: ['WL'] });
    expect(keys[0]).toBe(hotKey(viewKey(NSM.hash, 'division-performance', hot.filters)));
  });
});
