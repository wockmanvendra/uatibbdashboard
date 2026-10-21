import { describe, expect, it } from 'vitest';
import { makeScope } from '../../plugins/scope.js';
import type { PanelFilters } from '../queryBuilder.js';
import { categoryOrder, fetchMissedDoctors, fetchMissedSummary } from './missedDoctors.js';
import { buildLiveTab } from '../../services/liveData.js';
import { getTab } from '../../tabs/registry.js';
import { fakeDb } from '../../test/fakeDb.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202608, to: 202609, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const NSM = makeScope('DIVISION', ['85']);

describe('missed doctor summary', () => {
  it('counts the missed rows per month and per category, A, B, C first', async () => {
    const { db, calls } = fakeDb([[/COUNT_BIG\(\*\) AS n/, [
      { ym: '202608', category: 'B', n: 1500 },
      { ym: '202608', category: 'A', n: 900 },
      { ym: '202608', category: 'CORE - B', n: 20 },
      { ym: '202609', category: 'B', n: 1400 },
      { ym: '202609', category: 'C', n: 800 },
      { ym: '202609', category: null, n: 3 },
    ]]]);
    const s = await fetchMissedSummary(db, NSM, F());

    expect(s.total).toBe(4623);
    expect(s.byMonth.get(202608)).toBe(2420);
    expect(s.byCategory.map((c) => c.label)).toEqual(['A', 'B', 'C', 'CORE - B', 'Unclassified']);
    expect(s.byCategory[1]!.value).toBe(2900);

    const { sql, params } = calls[0]!;
    expect(sql).toContain('WHERE tmVisitCounts = 0');
    expect(sql).toContain('vs.div_code IN (@v0)');
    expect(params.v0).toBe('85');
  });

  it('narrows a zone manager through the territory lookup', async () => {
    const { db, calls } = fakeDb([[/COUNT_BIG/, []]]);
    await fetchMissedSummary(db, makeScope('ZONE', ['WL'], ['85']), F());
    expect(calls[0]!.sql).toContain('t.zone_code IN');
    expect(calls[0]!.sql).toContain('LEFT JOIN (');
  });

  it('orders categories A, B, C, then the rest by name', () => {
    expect(['New', 'C', 'A', 'CORE - B', 'B'].sort(categoryOrder)).toEqual(['A', 'B', 'C', 'CORE - B', 'New']);
  });
});

describe('missed doctor list', () => {
  const row = {
    rn: 101, total: 2085, ym: '202608', zone: 'Chennai', region: 'Cochin', hq: 'Kannur', hq_code: 'WTKANN',
    tm_code: '832406', tm_name: 'MUHAMMED SAFVAN VP', doctor_code: 'D1', doctor_name: 'Abhilash C C',
    speciality: 'Surgeon', category: 'B', rm_visits: '1', zsm_visits: 0,
  };

  it('pages by row number and returns the total from the same pass', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, [row]]]);
    const res = await fetchMissedDoctors(db, NSM, F(), { page: 2, pageSize: 100 });

    expect(res).toMatchObject({ total: 2085, page: 2, pageSize: 100 });
    expect(res.rows[0]).toEqual({
      month: 202608, zone: 'Chennai', region: 'Cochin', hq: 'Kannur', hqCode: 'WTKANN',
      tmName: 'MUHAMMED SAFVAN VP', tmCode: '832406', doctorCode: 'D1', doctorName: 'Abhilash C C',
      speciality: 'Surgeon', category: 'B', rmVisits: 1, zsmVisits: 0,
    });
    expect(calls[0]!.params).toMatchObject({ rFrom: 101, rTo: 200 });
    expect(calls[0]!.sql).toContain('COUNT_BIG(*) OVER () AS total');
  });

  it('binds the search term, matching its wildcards literally, and the categories', async () => {
    const { db, calls } = fakeDb([[/ROW_NUMBER/, []]]);
    const res = await fetchMissedDoctors(db, NSM, F(), {
      page: 1, pageSize: 50, search: ' 50%_off ', categories: ['A', 'Unclassified'],
    });

    expect(res.total).toBe(0);
    const { sql, params } = calls[0]!;
    expect(params.q).toBe('%50[%][_]off%');
    expect(sql).toContain('vs.doctor_name LIKE @q');
    expect(sql).not.toContain('50%');
    expect(params.k0).toBe('A');
    expect(sql).toContain('vs.category IN (@k0) OR vs.category IS NULL');
  });
});

describe('Drs Missed on the effort panel', () => {
  it('fills the count, each month and the category split from the visit summary', async () => {
    const effortRow = { tc: 21071, a: 3523, b: 8695, c: 8853, met: 17531, fcov_w: 1436122, calls: 34372, fd: 3648, fd_terr: 162 };
    const { db } = fakeDb([
      [/fcov_w/, [{ ym: '202608', ...effortRow }, { ym: '202609', ...effortRow }]],
      [/COUNT_BIG\(\*\) AS n/, [
        { ym: '202608', category: 'A', n: 1000 },
        { ym: '202608', category: 'B', n: 2784 },
        { ym: '202609', category: 'B', n: 3000 },
      ]],
    ]);
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F(), {
      dataVersion: 'v1', salesFrom: 202604, salesTo: 202609, rxFrom: 202601, rxTo: 202601,
      effortFrom: 202608, effortTo: 202609,
    });

    expect(res.effort!.total.drsMissed).toBe(6784);
    expect(res.effort!.months.map((m) => m.drsMissed)).toEqual([3784, 3000]);
    expect(res.effort!.missedByCategory).toEqual({ labels: ['A', 'B'], values: [1000, 5784] });
  });
});
