import { describe, expect, it } from 'vitest';
import { makeScope } from '../../plugins/scope.js';
import type { PanelFilters } from '../queryBuilder.js';
import { fetchStockists } from './stockists.js';
import { buildLiveTab } from '../../services/liveData.js';
import { getTab } from '../../tabs/registry.js';
import { fakeDb } from '../../test/fakeDb.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202604, to: 202609, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const BIOSCIENCES = makeScope('DIVISION', ['85'], ['85']);
const VERSION = {
  dataVersion: 'v1', salesFrom: 202404, salesTo: 202609, rxFrom: null, rxTo: null, effortFrom: null, effortTo: null,
};

const row = (win: string, code: string, over: object = {}) => ({
  win, node_code: code, node_name: `Stockist ${code}`,
  disp: 100, coll: 90, sec: 80, os: 50, inventory: null, ...over,
});
const HQS = [
  { node_code: 'S1', hq: 'WTMADU', hq_name: 'MADURAI' },
  { node_code: 'S1', hq: 'WTCHEN', hq_name: 'CHENNAI' },
  { node_code: 'S1', hq: '94CHEN', hq_name: 'Chennai' },
  { node_code: 'S2', hq: 'WTCHEN', hq_name: null }, // no name: shown by its code
];
const ROWS = [
  row('cur', 'S1', { disp: 200 }),
  row('prior', 'S1', { disp: 100, coll: 100, sec: 40 }),
  row('cur', 'S2', { disp: 300 }),
  row('prior', 'S2', { disp: 400 }),
  row('prior', 'S3'), // sold last year only
];

describe('stockist-wise sales', () => {
  it('lists each stockist with sales this period, largest dispatch first, with growth', async () => {
    const { db, calls } = fakeDb([[/AS hq_name/, HQS], [/StockistCode/, ROWS]]);
    const s = await fetchStockists(db, BIOSCIENCES, F());
    expect(s.map((x) => [x.code, x.name, x.hq, x.hqName, x.disp, x.priorDisp])).toEqual([
      ['S2', 'Stockist S2', 'WTCHEN', 'WTCHEN', 300, 400],
      ['S1', 'Stockist S1', '94CHEN, WTCHEN, WTMADU', 'Chennai, MADURAI', 200, 100],
    ]);
    const { sql, params } = calls.find((c) => !c.sql.includes('AS hq_name'))!;
    expect(sql).toContain("NULLIF(LTRIM(RTRIM(StockistCode)), '') IS NOT NULL");
    expect(sql).toMatch(/Division_Code.* IN \(@p0\)/); // held to the user's division
    expect(params.p0).toBe('85');
    // The HQ codes: this period's rows only, held to the same division.
    const hqs = calls.find((c) => c.sql.includes('AS hq_name'))!;
    expect(hqs.sql).not.toContain('@ppFrom');
    expect(hqs.params).toMatchObject({ p0: '85', pFrom: '202604', pTo: '202609' });
  });

  it('is the Stockist tab: the grid, with the period totals as its Total', async () => {
    const { db } = fakeDb([
      [/AS hq_name/, HQS],
      [/StockistCode/, ROWS],
      [/GROUP BY CASE WHEN/, [
        { win: 'cur', disp: 500, coll: 180, sec: 160, os: 100, src_rows: 9 },
        { win: 'prior', disp: 500, coll: 200, sec: 80, os: 90, src_rows: 9 },
      ]],
    ]);
    const res = await buildLiveTab(getTab('stockist-performance')!, db, BIOSCIENCES, F(), VERSION);
    const t = res.stockistTable!;
    expect(t.rows[0]).toEqual(['Stockist S2', 'S2', 'WTCHEN', 'WTCHEN', 300, -25, 90, 0, 80, 0, 50]);
    expect(t.rows[1]!.slice(4, 10)).toEqual([200, 100, 90, -10, 80, 100]);
    expect([t.growingCount, t.degrowingCount]).toEqual([1, 1]);
    expect(t.total[0]).toBe('Total');
    expect(res.primary).toBeUndefined(); // the grid only
  });
});
