import { describe, expect, it } from 'vitest';
import { makeScope } from '../../plugins/scope.js';
import type { PanelFilters } from '../queryBuilder.js';
import { fakeDb } from '../../test/fakeDb.js';
import { DETAIL_LISTS } from './index.js';
import type { DetailRequest } from './types.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202608, to: 202609, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const NSM = makeScope('DIVISION', ['85'], ['85']);
const ZSM = makeScope('ZONE', ['WL'], ['85']);
const R = (over: Partial<DetailRequest> = {}): DetailRequest => ({ page: 1, pageSize: 100, facets: {}, ...over });

describe('doctors', () => {
  const list = DETAIL_LISTS.doctors;
  const row = {
    rn: 101, total: 2085, ym: '202608', zone: 'Chennai', region: 'Cochin', hq: 'Kannur', hq_code: 'WTKANN',
    tm_name: null, doctor_code: 'D1', doctor_name: 'Abhilash C C', speciality: 'Surgeon', category: 'B',
    tm_visits: '0', tm_dates: '', rm_visits: '1', zsm_visits: 0,
  };

  it('lists the missed doctors by default, one page with the total, a vacant TM shown as such', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, [row]]]);
    const res = await list.fetch(db, NSM, F(), R({ page: 2 }));

    expect(res.total).toBe(2085);
    expect(res.rows[0]).toMatchObject({ month: 202608, hq: 'Kannur', tm: 'Vacant', doctor: 'Abhilash C C', tmVisits: 0, rmVisits: 1 });
    const { sql, params } = calls[0]!;
    expect(sql).toContain('WHERE tmVisitCounts = 0');
    expect(sql).toContain('vs.div_code IN (@v0)');
    expect(params).toMatchObject({ v0: '85', rFrom: 101, rTo: 200 });
    expect(sql).toContain('COUNT_BIG(*) OVER () AS total');
  });

  it('lists the met doctors, by category, with the search bound and its wildcards literal', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, []]]);
    await list.fetch(db, NSM, F(), R({ facets: { status: 'met', category: 'A' }, search: ' 50%_off ' }));
    const { sql, params } = calls[0]!;
    expect(sql).toContain('WHERE tmVisitCounts > 0');
    expect(sql).toContain('vs.category = @cat');
    expect(params.cat).toBe('A');
    expect(params.q).toBe('%50[%][_]off%');
    expect(sql).not.toContain('50%');
  });

  it('every doctor, and "Others" for the categories outside A, B, C', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, []]]);
    await list.fetch(db, NSM, F(), R({ facets: { status: 'all', category: 'other' } }));
    expect(calls[0]!.sql).toContain('WHERE 1 = 1');
    expect(calls[0]!.sql).toContain("vs.category NOT IN ('A', 'B', 'C')");
  });

  it('narrows a zone manager through the territory lookup', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, []]]);
    await list.fetch(db, ZSM, F(), R());
    expect(calls[0]!.sql).toContain('t.zone_code IN');
  });
});

describe('leavers and joiners', () => {
  it('lists leavers for the division cost centres, by cadre and tenure', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, [{
      rn: 1, total: 1, name: 'RAJESH THAKUR', emp_code: '00834764', cadre: 'ZM', designation: 'Territory Manager',
      location: 'Shimla', org: 'DIABETICS - DTF & WTF', doj: '20260102', dol: '20260903', tenure: 'm6to12',
      reason: 'Personal/Familyrelated-Dnt use', joined: null, source: 'Employee Referral',
    }]]]);
    const res = await DETAIL_LISTS.leavers.fetch(db, NSM, F(), R({ facets: { cadre: 'ZM', tenure: 'm6to12' } }));

    expect(res.rows[0]).toEqual({
      name: 'RAJESH THAKUR', empCode: '834764', cadre: 'ZSM', designation: 'Territory Manager', location: 'Shimla',
      org: 'DIABETICS - DTF & WTF', doj: '20260102', dol: '20260903', tenure: '6 months to 1 Year',
      reason: 'Personal/Familyrelated-Dnt use',
    });
    const { sql, params } = calls[0]!;
    expect(sql).toContain('Infinity.VW_Exit_Details');
    expect(sql).toContain('LEFT(DOL, 6) BETWEEN @mFrom AND @mTo');
    expect(sql).toContain("LTRIM(RTRIM(EMP_TYPE)) IN ('TM', 'RM', 'ZM')");
    expect(params).toMatchObject({ k0: '1000EM68', cadre: 'ZM', tenure: 'm6to12', mFrom: '202608' });
  });

  it('lists joiners by joining date', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, []]]);
    const res = await DETAIL_LISTS.joiners.fetch(db, NSM, F(), R());
    expect(res.total).toBe(0);
    expect(calls[0]!.sql).toContain('Infinity.VW_Hiring_Details');
    expect(calls[0]!.sql).toContain('LEFT(BEGDA, 6) BETWEEN @mFrom AND @mTo');
  });

  it('is division-level only: a zone manager gets the reason, and no query runs', async () => {
    const { db, calls } = fakeDb([]);
    const res = await DETAIL_LISTS.leavers.fetch(db, ZSM, F(), R());
    expect(res.rows).toEqual([]);
    expect(res.unavailable).toContain('whole divisions only');
    expect(calls).toHaveLength(0);
  });
});

describe('TM-wise effort', () => {
  const list = DETAIL_LISTS['tm-effort'];

  it('lists territories weakest first, with coverage and call average worked out', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, [{
      rn: 1, total: 174, ym: '202609', zone: 'Bangalore', region: 'Hubli', hq: 'Hubli', hq_code: 'WTHUBL',
      tm: 'A TM', tc: '120', met: '90', fcov: '60', calls: '200', fd: '20',
    }]]]);
    const res = await list.fetch(db, NSM, F(), R({ facets: { month: '202609', tm: 'vacant' } }));

    expect(res.rows[0]).toMatchObject({ hq: 'Hubli', tm: 'A TM', drs: 120, met: 90, coverage: 75, rtFrqCoverage: 60, callAvg: 10, fieldDays: 20 });
    const { sql, params } = calls[0]!;
    expect(sql).toContain("LTRIM(RTRIM(x.locat_type)) = 'Territory'");
    expect(sql).toContain('ef.yearMonth = @month');
    expect(sql).toContain('ef.emp_name IS NULL');
    expect(params.month).toBe('202609');
    expect(sql).toMatch(/ORDER BY COALESCE\(CASE WHEN ef\.tc > 0/);
  });

  it('offers each month of the period', () => {
    const months = list.facets(F()).find((f) => f.key === 'month')!.options.map((o) => o.label);
    expect(months).toEqual(['All', 'Aug-26', 'Sep-26']);
  });

  it('cannot show a division the effort data has no name for', async () => {
    const { db } = fakeDb([]);
    const res = await list.fetch(db, makeScope('DIVISION', ['99'], ['99']), F(), R());
    expect(res.unavailable).toContain('99');
  });
});

describe('HQ headcount and PCPM', () => {
  const list = DETAIL_LISTS['hq-headcount'];
  const row = { rn: 1, total: 10, zone: 'Delhi', region: 'Chandigarh', hq: 'SHIMLA', hq_code: 'WTSMLA', budget_tm: 2, tms: 1, vacancy: 1, coll: '6000000.00' };

  it('lists each HQ with its vacancy and PCPM, the short ones on request', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, [row]]]);
    const res = await list.fetch(db, NSM, F(), R({ facets: { vacancy: 'short' } }));

    expect(res.rows[0]).toEqual({
      zone: 'Delhi', region: 'Chandigarh', hq: 'SHIMLA', hqCode: 'WTSMLA', budgetTm: 2, tms: 1, vacancy: 1,
      coll: 6_000_000, pcpm: 3_000_000, // 60 L ÷ 1 TM ÷ 2 months
    });
    const { sql, params } = calls[0]!;
    expect(sql).toContain('Infinity.budgeted_tm');
    expect(sql).toContain('yearMonth BETWEEN @cFrom AND @cTo');
    expect(sql).toContain('COALESCE(hc.budget_tm, 0) > COALESCE(hc.tms, 0)');
    expect(params).toMatchObject({ h0: '85', cFrom: '202608', cTo: '202609' });
  });

  it('leaves collection and PCPM blank for a brand selection', async () => {
    const { db } = fakeDb([[/ROW_NUMBER/, [row]]]);
    const res = await list.fetch(db, NSM, F({ brand: ['WOSULIN'] }), R());
    expect(res.rows[0]).toMatchObject({ coll: null, pcpm: null, budgetTm: 2 });
    expect(res.note).toContain('brand');
  });
});
