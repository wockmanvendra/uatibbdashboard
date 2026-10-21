import { describe, expect, it } from 'vitest';
import { makeScope } from '../plugins/scope.js';
import type { PanelFilters } from '../data/queryBuilder.js';
import { buildLiveTab } from './liveData.js';
import { getTab } from '../tabs/registry.js';
import { fakeDb } from '../test/fakeDb.js';

const F = (over: Partial<PanelFilters> = {}): PanelFilters => ({
  from: 202601, to: 202603, division: [], brand: [], zone: [], region: [], hq: [], ...over,
});
const NSM = makeScope('DIVISION', ['85']);
const VERSION = { dataVersion: 'v1', salesFrom: 202604, salesTo: 202609, rxFrom: 202601, rxTo: 202601, effortFrom: 202608, effortTo: 202609 };
const base = { tgt: null, disp: null, gross: null, coll: null, os: null, inventory: null, sec: null, rcpa: null, src_rows: 1 };

describe('Rx, Rxber, P/D', () => {
  it('averages prescribers over the months with Rx data, and divides Rx by them', async () => {
    const { db, calls } = fakeDb([
      // Jan–Mar: Rx in two months, 3,000 prescriptions from 500 + 600 prescribers.
      [/rcpa_as_of/, [
        { win: 'cur', ...base, rxns: 3000, rxber: 1100, rx_months: 2, rx_from: 202601, rx_to: 202602, rcpa_as_of: null },
        { win: 'prior', ...base, rxns: 2000, rxber: 1000, rx_months: 2, rx_from: 202501, rx_to: 202502, rcpa_as_of: null },
      ]],
      [/AS date_key/, [
        { date_key: 202601, ...base, rxns: 1400, rxber: 500, rx_months: 1 },
        { date_key: 202602, ...base, rxns: 1600, rxber: 600, rx_months: 1 },
        { date_key: 202603, ...base, rxns: null, rxber: null, rx_months: 0 },
      ]],
    ]);
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F(), VERSION);

    expect(res.rx!.rxns).toEqual({ value: 3000, gr: 50 });
    expect(res.rx!.rxber.value).toBe(550); // 1,100 prescriber-months over 2 months
    expect(res.rx!.rxber.gr).toBeCloseTo(10, 9); // vs 500 a month a year earlier
    // P/D/M = Rxns ÷ Rxber as shown: 3,000 ÷ 550, against 2,000 ÷ 500 a year earlier.
    expect(res.rx!.pdm.value).toBeCloseTo(3000 / 550, 9);
    expect(res.rx!.pdm.gr).toBeCloseTo(((3000 / 550) / (2000 / 500) - 1) * 100, 9);
    expect([res.rx!.from, res.rx!.to]).toEqual([202601, 202602]);

    expect(res.trends!.rxns).toEqual([1400, 1600, null]);
    expect(res.trends!.rxber).toEqual([500, 600, null]);
    expect(res.trends!.rxPd![0]).toBeCloseTo(2.8, 9);
    expect(res.trends!.rxPd![2]).toBeNull();
    expect(res.meta.unavailable.map((u) => u.key)).not.toContain('rx');

    const totals = calls.find((c) => c.sql.includes('rcpa_as_of'))!.sql;
    expect(totals).toContain('COUNT(DISTINCT CASE WHEN DR_TOT <> 0 THEN yearMonth END) AS rx_months');
    expect(totals).toContain('MIN(CASE WHEN DR_TOT <> 0 THEN CAST(yearMonth AS INT) END) AS rx_from');
  });

  it('names the months the source has Rx for when the period has none', async () => {
    const { db } = fakeDb([
      [/rcpa_as_of/, [{ win: 'cur', ...base, rxns: null, rxber: null, rx_months: 0, rx_from: null, rx_to: null, rcpa_as_of: null }]],
    ]);
    const res = await buildLiveTab(getTab('division-performance')!, db, NSM, F({ from: 202604, to: 202608 }), VERSION);
    expect(res.rx).toEqual({
      rxns: { value: null, gr: null },
      rxber: { value: null, gr: null },
      pdm: { value: null, gr: null },
      from: null,
      to: null,
    });
    expect(res.meta.unavailable.find((u) => u.key === 'rx')?.reason).toBe(
      'The source has Rx (prescription) data for Jan-26 only, so there is none for the selected period.',
    );
  });
});
