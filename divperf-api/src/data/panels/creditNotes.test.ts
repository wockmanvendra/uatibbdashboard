import { describe, expect, it } from 'vitest';
import { makeScope } from '../../plugins/scope.js';
import { buildPredicate, CN_MATCH, type PanelFilters } from '../queryBuilder.js';
import { fetchCnBreakdown, fetchCnByMonth, fetchCnDetail } from './creditNotes.js';
import { buildLiveTab } from '../../services/liveData.js';
import { getTab } from '../../tabs/registry.js';
import { fakeDb } from '../../test/fakeDb.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202604, to: 202605, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const ALL = makeScope('ALL', []);
const NSM = makeScope('DIVISION', ['85']);
const APR_MAY = { from: 202604, to: 202605 };

/** A credit-note result row; the `_p` (months with sales) amounts default to the full ones. */
const cnRow = (
  total: number | null, exp = 0, sr = 0, pd = 0,
  p: { total?: number; exp?: number; sr?: number; pd?: number } = {},
) => ({
  cn_exp: exp, cn_sr: sr, cn_pd: pd, cn_total: total,
  cn_exp_p: p.exp ?? exp, cn_sr_p: p.sr ?? sr, cn_pd_p: p.pd ?? pd, cn_total_p: p.total ?? total,
});

describe('the credit-note predicate', () => {
  it('matches zone and region through the territory lookup, and brand through products', () => {
    const p = buildPredicate(ALL, F({ zone: ['WD'], region: ['WDR'], brand: ['WOSULIN'] }), {
      match: CN_MATCH, prefix: 'c',
    });
    expect(p.where).toContain('t.zone_code IN (@c1)');
    expect(p.where).toContain('t.region_code IN (@c2)');
    expect(p.where).toMatch(/c\.Product_code IN \(SELECT TRY_CAST\(.*Product_code.*AS INT\) FROM .*Brand.* IN \(@c0\)\)/);
    expect(p.params).toMatchObject({ c0: 'WOSULIN', c1: 'WD', c2: 'WDR' });
    expect(p.constrained).toEqual(['brand', 'zone', 'region']);
  });

  it('holds a TM to their division and HQ, on the view\'s own columns', () => {
    const tm = makeScope('HQ', ['WTJAMM'], ['85']);
    const own = buildPredicate(tm, F(), { match: CN_MATCH, prefix: 'c' });
    expect(own.where).toMatch(/c\.Division_Code.* IN \(@c0\)/);
    expect(own.where).toMatch(/c\.TERRITORY_CODE.* IN \(@c1\)/);
    expect(own.params).toMatchObject({ c0: '85', c1: 'WTJAMM' });

    // Asking only for another division narrows to nothing, never to everything.
    const other = buildPredicate(tm, F({ division: ['A5'] }), { match: CN_MATCH, prefix: 'c' });
    expect(other.where).toContain('1 = 0');
    expect(Object.values(other.params)).not.toContain('A5');
  });
});

describe('fetchCnByMonth', () => {
  it('takes the period total from the ROLLUP row and the months from the rest', async () => {
    const { db, calls } = fakeDb([[/ROLLUP/, [
      { date_key: null, ...cnRow(50, 30, 15, 5) },
      { date_key: 202604, ...cnRow(30, 20, 10, 0) },
      { date_key: '202605', ...cnRow(20, 10, 5, 5) },
    ]]]);
    const r = await fetchCnByMonth(db, NSM, F(), APR_MAY);
    expect(r.total).toMatchObject({ exp: 30, sr: 15, pd: 5, total: 50 });
    expect([...r.byMonth.keys()]).toEqual([202604, 202605]);
    expect(r.byMonth.get(202605)).toMatchObject({ exp: 10, sr: 5, pd: 5, total: 20 });
    // No zone or region in play: the territory lookup (a scan) is not joined.
    expect(calls[0]!.sql).not.toContain('zone_code');
  });

  it('sums each amount again over the months with sales, for CN%', async () => {
    const { db, calls } = fakeDb([[/ROLLUP/, [{ date_key: null, ...cnRow(72, 2, 68, 2, { total: 32, exp: 1, sr: 30, pd: 1 }) }]]]);
    const r = await fetchCnByMonth(db, NSM, F({ from: 202601, to: 202608 }), { from: 202604, to: 202608 });
    expect(r.total).toMatchObject({ total: 72, exp: 2 });
    expect(r.total.forPct).toEqual({ total: 32, exp: 1, sr: 30, pd: 1 });
    expect(calls[0]!.sql).toContain('yearMonth BETWEEN @gFrom AND @gTo THEN CAST(c.Total_CreditNote');
    expect(calls[0]!.params).toMatchObject({ pFrom: '202601', pTo: '202608', gFrom: '202604', gTo: '202608' });
  });

  it('leaves CN% blank when no month of the period has sales', async () => {
    const { db, calls } = fakeDb([[/ROLLUP/, [{ date_key: null, ...cnRow(10), cn_total_p: null }]]]);
    const r = await fetchCnByMonth(db, NSM, F({ from: 202601, to: 202603 }), null);
    expect(r.total.total).toBe(10);
    expect(r.total.forPct.total).toBeNull();
    expect(calls[0]!.sql).toContain('CAST(NULL AS DECIMAL(38,2)) AS cn_total_p');
    expect(calls[0]!.params.gFrom).toBeUndefined();
  });

  it('joins the territory lookup only when a zone or region is filtered', async () => {
    const { db, calls } = fakeDb([]);
    await fetchCnByMonth(db, NSM, F({ zone: ['WD'] }), APR_MAY);
    expect(calls[0]!.sql).toContain('LEFT JOIN (');
    expect(calls[0]!.sql).toContain('t.zone_code IN');
  });

  it('holds an all-divisions user to the divisions the sales table covers', async () => {
    const { db: dbAll, calls: all } = fakeDb([]);
    await fetchCnByMonth(dbAll, ALL, F(), APR_MAY);
    expect(all[0]!.sql).toMatch(/c\.Division_Code.* IN \(SELECT DISTINCT .*Division_Code/);

    const { db: dbNsm, calls: nsm } = fakeDb([]);
    await fetchCnByMonth(dbNsm, NSM, F(), APR_MAY);
    expect(nsm[0]!.sql).not.toContain('SELECT DISTINCT');
  });

  it('reports no credit notes as null, not 0', async () => {
    const { db } = fakeDb([]);
    const r = await fetchCnByMonth(db, NSM, F(), APR_MAY);
    expect(r.total).toMatchObject({ exp: null, sr: null, pd: null, total: null });
  });
});

describe('fetchCnBreakdown', () => {
  it('groups a zone grid through the territory lookup, Unassigned included', async () => {
    const { db, calls } = fakeDb([[/VW_Credit_Note_Details/, [
      { node_code: 'WD', node_name: 'WEST', ...cnRow(35) },
      { node_code: 'Unassigned', node_name: null, ...cnRow(5) },
    ]]]);
    const nodes = await fetchCnBreakdown(db, NSM, F(), 'zone', APR_MAY);
    expect(calls[0]!.sql).toContain("COALESCE(t.zone_code, 'Unassigned')");
    expect(nodes.get('WD')).toMatchObject({ name: 'WEST', cn: { exp: 0, sr: 0, pd: 0, total: 35 } });
    expect(nodes.get('Unassigned')?.name).toBe('Unassigned');
  });
});

describe('fetchCnDetail', () => {
  it('drops nodes with no credit notes, sorts by total, and takes CN% on each node\'s gross', async () => {
    const { db, calls } = fakeDb([
      [/hq_name/, [
        // H1's CN% counts only its 10 of credit notes from months with sales.
        { node_code: 'H1', node_name: 'JAMMU', gross: 1000, ...cnRow(20, 10, 10, 0, { total: 10 }) },
        { node_code: 'H2', node_name: null, gross: 500, ...cnRow(50, 50, 0, 0) },
        { node_code: 'H3', node_name: 'ZERO', gross: 800, ...cnRow(null) },
      ]],
      [/Product_code/, [
        { node_code: 401679, node_name: 'WOSULIN', gross: null, ...cnRow(7, 7) },
        { node_code: 999999, node_name: null, gross: 100, ...cnRow(3, 3) },
      ]],
    ]);
    const d = await fetchCnDetail(db, NSM, F(), APR_MAY);
    expect(d.byHq).toEqual([
      ['H2', 'H2', 50, 0, 0, 50, 10],
      ['JAMMU', 'H1', 10, 10, 0, 20, 1],
    ]);
    expect(d.bySku).toEqual([
      ['WOSULIN', '401679', 7, 0, 0, 7, null],
      ['Product 999999', '999999', 3, 0, 0, 3, 3],
    ]);
    // The sales-side gross shares the statement under its own parameter names.
    const hq = calls.find((c) => c.sql.includes('hq_name'))!;
    expect(Object.keys(hq.params)).toEqual(expect.arrayContaining(['c0', 'f0', 'pFrom', 'pTo', 'gFrom', 'gTo']));
  });
});

describe('buildLiveTab with credit notes from their view', () => {
  const VERSION = { dataVersion: 'v1', salesFrom: 202604, salesTo: 202609, rxFrom: 202601, rxTo: 202601, effortFrom: 202608, effortTo: 202609 };
  const sales = {
    tgt: 1000, disp: 900, gross: 1000, coll: 800, os: 50, inventory: 70, sec: 700, rcpa: null, src_rows: 10,
  };
  const routes = (over: { gross?: number | null } = {}): [RegExp, unknown[]][] => [
    [/ROLLUP/, [
      { date_key: null, ...cnRow(50, 30, 15, 5) },
      { date_key: 202604, ...cnRow(30, 20, 10, 0) },
      { date_key: 202605, ...cnRow(20, 10, 5, 5) },
    ]],
    [/VW_Credit_Note_Details/, [
      { node_code: 'Z1', node_name: 'Zone 1', ...cnRow(35) },
      { node_code: 'Z9', node_name: 'Zone 9', ...cnRow(15) },
    ]],
    [/rcpa_as_of/, [{ win: 'cur', ...sales, gross: over.gross === undefined ? 1000 : over.gross, rcpa_as_of: null }]],
    [/AS n\b/, [{ n: 0 }]],
    [/top_brand/, []],
    // The sales trend has April only; May has credit notes alone.
    [/AS date_key/, [{ date_key: 202604, ...sales, gross: 600 }]],
    [/AS node_code/, [
      { win: 'cur', node_code: 'Z1', node_name: 'Zone 1', ...sales, gross: 700 },
      { win: 'cur', node_code: 'Z2', node_name: 'Zone 2', ...sales, gross: 300 },
    ]],
  ];

  it('fills the CN & O/S card, the geo grid and the CN trend from the view', async () => {
    const { db, calls } = fakeDb(routes());
    const res = await buildLiveTab(getTab('zone-performance')!, db, NSM, F(), VERSION);

    expect(res.creditNote).toEqual({
      totalCn: 50, expCn: 30, srCn: 15, pdCn: 5, totalOs: 50,
      cnPct: 5, expCnPct: 3, srCnPct: 1.5, pdCnPct: 0.5, osPct: 5,
    });
    expect([res.meta.cnPctFrom, res.meta.cnPctTo]).toEqual([202604, 202605]);

    const g = res.geoTable!;
    const cnCol = g.columns.indexOf('creditNote');
    expect(g.rows.map((r) => [r[0], r[cnCol], r[cnCol + 1]])).toEqual([
      ['Zone 1', 35, 5],
      ['Zone 2', null, null],
      // Credit notes but no sales rows: still listed, so the column ties to the Total.
      ['Zone 9', 15, null],
    ]);
    expect(g.codes).toEqual(['Z1', 'Z2', 'Z9']);
    expect([g.total[cnCol], g.total[cnCol + 1]]).toEqual([50, 5]);

    const t = res.trends!;
    expect(t.months).toEqual([202604, 202605]);
    expect(t.cnExp).toEqual([20, 10]);
    expect(t.cnSr).toEqual([10, 5]);
    expect(t.cnPd).toEqual([0, 5]);
    expect(t.cnPct).toEqual([5, null]); // May has no gross sales to divide by
    expect(t.disp).toEqual([900, null]);

    expect(res.meta.unavailable.map((u) => u.key)).not.toContain('creditNote.split');
    // The zone grid's CN query is the one that needs the territory lookup.
    expect(calls.filter((c) => c.sql.includes('VW_Credit_Note_Details') && c.sql.includes('t.zone_name'))).toHaveLength(1);
  });

  it('sets only the months with sales against gross sales when the period reaches back before them', async () => {
    const { db, calls } = fakeDb([
      // Jan–Aug: 72 of credit notes, 32 of them from Apr–Aug, when sales exist.
      [/ROLLUP/, [{ date_key: null, ...cnRow(72, 2, 68, 2, { total: 32, exp: 1, sr: 30, pd: 1 }) }]],
      ...routes(),
    ]);
    const res = await buildLiveTab(getTab('credit-note')!, db, NSM, F({ from: 202601, to: 202608 }), VERSION);

    expect(res.creditNote).toMatchObject({ totalCn: 72, expCn: 2, cnPct: 3.2, expCnPct: 0.1, srCnPct: 3 });
    expect([res.meta.cnPctFrom, res.meta.cnPctTo]).toEqual([202604, 202608]);
    const cn = calls.find((c) => c.sql.includes('ROLLUP'))!;
    expect(cn.params).toMatchObject({ gFrom: '202604', gTo: '202608' });
  });

  it('reports no CN% months when the period has no sales at all', async () => {
    const { db } = fakeDb(routes({ gross: null }));
    const res = await buildLiveTab(getTab('credit-note')!, db, NSM, F({ from: 202501, to: 202503 }), VERSION);
    expect([res.meta.cnPctFrom, res.meta.cnPctTo]).toEqual([null, null]);
    expect(res.meta.unavailable.map((u) => u.key)).toContain('creditNote.pct');
  });

  it('reads O/S and inventory as the closing balance of the period\'s last month', async () => {
    const { db, calls } = fakeDb(routes());
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F({ from: 202604, to: 202608 }), VERSION);
    expect(res.creditNote?.totalOs).toBe(50);
    expect(res.inventory?.value).toBe(70);
    const totals = calls.find((c) => c.sql.includes('rcpa_as_of'))!;
    expect(totals.sql).toContain('SUM(CASE WHEN yearMonth = @closeMonth THEN CAST(OS AS DECIMAL(38,6)) END)');
    expect(totals.sql).not.toMatch(/SUM\(CAST\(OS AS/);
    expect(totals.params.closeMonth).toBe('202608');
    // The per-brand grid reads inventory the same way.
    const grid = calls.find((c) => c.sql.includes('AS node_code') && c.sql.includes('AS win'))!;
    expect(grid.sql).toContain('@closeMonth');
    expect(grid.params.closeMonth).toBe('202608');
  });

  it('says why CN% is blank when there are credit notes but no gross sales', async () => {
    const { db } = fakeDb(routes({ gross: null }));
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F(), VERSION);
    expect(res.creditNote?.totalCn).toBe(50);
    expect(res.creditNote?.cnPct).toBeNull();
    expect(res.meta.unavailable.map((u) => u.key)).toContain('creditNote.pct');
  });

  it('serves the Credit note tab its HQ and SKU grids', async () => {
    const { db } = fakeDb([
      [/hq_name/, [{ node_code: 'H1', node_name: 'JAMMU', gross: 1000, ...cnRow(20, 10, 10, 0) }]],
      [/Product_code/, [{ node_code: 401679, node_name: 'WOSULIN', gross: 100, ...cnRow(7, 7) }]],
      ...routes(),
    ]);
    const res = await buildLiveTab(getTab('credit-note')!, db, NSM, F(), VERSION);
    expect(res.cnDetail?.byHq).toEqual([['JAMMU', 'H1', 10, 10, 0, 20, 2]]);
    const [sku] = res.cnDetail!.bySku;
    expect(sku!.slice(0, 6)).toEqual(['WOSULIN', '401679', 7, 0, 0, 7]);
    expect(sku![6]).toBeCloseTo(7, 9);
  });
});
