import { describe, expect, it } from 'vitest';
import { makeScope } from '../../plugins/scope.js';
import type { PanelFilters } from '../queryBuilder.js';
import { fetchManpower, manpowerScope } from './manpower.js';
import { buildLiveTab } from '../../services/liveData.js';
import { getTab } from '../../tabs/registry.js';
import { fakeDb } from '../../test/fakeDb.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202604, to: 202608, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const MAP = { '85': ['1000EM68'], A5: ['1000EM75'] };
const ALL = makeScope('ALL', []);
const NSM = makeScope('DIVISION', ['85']);

describe('manpowerScope', () => {
  it("counts an NSM's division through its cost centre", () => {
    expect(manpowerScope(NSM, F(), MAP)).toEqual({ ok: true, costCentres: ['1000EM68'] });
  });

  it('counts every cost centre for an all-divisions user, and the chosen divisions\' otherwise', () => {
    expect(manpowerScope(ALL, F(), MAP)).toEqual({ ok: true, costCentres: null });
    expect(manpowerScope(ALL, F({ division: ['85', 'A5'] }), MAP)).toEqual({
      ok: true, costCentres: ['1000EM68', '1000EM75'],
    });
  });

  it('refuses a division with no cost-centre mapping rather than showing it as zero', () => {
    expect(manpowerScope(ALL, F({ division: ['85', '78'] }), MAP)).toEqual({
      ok: false, why: 'unmapped', divisions: ['78'],
    });
  });

  it('refuses anything narrower than a division: the HR views have no zone, region or HQ', () => {
    for (const scope of [makeScope('ZONE', ['WL'], ['85']), makeScope('REGION', ['WDR'], ['85']), makeScope('HQ', ['WTJAMM'], ['85'])]) {
      expect(manpowerScope(scope, F(), MAP)).toEqual({ ok: false, why: 'geo' });
    }
    expect(manpowerScope(NSM, F({ zone: ['WL'] }), MAP)).toEqual({ ok: false, why: 'geo' });
    expect(manpowerScope(NSM, F({ hq: ['WTJAMM'] }), MAP)).toEqual({ ok: false, why: 'geo' });
  });

  it('refuses a brand selection: people are not tracked by brand', () => {
    expect(manpowerScope(NSM, F({ brand: ['WOSULIN'] }), MAP)).toEqual({ ok: false, why: 'brand' });
  });

  it('counts nothing when only another division is asked for, never everything', () => {
    expect(manpowerScope(NSM, F({ division: ['A5'] }), MAP)).toEqual({ ok: true, costCentres: [] });
  });
});

describe('fetchManpower', () => {
  const rows = [
    { grp: 'total', kind: 'left', cadre: 'TM', ym: null, tenure: null, n: 9 },
    { grp: 'total', kind: 'left', cadre: 'ZM', ym: null, tenure: null, n: '1' },
    { grp: 'total', kind: 'joined', cadre: 'TM', ym: null, tenure: null, n: 12 },
    { grp: 'total', kind: 'joined', cadre: 'RM', ym: null, tenure: null, n: 2 },
    { grp: 'total', kind: 'joined', cadre: 'XX', ym: null, tenure: null, n: 5 }, // not field force
    { grp: 'month', kind: 'left', cadre: 'TM', ym: 202604, tenure: null, n: 4 },
    { grp: 'month', kind: 'left', cadre: 'TM', ym: '202606', tenure: null, n: 5 },
    { grp: 'month', kind: 'left', cadre: 'ZM', ym: 202606, tenure: null, n: 1 },
    { grp: 'tenure', kind: 'left', cadre: 'TM', ym: null, tenure: 'under6m', n: 3 },
    { grp: 'tenure', kind: 'left', cadre: 'TM', ym: null, tenure: 'm6to12', n: 2 },
    { grp: 'tenure', kind: 'left', cadre: 'TM', ym: null, tenure: 'over1y', n: 4 },
    { grp: 'tenure', kind: 'left', cadre: 'ZM', ym: null, tenure: 'over1y', n: 1 },
  ];

  it('shapes the counts by cadre, month and tenure, ZM as ZSM', async () => {
    const { db } = fakeDb([[/WITH base AS/, rows]]);
    const r = await fetchManpower(db, F(), ['1000EM68']);
    expect(r.panel.left).toEqual({ tm: 9, rm: 0, zsm: 1 });
    expect(r.panel.joined).toEqual({ tm: 12, rm: 2, zsm: 0 });
    expect(r.panel.leftByTenure).toEqual({
      tm: { under6m: 3, m6to12: 2, over1y: 4 },
      rm: { under6m: 0, m6to12: 0, over1y: 0 },
      zsm: { under6m: 0, m6to12: 0, over1y: 1 },
    });
    expect(r.leftByMonth.get(202604)).toEqual({ tm: 4, rm: 0, zsm: 0 });
    expect(r.leftByMonth.get(202606)).toEqual({ tm: 5, rm: 0, zsm: 1 });
  });

  it('counts leavers by DOL month and joiners by joining date, in the chosen cost centres', async () => {
    const { db, calls } = fakeDb([]);
    await fetchManpower(db, F(), ['1000EM68', '1000EM75']);
    const { sql, params } = calls[0]!;
    expect(sql).toMatch(/FROM Infinity\.VW_Exit_Details\s+WHERE LEFT\(DOL, 6\) BETWEEN @mFrom AND @mTo AND LTRIM\(RTRIM\(KOSTL\)\) IN \(@k0, @k1\)/);
    expect(sql).toMatch(/FROM Infinity\.VW_Hiring_Details\s+WHERE LEFT\(BEGDA, 6\) BETWEEN @mFrom AND @mTo AND LTRIM\(RTRIM\(KOSTL\)\) IN \(@k0, @k1\)/);
    // Tenure at exit by calendar dates, DOJ to DOL.
    expect(sql).toContain("WHEN TRY_CONVERT(date, DOL, 112) < DATEADD(month, 6, TRY_CONVERT(date, DOJ, 112)) THEN 'under6m'");
    expect(sql).toContain("WHEN TRY_CONVERT(date, DOL, 112) < DATEADD(year, 1, TRY_CONVERT(date, DOJ, 112)) THEN 'm6to12'");
    expect(params).toEqual({ mFrom: '202604', mTo: '202608', k0: '1000EM68', k1: '1000EM75' });
  });

  it('filters on no cost centre for an all-divisions user, and on none at all for an empty list', async () => {
    const { db: dbAll, calls: all } = fakeDb([]);
    await fetchManpower(dbAll, F(), null);
    expect(all[0]!.sql).not.toContain('KOSTL');

    const { db: dbNone, calls: none } = fakeDb([]);
    const r = await fetchManpower(dbNone, F(), []);
    expect(none[0]!.sql).toContain('AND 1 = 0');
    expect(r.panel.left).toEqual({ tm: 0, rm: 0, zsm: 0 });
  });
});

describe('buildLiveTab with manpower', () => {
  const VERSION = { dataVersion: 'v1', salesFrom: 202604, salesTo: 202609, rxFrom: 202601, rxTo: 202601, effortFrom: 202608, effortTo: 202609 };
  const sales = { tgt: 1, disp: 1, gross: 1, coll: 1, os: 1, inventory: 1, sec: 1, rcpa: null, src_rows: 1 };
  const routes: [RegExp, unknown[]][] = [
    [/WITH base AS/, [
      { grp: 'total', kind: 'left', cadre: 'TM', ym: null, tenure: null, n: 3 },
      { grp: 'month', kind: 'left', cadre: 'TM', ym: 202605, tenure: null, n: 3 },
    ]],
    [/rcpa_as_of/, [{ win: 'cur', ...sales, rcpa_as_of: null }]],
    [/AS date_key/, [{ date_key: 202604, ...sales }, { date_key: 202605, ...sales }, { date_key: 202606, ...sales }]],
  ];

  it('serves the panel and a leavers series on the trend months, zero where none left', async () => {
    const { db } = fakeDb(routes);
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F({ to: 202606 }), VERSION);
    expect(res.manpower?.left).toEqual({ tm: 3, rm: 0, zsm: 0 });
    expect(res.trends?.months).toEqual([202604, 202605, 202606]);
    expect(res.trends?.leftTm).toEqual([0, 3, 0]);
    expect(res.trends?.leftZsm).toEqual([0, 0, 0]);
    expect(res.meta.unavailable.map((u) => u.key)).not.toContain('manpower');
  });

  it('says why, and sends no figures, when a view is narrower than a division', async () => {
    const { db, calls } = fakeDb(routes);
    const zsm = makeScope('ZONE', ['WL'], ['85']);
    const res = await buildLiveTab(getTab('division-performance')!, db, zsm, F(), VERSION);
    expect(res.manpower).toBeNull();
    expect(res.trends?.leftTm).toBeUndefined();
    expect(res.meta.unavailable.find((u) => u.key === 'manpower')?.reason).toMatch(/whole divisions only/);
    // The HR views are not even queried.
    expect(calls.some((c) => c.sql.includes('VW_Exit_Details'))).toBe(false);
  });
});
