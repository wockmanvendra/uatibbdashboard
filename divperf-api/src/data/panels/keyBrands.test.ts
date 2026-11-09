import { describe, expect, it } from 'vitest';
import { makeScope } from '../../plugins/scope.js';
import type { PanelFilters } from '../queryBuilder.js';
import { MEASURES } from '../sqlFragments.js';
import { buildLiveTab } from '../../services/liveData.js';
import { getTab } from '../../tabs/registry.js';
import { fakeDb } from '../../test/fakeDb.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202604, to: 202609, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const RESEARCH = makeScope('DIVISION', ['02'], ['02']);
const VERSION = {
  dataVersion: 'v1', salesFrom: 202404, salesTo: 202609, rxFrom: null, rxTo: null, effortFrom: null, effortTo: null,
};

const figures = {
  tgt: 400, div_tgt: null, disp: 300, gross: 500, coll: null, coll_mat: 200, sec: 100, rcpa: 25,
  rxns: null, rxber: null, rx_months: 0, src_rows: 9, os: null, inventory: 50,
};
const cn = { cn_exp: 1, cn_sr: 2, cn_pd: 2, cn_total: 5, cn_exp_p: 1, cn_sr_p: 2, cn_pd_p: 2, cn_total_p: 5 };

const routes = (totals: object): [RegExp, unknown[]][] => [
  [/b\.brand AS node_code/, [{ node_code: 'EMROK', ...cn }]],
  [/rcpa_as_of/, [
    { win: 'cur', ...figures, ...totals },
    { win: 'prior', ...figures, disp: 150, coll_mat: 400, tgt: 1 },
  ]],
  [/Brand.* AS node_code/, [
    { win: 'cur', node_code: 'EMROK', node_name: 'EMROK', ...figures },
    { win: 'prior', node_code: 'EMROK', node_name: 'EMROK', ...figures, disp: 150, coll_mat: 400 },
    { win: 'cur', node_code: 'NEWBRAND', node_name: 'NEWBRAND', ...figures, disp: 10 },
  ]],
];

describe('the Key Brands grid', () => {
  it('has the zone grid\'s columns, by brand', async () => {
    const { db } = fakeDb(routes({}));
    const res = await buildLiveTab(getTab('division-performance')!, db, RESEARCH, F(), VERSION);
    const [emrok, other] = res.keyBrands!.rows;

    expect(emrok).toEqual([
      'EMROK',
      400, 300, 100, // Tgt, Disp, Disp Gr%
      200, 50, -50, // Coll, Ach% on Coll, Coll Gr%
      5, 1, // Credit note, CN% on the brand's gross
      100, 50, 25, 25, // Sec, Closing inventory, RCPA, RCPA as % to Sec
    ]);
    // No credit notes, and no prior year: blank, not zero.
    expect(other!.slice(3, 4)).toEqual([null]);
    expect(other!.slice(7, 9)).toEqual([null, null]);
  });

  it('keeps products without a brand out of the rows, not out of the Total', async () => {
    const { db, calls } = fakeDb([
      ...routes({}),
      [/ROLLUP/, [{ date_key: null, ...cn, cn_total: 8, cn_total_p: 8 }]],
    ]);
    const res = await buildLiveTab(getTab('division-performance')!, db, RESEARCH, F(), VERSION);
    expect(res.keyBrands!.total![7]).toBe(8);
    expect(calls.find((c) => /b\.brand AS node_code/.test(c.sql))!.sql).toContain('b.brand IS NOT NULL');
  });
});

describe('the target', () => {
  it('is the field budget (BUDGET1), with the division budget (BUDGET, in lakhs) beside it', async () => {
    expect(MEASURES.tgt).toContain('BUDGET1');
    expect(MEASURES.divTgt).toContain('SUM(CAST(BUDGET AS DECIMAL(38,6))) * 100000');

    const { db } = fakeDb(routes({ tgt: 400, div_tgt: 500 }));
    const res = await buildLiveTab(getTab('division-performance')!, db, RESEARCH, F(), VERSION);
    expect(res.primary!.target.value).toBe(400);
    expect(res.primary!.dispatch.ach).toBe(75); // 300 on the field budget
    expect(res.primary!.divisionTarget).toEqual({ value: 500, collAch: null, dispAch: 60, gr: null }); // no prior-year budget
    // Brands are on the field budget.
    expect(res.keyBrands!.rows[0]![1]).toBe(400);
  });

  it('has no division budget below the division: BUDGET has no zone, HQ or brand', async () => {
    const { db } = fakeDb(routes({ div_tgt: null }));
    const res = await buildLiveTab(getTab('division-performance')!, db, RESEARCH, F({ zone: ['SH'] }), VERSION);
    expect(res.primary!.divisionTarget).toBeNull();
  });
});
