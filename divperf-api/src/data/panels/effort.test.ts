import { describe, expect, it } from 'vitest';
import { makeScope } from '../../plugins/scope.js';
import type { PanelFilters } from '../queryBuilder.js';
import { effortScope, fetchEffort } from './effort.js';
import { buildLiveTab } from '../../services/liveData.js';
import { getTab } from '../../tabs/registry.js';
import { fakeDb } from '../../test/fakeDb.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202608, to: 202609, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const NSM = makeScope('DIVISION', ['85']);
const NAMES = { '85': 'BIOSCIENCES', A5: 'RESPIRATORY', '02': 'RESEARCH', '84': 'RESEARCH' };
const VERSION = {
  dataVersion: 'v1', salesFrom: 202604, salesTo: 202609, rxFrom: 202601, rxTo: 202601,
  effortFrom: 202608, effortTo: 202609,
};

// Division 85's territory rows, as the warehouse sums them.
const AUG = { ym: '202608', tc: 21071, a: 3523, b: 8695, c: 8853, met: 17531, fcov_w: 1436122, calls: 34372, fd: 3648, fd_terr: 162 };
const SEP = { ym: '202609', tc: 21071, a: 3523, b: 8695, c: 8853, met: 17675, fcov_w: 1476013, calls: 35314, fd: 3775, fd_terr: 162 };

describe('effort', () => {
  it('derives each month and the period from the summed territory rows', async () => {
    const { db } = fakeDb([[/fcov_w/, [AUG, SEP]]]);
    const e = await fetchEffort(db, NSM, F(), NAMES);

    const aug = e.months[0]!;
    expect(aug.label).toBe('Aug-26');
    expect(aug.drs).toBe(21071);
    expect([aug.a, aug.b, aug.c]).toEqual([3523, 8695, 8853]);
    expect(aug.drsMet).toBe(17531);
    expect(aug.coveragePct).toBeCloseTo((17531 / 21071) * 100, 9);
    expect(aug.rtFrqCoveragePct).toBeCloseTo(1436122 / 21071, 9);
    expect(aug.callAvg).toBeCloseTo(34372 / 3648, 9);
    expect(aug.fieldDays).toBeCloseTo(3648 / 162, 9);
    // No source for these.
    expect([aug.aPlus, aug.drsMetRtFrq, aug.drsMissed, aug.missedRtFrq]).toEqual([null, null, null, null]);

    // The period: lists per month, ratios from the two months' sums.
    expect(e.total.drs).toBe(21071);
    expect(e.total.drsMet).toBe((17531 + 17675) / 2);
    expect(e.total.coveragePct).toBeCloseTo(((17531 + 17675) / (2 * 21071)) * 100, 9);
    expect(e.total.callAvg).toBeCloseTo((34372 + 35314) / (3648 + 3775), 9);
    expect(e.total.fieldDays).toBeCloseTo((3648 + 3775) / 324, 9);
  });

  it('reads only territory rows, scoped to the division, with the names bound', async () => {
    const { db, calls } = fakeDb([[/fcov_w/, [AUG]]]);
    await fetchEffort(db, NSM, F(), NAMES);
    const { sql, params } = calls[0]!;

    expect(sql).toContain("LTRIM(RTRIM(x.locat_type)) = 'Territory'");
    expect(sql).toContain('ef.div_code IN (@e0)');
    expect(params.e0).toBe('85');
    expect(Object.values(params)).toContain('BIOSCIENCES');
    expect(sql).not.toContain("'BIOSCIENCES'");
    // RESEARCH sits under two codes, so its rows are split by the territory lookup.
    expect(sql).toContain('ef.shared = 0 OR t.hq_code IS NOT NULL');
  });

  it('narrows a zone manager to their zones through the territory lookup', async () => {
    const { db, calls } = fakeDb([[/fcov_w/, []]]);
    const e = await fetchEffort(db, makeScope('ZONE', ['WL'], ['85']), F(), { '85': 'BIOSCIENCES' });
    expect(calls[0]!.sql).toContain('t.zone_code IN');
    expect(calls[0]!.sql).toContain('LEFT JOIN (');
    expect(e.months).toEqual([]);
    expect(e.total.drs).toBeNull();
  });

  it('skips a month whose doctor lists are empty', async () => {
    const { db } = fakeDb([[/fcov_w/, [{ ...AUG, tc: 0, met: 0 }, SEP]]]);
    const e = await fetchEffort(db, NSM, F(), NAMES);
    expect(e.months.map((m) => m.yrMn)).toEqual([202609]);
    expect(e.total.drsMet).toBe(17675);
  });

  it('cannot show a division the effort data has no name for', () => {
    expect(effortScope(makeScope('DIVISION', ['99']), F(), NAMES)).toEqual({ ok: false, unmapped: ['99'] });
    expect(effortScope(makeScope('DIVISION', ['85', '99']), F(), NAMES)).toEqual({ ok: true, unmapped: ['99'] });
    expect(effortScope(makeScope('ALL', []), F(), NAMES)).toEqual({ ok: true, unmapped: [] });
  });

  it('is on the performance tabs, and says when the period has no effort data', async () => {
    const { db } = fakeDb([[/fcov_w/, []]]);
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F({ from: 202604, to: 202606 }), VERSION);
    expect(res.effort!.months).toEqual([]);
    const reason = res.meta.unavailable.find((u) => u.key === 'effort');
    expect(reason?.reason).toContain('Aug-26 – Sep-26');
  });
});

describe('PCPM and Budget TM', () => {
  const base = { tgt: null, disp: null, gross: null, os: null, inventory: null, sec: null, rcpa: null, rxns: null, rxber: null, rx_months: 0, src_rows: 1 };

  it('divides collection by the TMs in place and the months selected', async () => {
    const { db, calls } = fakeDb([
      [/rcpa_as_of/, [{ win: 'cur', ...base, coll: 6_600_000, rcpa_as_of: null }]],
      [/AS date_key/, [
        { date_key: 202608, ...base, coll: 3_300_000 },
        { date_key: 202609, ...base, coll: 3_300_000 },
      ]],
      [/budget_tm/, [{ is_total: 1, node_code: null, budget_tm: 176, tms: 165 }]],
    ]);
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F(), VERSION);

    expect(res.pcpm).toEqual({ budgetTm: 176, pcpmCollection: 6_600_000 / 165 / 2 });
    expect(res.trends!.pcpm![0]).toBeCloseTo(3_300_000 / 165, 9);
    expect(res.meta.unavailable.map((u) => u.key)).not.toContain('pcpm');

    const hc = calls.find((c) => c.sql.includes('budget_tm'))!;
    expect(hc.sql).toContain('Infinity.budgeted_tm');
    expect(hc.sql).toContain('Infinity.vw_emp_count');
    expect(hc.sql).toContain('hc.div_code IN (@h0)');
    // No month column on the headcount tables.
    expect(hc.sql).not.toContain('@pFrom');
  });

  it('fills the PCPM column per node of a zone grid', async () => {
    const { db } = fakeDb([
      [/rcpa_as_of/, [{ win: 'cur', ...base, coll: 2_000_000, rcpa_as_of: null }]],
      [/GROUP BY ROLLUP\(COALESCE\(t\.zone_code/, [
        { is_total: 1, node_code: null, budget_tm: 30, tms: 20 },
        { is_total: 0, node_code: 'WL', budget_tm: 12, tms: 10 },
      ]],
      [/AS node_code/, [{ win: 'cur', node_code: 'WL', node_name: 'West', ...base, coll: 1_000_000, prior_disp: null, prior_coll: null }]],
    ]);
    const res = await buildLiveTab(getTab('zone-performance')!, db, NSM, F({ from: 202609, to: 202609 }), VERSION);
    const row = res.geoTable!.rows.find((r) => r[0] === 'West')!;
    expect(row[7]).toBe(100_000);
    expect(res.geoTable!.total[7]).toBe(100_000);
  });

  it('is blank for a brand selection, since collection has no brand', async () => {
    const { db } = fakeDb([
      [/rcpa_as_of/, [{ win: 'cur', ...base, coll: 6_600_000, rcpa_as_of: null }]],
      [/budget_tm/, [{ is_total: 1, node_code: null, budget_tm: 176, tms: 165 }]],
    ]);
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F({ brand: ['ZEDEX'] }), VERSION);
    expect(res.pcpm).toEqual({ budgetTm: 176, pcpmCollection: null });
    expect(res.meta.unavailable.find((u) => u.key === 'pcpm')?.reason).toContain('brand');
  });
});
