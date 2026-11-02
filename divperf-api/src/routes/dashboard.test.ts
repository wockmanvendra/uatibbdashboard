import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { installFakeCentral, MOBILE, tokenFor } from '../test/central.js';
import type { ApiError, FiltersResponse, DetailListResponse, TabResponse } from '../types/api.js';

// These tests are about the data, not access: the session is an all-divisions
// user (a mobile in ALL_DIVISION_MOBILES) of the stand-in Central User Service.

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  token = tokenFor(installFakeCentral().user(MOBILE.ALL));
});
afterAll(async () => {
  await app.close();
});

const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

describe('GET /api/dashboard/:tab', () => {
  it('returns every declared panel in one response (I2)', async () => {
    const res = await get('/api/dashboard/division-performance?from=202604&to=202608');
    expect(res.statusCode).toBe(200);
    const body = res.json<TabResponse>();
    expect(Object.keys(body).sort()).toEqual(
      ['creditNote', 'effort', 'hospitals', 'inventory', 'keyBrands', 'manpower', 'meta', 'mix', 'pcpm', 'primary', 'rcpa', 'rx', 'secondary', 'trends'].sort(),
    );
  });

  it('omits panels a tab does not declare rather than sending null', async () => {
    const body = (await get('/api/dashboard/credit-note?from=202604&to=202608')).json<TabResponse>();
    expect(body.cnDetail).toBeDefined();
    expect('primary' in body).toBe(false);
    expect('keyBrands' in body).toBe(false);
  });

  it('keeps a tab payload well under the 100 KB budget (§11)', async () => {
    const res = await get('/api/dashboard/hq-performance?from=202604&to=202608');
    expect(Buffer.byteLength(res.body, 'utf8')).toBeLessThan(100_000);
  });

  it('returns no fact-level rows — the largest table is a few hundred rows (I1)', async () => {
    const body = (await get('/api/dashboard/hq-performance?from=202604&to=202608')).json<TabResponse>();
    expect(body.geoTable!.rows.length).toBeLessThan(500);
  });

  it('serves trend series as parallel arrays of primitives, not objects (§7.5)', async () => {
    const body = (await get('/api/dashboard/division-performance?from=202604&to=202608')).json<TabResponse>();
    const t = body.trends!;
    expect(t.months).toHaveLength(5);
    expect(t.disp).toHaveLength(t.months.length);
    expect(t.labels).toEqual(['Apr-26', 'May-26', 'Jun-26', 'Jul-26', 'Aug-26']);
    expect(typeof t.disp![0]).toBe('number');
  });

  it('renders Gr% as null when the prior-year window has no data', async () => {
    // 202604–202608 needs 202504–202508, which the source does not have.
    const body = (await get('/api/dashboard/division-performance?from=202604&to=202608')).json<TabResponse>();
    expect(body.meta.priorFrom).toBeNull();
    expect(body.primary!.dispatch.gr).toBeNull();
  });

  it('computes Gr% when the prior-year window does have data', async () => {
    const body = (await get('/api/dashboard/division-performance?from=202404&to=202408')).json<TabResponse>();
    expect(body.meta.priorFrom).toBe(202304);
    expect(typeof body.primary!.dispatch.gr).toBe('number');
  });

  it('returns nulls, not an error, for a range with no data', async () => {
    const res = await get('/api/dashboard/division-performance?from=202505&to=202508');
    expect(res.statusCode).toBe(200);
    const body = res.json<TabResponse>();
    expect(body.primary!.dispatch.value).toBeNull();
    expect(body.keyBrands!.rows).toEqual([]);
  });

  it('serves the Total row from the server, and it ties to the rows (I3)', async () => {
    const body = (await get('/api/dashboard/zone-performance?from=202604&to=202608')).json<TabResponse>();
    const g = body.geoTable!;
    const summed = g.rows.reduce((a, r) => a + (r[2] ?? 0), 0);
    expect(summed).toBeCloseTo(g.total[2]!, 0);
  });

  it('is order-insensitive on repeated filters (cache-key canonicalisation)', async () => {
    const a = (await get('/api/dashboard/division-performance?from=202604&to=202608&zone=JH&zone=JK')).json<TabResponse>();
    const b = (await get('/api/dashboard/division-performance?from=202604&to=202608&zone=JK&zone=JH')).json<TabResponse>();
    expect(a.primary!.dispatch.value).toBe(b.primary!.dispatch.value);
    expect(b.meta.cached).toBe(true); // the second request hit the first one's entry
  });

  it('reports cached=true on a repeat request', async () => {
    const url = '/api/dashboard/hq-performance?from=202604&to=202607';
    expect((await get(url)).json<TabResponse>().meta.cached).toBe(false);
    expect((await get(url)).json<TabResponse>().meta.cached).toBe(true);
  });
});

describe('error responses', () => {
  const cases: [string, string, number, string][] = [
    ['unknown tab', '/api/dashboard/nope?from=202604&to=202608', 400, 'BAD_REQUEST'],
    ['reversed period', '/api/dashboard/division-performance?from=202608&to=202604', 400, 'BAD_REQUEST'],
    ['malformed month', '/api/dashboard/division-performance?from=1&to=202604', 400, 'BAD_REQUEST'],
    ['range too wide', '/api/dashboard/division-performance?from=202004&to=202608', 400, 'BAD_REQUEST'],
    ['missing params', '/api/dashboard/division-performance', 400, 'BAD_REQUEST'],
  ];

  for (const [name, url, status, code] of cases) {
    it(`${name} -> ${code} in the contract's error shape`, async () => {
      const res = await get(url);
      expect(res.statusCode).toBe(status);
      const body = res.json<ApiError>();
      // Exactly { error: { code, message } } — no statusCode, no stack, no SQL.
      expect(Object.keys(body)).toEqual(['error']);
      expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toMatch(/\S/);
    });
  }

  it('never leaks SQL or a stack trace', async () => {
    const body = (await get('/api/dashboard/nope?from=202604&to=202608')).body;
    expect(body).not.toMatch(/SELECT|FROM |at .*\.ts:|node_modules/i);
  });
});

describe('meta routes', () => {
  it('serves the version token', async () => {
    const body = (await get('/api/meta/version')).json<{ openYrMn: number; dataVersion: string }>();
    expect(body.openYrMn).toBe(202608);
    expect(body.dataVersion).toBeTruthy();
  });

  it('cascades filter options down the hierarchy', async () => {
    const all = (await get('/api/meta/filters')).json<{ regions: unknown[]; hqs: unknown[] }>();
    const oneZone = (await get('/api/meta/filters?zone=JH')).json<{ regions: unknown[]; hqs: unknown[] }>();
    expect(oneZone.regions.length).toBeLessThan(all.regions.length);
    expect(oneZone.hqs.length).toBeLessThan(all.hqs.length);
  });

  it('offers only the chosen division’s brands and zones', async () => {
    const all = (await get('/api/meta/filters')).json<FiltersResponse>();
    const merind = (await get('/api/meta/filters?division=78')).json<FiltersResponse>();
    expect(merind.brands.length).toBeGreaterThan(0);
    expect(merind.brands.length).toBeLessThan(all.brands.length);
    expect(merind.brands.map((b) => b.code)).not.toContain('WOSULIN'); // a DIABETES brand
    expect(merind.zones.length).toBeLessThan(all.zones.length);
    expect(merind.zones.every((z) => z.code.startsWith('J'))).toBe(true);
  });

  it('marks the open month as not closed', async () => {
    const body = (await get('/api/meta/filters')).json<{ months: { yrMn: number; isClosed: boolean }[] }>();
    expect(body.months.find((m) => m.yrMn === 202608)?.isClosed).toBe(false);
    expect(body.months.find((m) => m.yrMn === 202607)?.isClosed).toBe(true);
  });
});

describe('health', () => {
  it('answers liveness without touching the database', async () => {
    expect((await get('/health')).statusCode).toBe(200);
    expect((await get('/ready')).statusCode).toBe(200);
  });
});

describe('GET /api/details/:list', () => {
  it('returns a page of a list with its columns, facets and total', async () => {
    const res = await get('/api/details/doctors?from=202608&to=202609&page=1&pageSize=10');
    expect(res.statusCode).toBe(200);
    const body = res.json<DetailListResponse>();
    expect(body.title).toBe('Doctors');
    expect(body.total).toBe(48); // the mock: 24 a month
    expect(body.rows).toHaveLength(10);
    expect(body.columns.map((c) => c.key)).toContain('doctor');
    expect(body.facets.map((f) => f.key)).toEqual(['status', 'category']);
  });

  it('serves every list', async () => {
    for (const list of ['leavers', 'joiners', 'tm-effort', 'hq-headcount']) {
      const res = await get(`/api/details/${list}?from=202608&to=202608`);
      expect(res.statusCode, list).toBe(200);
      expect(res.json<DetailListResponse>().rows.length, list).toBeGreaterThan(0);
    }
  });

  it('filters by a facet and the search', async () => {
    const body = (await get('/api/details/doctors?from=202608&to=202608&category=A')).json<DetailListResponse>();
    expect(body.rows.every((r) => r.category === 'A')).toBe(true);
    expect(body.total).toBe(6);
  });

  it('rejects an unknown list, a bad period, an oversized page and an odd facet value', async () => {
    expect((await get('/api/details/salaries?from=202608&to=202608')).statusCode).toBe(400);
    expect((await get('/api/details/doctors?from=202609&to=202608')).statusCode).toBe(400);
    expect((await get('/api/details/doctors?from=202608&to=202608&pageSize=5000')).statusCode).toBe(400);
    expect((await get("/api/details/doctors?from=202608&to=202608&status=x';--")).statusCode).toBe(400);
  });

  it('needs a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/details/doctors?from=202608&to=202608' });
    expect(res.statusCode).toBe(401);
  });
});
