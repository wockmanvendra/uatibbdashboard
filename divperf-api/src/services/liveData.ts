/**
 * Builds a TabResponse from real query results.
 *
 * This layer shapes and serialises; it does not compute measures. Every ratio
 * comes from lib/metrics.ts applied to sums the database produced (I3/I4), and
 * anything without a source is null rather than invented — the frontend renders
 * an em dash, which is the honest answer. (§7.5)
 */
import type {
  CreditNotePanel, GeoRow, KeyBrandRow, MixPanel, TabResponse, TrendsPanel,
} from '../types/api.js';
import { GEO_COLUMNS, KEY_BRAND_COLUMNS } from '../types/api.js';
import type { TabConfig } from '../tabs/registry.js';
import type { Scope } from '../plugins/scope.js';
import type { Db } from '../data/db.js';
import type { PanelFilters } from '../data/queryBuilder.js';
import { fetchTotals, type Totals } from '../data/panels/totals.js';
import { fetchTrend, type TrendResult } from '../data/panels/trends.js';
import { fetchBreakdown, fetchMix, type NodeBreakdown } from '../data/panels/breakdown.js';
import * as M from '../lib/metrics.js';
import { label, monthCount, priorYear } from '../lib/yrmn.js';
import type { DimensionName } from '../data/sqlFragments.js';

/** Grain -> the hierarchy level its grid groups on. */
const GRAIN_DIMENSION: Record<string, DimensionName> = {
  division: 'division',
  brand: 'brand',
  zone: 'zone',
  region: 'region',
  hq: 'hq',
};

/**
 * Figures with no source. Returned as null rather than omitted so the panels
 * still render their structure and the gap is visible instead of silently absent.
 */
const NO_SOURCE = null;

/**
 * Why each absent thing is absent. Sent to the client so a panel of em dashes
 * explains itself instead of looking like a failure. Every entry disappears
 * once its source exists.
 */
const REASONS = {
  pcpm:
    'There is no field-force headcount source yet, so PCPM (collection per TM per month) is left blank.',
  rcpaPlan:
    'RCPA actual is available, but there is no RCPA plan source, so plan and achievement against plan are left blank.',
  rcpaNone: 'The source has no RCPA values for the selected months.',
  rcpaStale: (asOf: number, to: number) =>
    `RCPA for this selection ends at ${label(asOf)}, earlier than the selected period end (${label(to)}). The figure covers only the months that have RCPA, so it is not comparable with the sales figures beside it.`,
  cnSplit:
    'Credit notes arrive as one total. The Exp / SR / PD split has no source yet.',
  brandColl:
    'Collection has no brand in the source — it is recorded per customer, not per material.',
  geoInventory:
    'Stock and GIT are recorded per plant, not per territory, so inventory cannot be split by zone, region or HQ.',
  priorYear:
    'The source has no sales, target or collection for the prior-year period, so growth on those is left blank. Secondary does cover that period, so its growth is real.',
} as const;

interface Coverage {
  hasPriorSales: boolean;
  rcpaAsOf: number | null;
  to: number;
  /** A zone / region / HQ narrows the data, so plant-level figures cannot apply. */
  geoNarrowed: boolean;
}

function unavailableFor(tab: TabConfig, c: Coverage): TabResponse['meta']['unavailable'] {
  const out: TabResponse['meta']['unavailable'] = [];
  const add = (key: string, label: string, reason: string) => out.push({ key, label, reason });
  const has = (p: string) => tab.panels.includes(p as never);

  if (has('primary') && !c.hasPriorSales) add('growth', 'Gr% on Tgt, Disp and Coll', REASONS.priorYear);
  if (has('pcpm')) add('pcpm', 'PCPM', REASONS.pcpm);

  if (has('rcpa')) {
    add('rcpa', 'RCPA plan and Ach%', REASONS.rcpaPlan);
    if (c.rcpaAsOf === null) add('rcpa.none', 'RCPA', REASONS.rcpaNone);
    else if (c.rcpaAsOf < c.to) add('rcpa.stale', `RCPA is as of ${label(c.rcpaAsOf)}`, REASONS.rcpaStale(c.rcpaAsOf, c.to));
  }

  if (has('inventory') && c.geoNarrowed) add('inventory', 'Inventory', REASONS.geoInventory);
  if (has('creditNote')) add('creditNote.split', 'Exp CN / SRCN / PD CN', REASONS.cnSplit);
  if (has('keyBrands')) add('keyBrands.coll', 'Coll and Ach% by brand', REASONS.brandColl);
  if (has('geoTable') && tab.grain !== 'division' && tab.grain !== 'brand') {
    add('geoTable.inventory', 'Inventory value column', REASONS.geoInventory);
  }
  if (has('mix')) add('mix.coll', 'Coll mix', REASONS.brandColl);
  if (has('cnDetail')) add('cnDetail', 'CN by stockist and SKU', REASONS.cnSplit);
  return out;
}

export async function buildLiveTab(
  tab: TabConfig,
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  openYrMn: number,
  dataVersion: string,
): Promise<TabResponse> {
  const months = monthCount(filters.from, filters.to);
  const needsBreakdown = tab.panels.includes('keyBrands') || tab.panels.includes('geoTable');
  const dimension = GRAIN_DIMENSION[tab.grain] ?? 'division';

  // Every query in parallel. Sequential awaits here are a bug (§7.6), and
  // against Synapse they are the difference between 2 s and 8 s.
  const [totals, trend, breakdown, mix] = await Promise.all([
    fetchTotals(db, scope, filters),
    tab.panels.includes('trends')
      ? fetchTrend(db, scope, filters)
      : Promise.resolve<TrendResult>({ points: [], prior: new Map() }),
    needsBreakdown
      ? fetchBreakdown(db, scope, filters, tab.panels.includes('keyBrands') ? 'brand' : dimension)
      : Promise.resolve([]),
    tab.panels.includes('mix') ? fetchMix(db, scope, filters) : Promise.resolve([]),
  ]);

  const cur = totals.cur;
  const prior = totals.prior;
  const has = (p: string) => tab.panels.includes(p as never);

  // The table is zero-filled, so a prior-year window can have rows but no sales.
  const hasPriorSales = prior !== null && prior.disp !== null;
  const geoNarrowed =
    scope.level === 'ZONE' || scope.level === 'REGION' || scope.level === 'HQ' ||
    filters.zone.length > 0 || filters.region.length > 0 || filters.hq.length > 0;

  const res: TabResponse = {
    meta: {
      tab: tab.id,
      dataVersion,
      from: filters.from,
      to: filters.to,
      monthCount: months,
      effectiveScope: { level: scope.level, nodes: scope.nodes },
      unassignedRows: totals.unassignedRows,
      cached: false,
      queryMs: 0,
      priorFrom: hasPriorSales ? priorYear(filters.from) : null,
      priorTo: hasPriorSales ? priorYear(filters.to) : null,
      unavailable: unavailableFor(tab, {
        hasPriorSales,
        rcpaAsOf: cur?.rcpaAsOf ?? null,
        to: filters.to,
        geoNarrowed,
      }),
    },
  };

  if (has('primary')) {
    res.primary = {
      target: {
        value: cur?.tgt ?? null,
        ach: null,
        gr: M.grPct(cur?.tgt ?? null, prior?.tgt ?? null),
      },
      collection: {
        value: cur?.coll ?? null,
        ach: M.achPct(cur?.coll ?? null, cur?.tgt ?? null),
        gr: M.grPct(cur?.coll ?? null, prior?.coll ?? null),
      },
      dispatch: {
        value: cur?.disp ?? null,
        ach: M.achPct(cur?.disp ?? null, cur?.tgt ?? null),
        gr: M.grPct(cur?.disp ?? null, prior?.disp ?? null),
      },
    };
  }

  // No headcount source yet: PCPM is left blank.
  if (has('pcpm')) {
    res.pcpm = { budgetTm: NO_SOURCE, pcpmCollection: NO_SOURCE };
  }

  if (has('secondary')) {
    res.secondary = {
      value: cur?.sec ?? null,
      grPct: M.grPct(cur?.sec ?? null, prior?.sec ?? null),
    };
  }

  if (has('rcpa')) {
    res.rcpa = {
      plan: NO_SOURCE,
      actual: cur?.rcpa ?? null,
      achPct: NO_SOURCE,
      grPct: M.grPct(cur?.rcpa ?? null, prior?.rcpa ?? null),
    };
  }

  if (has('inventory')) {
    // Stock sits on plant rows with no territory, so a territory-narrowed
    // figure would be a small, misleading fraction of the real one.
    res.inventory = { value: geoNarrowed ? NO_SOURCE : (cur?.inventory ?? null) };
  }

  if (has('creditNote')) {
    res.creditNote = creditNote(cur);
  }

  if (has('keyBrands')) {
    res.keyBrands = {
      columns: KEY_BRAND_COLUMNS,
      // The grid is a reading aid, not an export: 25 rows is already more than
      // anyone scans in a review meeting, and the CSV export carries the rest.
      rows: breakdown.slice(0, 25).map(keyBrandRow),
    };
  }

  if (has('geoTable')) {
    res.geoTable = geoTable(tab.grain, breakdown, cur, prior, geoNarrowed);
  }

  if (has('trends')) {
    res.trends = trends(trend, tab.trendSeries);
  }

  if (has('mix')) {
    res.mix = mixPanel(mix, tab.mixDimension);
  }

  if (has('cnDetail')) {
    // Stockist- and SKU-level CN needs the split feed, which has no source yet.
    // Empty grids, not invented rows.
    res.cnDetail = {
      columns: ['name', 'code', 'expCn', 'srCn', 'pdCn', 'totalCn', 'cnPct'],
      byStockist: [],
      bySku: [],
    };
  }

  void openYrMn;
  return res;
}

function creditNote(cur: Totals | null): CreditNotePanel {
  // CR_NOTES is a single total and cannot be split into Exp / SR / PD.
  return {
    totalCn: cur?.cn ?? null,
    expCn: NO_SOURCE,
    srCn: NO_SOURCE,
    pdCn: NO_SOURCE,
    totalOs: cur?.os ?? null,
    cnPct: M.cnPct(cur?.cn ?? null, cur?.gross ?? null),
    expCnPct: NO_SOURCE,
    srCnPct: NO_SOURCE,
    pdCnPct: NO_SOURCE,
    osPct: M.cnPct(cur?.os ?? null, cur?.gross ?? null),
  };
}

function keyBrandRow(n: NodeBreakdown): KeyBrandRow {
  return [
    n.name,
    n.tgt,
    n.disp,
    // Collection has no brand grain — it is customer-level. Every brand row
    // would carry 0, which reads as "collected nothing" rather than "not
    // available", so it is null.
    NO_SOURCE,
    NO_SOURCE,
    M.grPct(n.disp, n.priorDisp),
    n.sec,
    n.inventory,
    n.rcpa,
  ];
}

function geoTable(
  grain: TabConfig['grain'],
  nodes: NodeBreakdown[],
  cur: Totals | null,
  prior: Totals | null,
  geoNarrowed: boolean,
) {
  let onTarget = 0;
  let growing = 0;
  let degrowing = 0;
  // Inventory is plant-level: it splits by division and brand, never by geography.
  const inventoryApplies = grain === 'division' || grain === 'brand';

  const rows: GeoRow[] = nodes.map((n) => {
    const achColl = M.achPct(n.coll, n.tgt);
    const dispGr = M.grPct(n.disp, n.priorDisp);
    if (achColl !== null && achColl >= 100) onTarget++;
    if (dispGr !== null && dispGr > 0) growing++;
    if (dispGr !== null && dispGr < 0) degrowing++;

    return [
      n.name,
      n.tgt,
      n.disp,
      dispGr,
      n.coll,
      achColl,
      M.grPct(n.coll, n.priorColl),
      NO_SOURCE, // PCPM — no headcount source
      n.cn,
      M.cnPct(n.cn, n.gross),
      n.sec,
      inventoryApplies ? n.inventory : NO_SOURCE,
      n.rcpa,
      M.rcpaPctToSec(n.rcpa, n.sec),
    ] as GeoRow;
  });

  // The Total row comes from the rollup, not from summing the rows: a ratio on
  // the total must be computed from the summed numerator and denominator, never
  // averaged across rows. (I4)
  const total: GeoRow = [
    'Total',
    cur?.tgt ?? null,
    cur?.disp ?? null,
    M.grPct(cur?.disp ?? null, prior?.disp ?? null),
    cur?.coll ?? null,
    M.achPct(cur?.coll ?? null, cur?.tgt ?? null),
    M.grPct(cur?.coll ?? null, prior?.coll ?? null),
    NO_SOURCE,
    cur?.cn ?? null,
    M.cnPct(cur?.cn ?? null, cur?.gross ?? null),
    cur?.sec ?? null,
    geoNarrowed ? NO_SOURCE : (cur?.inventory ?? null),
    cur?.rcpa ?? null,
    M.rcpaPctToSec(cur?.rcpa ?? null, cur?.sec ?? null),
  ];

  return {
    grain,
    columns: GEO_COLUMNS,
    codes: nodes.map((n) => n.code),
    rows,
    total,
    onTargetCount: onTarget,
    growingCount: growing,
    degrowingCount: degrowing,
  };
}

function trends({ points, prior }: TrendResult, series: string[]): TrendsPanel {
  const want = new Set(series);
  const out: TrendsPanel = {
    months: points.map((p) => p.yrMn),
    labels: points.map((p) => label(p.yrMn)),
  };
  if (want.has('disp')) out.disp = points.map((p) => p.disp);
  if (want.has('sec')) out.sec = points.map((p) => p.sec);
  if (want.has('rcpa')) out.rcpa = points.map((p) => p.rcpa);
  if (want.has('tgt')) out.tgt = points.map((p) => p.tgt);
  if (want.has('coll')) out.coll = points.map((p) => p.coll);
  if (want.has('achPct')) out.achPct = points.map((p) => M.achPct(p.coll, p.tgt));
  if (want.has('grPct')) {
    out.grPct = points.map((p) => M.grPct(p.disp, prior.get(priorYear(p.yrMn))?.disp ?? null));
  }
  if (want.has('cnPct')) out.cnPct = points.map((p) => M.cnPct(p.cn, p.gross));
  // pcpm / rcpaPlan / rcpaActual / valuePerDr / cnExp / cnSr / cnPd are omitted
  // entirely: their sources do not exist, and a series of nulls would draw an
  // empty axis rather than communicating "not available".
  return out;
}

function mixPanel(
  slices: Awaited<ReturnType<typeof fetchMix>>,
  dimension: MixPanel['dimension'],
): MixPanel {
  return {
    dimension,
    labels: slices.map((s) => s.label),
    disp: slices.map((s) => s.disp),
    // Collection carries no brand, so a per-group split is not derivable.
    coll: slices.map(() => NO_SOURCE),
    sec: slices.map((s) => s.sec),
    rcpa: slices.map((s) => s.rcpa),
  };
}
