import { describe, expect, it } from 'vitest';
import { makeScope } from '../../plugins/scope.js';
import type { PanelFilters } from '../queryBuilder.js';
import { fetchBrandTotals } from './breakdown.js';
import { buildLiveTab } from '../../services/liveData.js';
import { getTab } from '../../tabs/registry.js';
import { fakeDb } from '../../test/fakeDb.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202604, to: 202609, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const NSM = makeScope('DIVISION', ['85']);

// Division 85: secondary and RCPA under their own brand names.
const ROWS = [
  { brand: 'WOSULIN CTG', sec: null, rcpa: null }, // a dispatch name: no secondary or RCPA
  { brand: 'GLARITUS CART', sec: '90370000.00', rcpa: '118860000.00' },
  { brand: 'WOSULIN CART', sec: '176580000.00', rcpa: '152810000.00' },
  { brand: 'GLIMADAY', sec: '14220000.00', rcpa: '36270000.00' },
  { brand: 'WOSULIN 10ML', sec: '68550000.00', rcpa: '0.00' },
];

describe('Secondary and RCPA mix', () => {
  it('lists every brand with a value, largest first, with no "Others"', async () => {
    const { db } = fakeDb([[/AS brand/, ROWS]]);
    const t = await fetchBrandTotals(db, NSM, F());

    expect(t.sec.map((s) => s.label)).toEqual(['WOSULIN CART', 'GLARITUS CART', 'WOSULIN 10ML', 'GLIMADAY']);
    expect(t.sec[0]!.value).toBe(176_580_000);
    expect(t.rcpa.map((s) => s.label)).toEqual(['WOSULIN CART', 'GLARITUS CART', 'GLIMADAY']);
  });

  it('groups by brand under the scope and the brand filter', async () => {
    const { db, calls } = fakeDb([[/AS brand/, []]]);
    await fetchBrandTotals(db, NSM, F({ brand: ['WOSULIN CART'] }));
    const { sql, params } = calls[0]!;

    expect(sql).toMatch(/GROUP BY NULLIF\(LTRIM\(RTRIM\(Brand\)\), ''\)/);
    expect(sql).toContain("NULLIF(LTRIM(RTRIM(Brand)), '') IS NOT NULL");
    expect(Object.values(params)).toEqual(expect.arrayContaining(['85', 'WOSULIN CART']));
  });

  it('gives each pie its own slices on the tab', async () => {
    const { db } = fakeDb([
      [/AS brand/, ROWS],
      [/top_brand/, [{ grp: 'WOSULIN CTG', disp: '175000000.00' }, { grp: 'Others', disp: '90000000.00' }]],
    ]);
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F(), {
      dataVersion: 'v1', salesFrom: 202604, salesTo: 202609, rxFrom: 202601, rxTo: 202601,
      effortFrom: 202608, effortTo: 202609,
    });

    expect(res.mix!.disp.labels).toEqual(['WOSULIN CTG', 'Others']);
    expect(res.mix!.coll.values).toEqual([null, null]); // no coll_mat in these rows
    expect(res.mix!.sec.labels).toEqual(['WOSULIN CART', 'GLARITUS CART', 'WOSULIN 10ML', 'GLIMADAY']);
    expect(res.mix!.rcpa.values).toEqual([152_810_000, 118_860_000, 36_270_000]);
  });
});

describe('collection by brand', () => {
  const VERSION = {
    dataVersion: 'v1', salesFrom: 202604, salesTo: 202609, rxFrom: 202601, rxTo: 202601,
    effortFrom: 202608, effortTo: 202609,
  };
  const base = { gross: null, os: null, inventory: null, sec: null, rcpa: null, rxns: null, rxber: null, rx_months: 0, src_rows: 1 };

  it('uses COLLECTION_MATERIAL for the Coll pie, the Key Brands rows and their Total', async () => {
    const { db, calls } = fakeDb([
      [/rcpa_as_of/, [{ win: 'cur', ...base, tgt: 450_000_000, disp: 421_000_000, coll: 419_680_000, coll_mat: 399_610_000, rcpa_as_of: null }]],
      [/top_brand/, [
        { grp: 'WOSULIN CTG', disp: '143500000.00', coll: null, coll_mat: '142010000.00' },
        { grp: 'Others', disp: '277500000.00', coll: '419680000.00', coll_mat: '257600000.00' },
      ]],
      [/AS node_code/, [{ win: 'cur', node_code: 'WOSULIN CTG', node_name: 'WOSULIN CTG', ...base, tgt: 150_000_000, disp: 143_500_000, coll: null, coll_mat: 142_010_000 }]],
    ]);
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F(), VERSION);

    expect(res.mix!.coll).toEqual({ labels: ['WOSULIN CTG', 'Others'], values: [142_010_000, 257_600_000] });
    expect(res.mix!.collNote).toContain('net of GST');

    const row = res.keyBrands!.rows[0]!;
    expect(row[3]).toBe(142_010_000);
    expect(row[4]).toBeCloseTo((142_010_000 / 150_000_000) * 100, 9);
    expect(res.keyBrands!.total![3]).toBe(399_610_000);
    expect(res.keyBrands!.note).toContain('COLLECTION_MATERIAL');
    // The KPI keeps total collection.
    expect(res.primary!.collection.value).toBe(419_680_000);
    // Nothing about brand collection is reported missing any more.
    expect(res.meta.unavailable.map((u) => u.key)).not.toContain('keyBrands.coll');

    expect(calls.find((c) => c.sql.includes('rcpa_as_of'))!.sql).toContain('COLLECTION_MATERIAL');
  });
});
