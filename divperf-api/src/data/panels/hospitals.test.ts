import { describe, expect, it } from 'vitest';
import { makeScope } from '../../plugins/scope.js';
import type { PanelFilters } from '../queryBuilder.js';
import { fetchHospitals, hospitalDivisions } from './hospitals.js';
import { buildLiveTab } from '../../services/liveData.js';
import { getTab } from '../../tabs/registry.js';
import { DETAIL_LISTS } from '../details/index.js';
import { fakeDb } from '../../test/fakeDb.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202604, to: 202609, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const RESEARCH = makeScope('DIVISION', ['02'], ['02']);
const BIOSCIENCES = makeScope('DIVISION', ['85'], ['85']);
const ALL = makeScope('ALL', []);
const NAMES = { '02': 'RESEARCH' };
const VERSION = {
  dataVersion: 'v1', salesFrom: 202604, salesTo: 202609, rxFrom: null, rxTo: null, effortFrom: 202604, effortTo: 202609,
};

const TIER_ROWS = [
  { tier: 'Tier 1', n: 149 }, { tier: 'Tier 2', n: 406 }, { tier: 'Tier 3', n: 224 }, { tier: 'Tier 4', n: 102 }, { tier: null, n: 726 },
];

describe('which views show hospitals', () => {
  it('shows them for RESEARCH (02) only — its own users, or anyone choosing it', () => {
    expect(hospitalDivisions(RESEARCH, F(), ['02'])).toEqual(['02']);
    expect(hospitalDivisions(BIOSCIENCES, F(), ['02'])).toEqual([]);
    expect(hospitalDivisions(BIOSCIENCES, F({ division: ['02'] }), ['02'])).toEqual([]); // not theirs
    expect(hospitalDivisions(ALL, F(), ['02'])).toEqual([]); // no division chosen
    expect(hospitalDivisions(ALL, F({ division: ['02', '85'] }), ['02'])).toEqual(['02']);
  });
});

describe('hospital master list', () => {
  it('counts hospitals by tier, keeps the untiered in the total, and leaves coverage blank without visits', async () => {
    const { db, calls } = fakeDb([
      [/GROUP BY hl\.tier/, TIER_ROWS],
      [/hosp_total/, [{ ym: '202608', total: 1473, met: 0 }, { ym: '202609', total: 1474, met: 0 }]],
    ]);
    const h = await fetchHospitals(db, RESEARCH, F(), ['02'], NAMES);

    expect(h.total).toEqual({ label: 'Total', count: 1607, covered: null, coveredPct: null, missed: null });
    expect(h.tiers.map((t) => [t.label, t.count])).toEqual([['Tier I', 149], ['Tier II', 406], ['Tier III', 224], ['Tier IV', 102]]);
    expect(h.untiered).toBe(726);
    expect(h.months.map((m) => [m.label, m.total, m.covered])).toEqual([['Aug-26', 1473, null], ['Sep-26', 1474, null]]);

    const { sql, params } = calls.find((c) => /GROUP BY hl\.tier/.test(c.sql))!;
    expect(sql).toContain('Infinity.Hospital_List');
    expect(sql).toContain('hl.div_code IN (@k0)');
    expect(params.k0).toBe('02');
    expect(sql).not.toContain('@pFrom'); // a list of today's hospitals, not of a period
  });

  it('counts the monthly covered and missed once visits are recorded', async () => {
    const { db } = fakeDb([
      [/GROUP BY hl\.tier/, TIER_ROWS],
      [/hosp_total/, [{ ym: '202609', total: 1474, met: 1200 }]],
    ]);
    const h = await fetchHospitals(db, RESEARCH, F(), ['02'], NAMES);
    expect(h.months[0]).toMatchObject({ total: 1474, covered: 1200, missed: 274 });
    expect(h.months[0]!.coveragePct).toBeCloseTo((1200 / 1474) * 100, 9);
  });

  it('narrows a zone manager through the territory lookup', async () => {
    const { db, calls } = fakeDb([[/GROUP BY hl\.tier/, []]]);
    await fetchHospitals(db, makeScope('ZONE', ['SH'], ['02']), F(), ['02'], NAMES);
    expect(calls.find((c) => /GROUP BY hl\.tier/.test(c.sql))!.sql).toContain('t.zone_code IN');
  });
});

describe('the hospital section on a tab', () => {
  it('is there for RESEARCH, with the reason coverage is blank', async () => {
    const { db } = fakeDb([[/GROUP BY hl\.tier/, TIER_ROWS]]);
    const res = await buildLiveTab(getTab('division-performance')!, db, RESEARCH, F(), VERSION);
    expect(res.hospitals!.total.count).toBe(1607);
    expect(res.meta.unavailable.map((u) => u.key)).toContain('hospitals.coverage');
  });

  it('is null — not shown — for other divisions, and nothing is read', async () => {
    const { db, calls } = fakeDb([]);
    const res = await buildLiveTab(getTab('division-performance')!, db, BIOSCIENCES, F(), VERSION);
    expect(res.hospitals).toBeNull();
    expect(calls.some((c) => c.sql.includes('Hospital_List'))).toBe(false);
  });
});

describe('the hospital list', () => {
  it('lists hospitals by tier, and only for RESEARCH', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, [{
      rn: 1, total: 1, zone: 'South Hybrid', region: 'HYDERABAD 5 RM', location: 'Hyderabad 2', hq_code: '6HYD',
      tm_name: 'A TM', hospital_name: 'ARKAN HOSPITAL', hospital_code: 'H1', tier: 'Tier 2', classification: 'CORE',
      town: 'Hyderabad', state: 'Telangana', created: '10/12/2023',
    }]]]);
    const res = await DETAIL_LISTS.hospitals.fetch(db, RESEARCH, F(), { page: 1, pageSize: 100, facets: { tier: 'Tier 2' } });
    expect(res.rows[0]).toMatchObject({ hospital: 'ARKAN HOSPITAL', tier: 'Tier II', hq: 'Hyderabad 2' });
    expect(calls[0]!.params.tier).toBe('Tier 2');

    const other = await DETAIL_LISTS.hospitals.fetch(fakeDb([]).db, BIOSCIENCES, F(), { page: 1, pageSize: 100, facets: {} });
    expect(other.unavailable).toMatch(/RESEARCH/);
  });
});
