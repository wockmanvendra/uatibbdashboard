/**
 * Builds a TabResponse from real query results.
 *
 * This layer shapes and serialises; it does not compute measures. Every ratio
 * comes from lib/metrics.ts applied to sums the database produced (I3/I4), and
 * anything without a source is null rather than invented — the frontend renders
 * an em dash, which is the honest answer. (§7.5)
 */
import type {
  CreditNotePanel, EffortPanel, GeoRow, HospitalPanel, KeyBrandRow, MixPanel, RxPanel, StockistRow,
  StockistTablePanel, TabResponse, TrendsPanel,
} from '../types/api.js';
import { CN_DETAIL_COLUMNS, GEO_COLUMNS, KEY_BRAND_COLUMNS, STOCKIST_COLUMNS } from '../types/api.js';
import type { TabConfig } from '../tabs/registry.js';
import type { Scope } from '../plugins/scope.js';
import type { Db } from '../data/db.js';
import type { PanelFilters } from '../data/queryBuilder.js';
import { fetchTotals, type Totals } from '../data/panels/totals.js';
import { fetchTrend, type TrendPoint, type TrendResult } from '../data/panels/trends.js';
import {
  fetchBrandTotals, fetchBreakdown, fetchMix, type BrandTotals, type NodeBreakdown,
} from '../data/panels/breakdown.js';
import {
  NO_CN, fetchCnBreakdown, fetchCnByMonth, fetchCnDetail,
  type CnAmounts, type CnByMonth, type CnDetail, type CnFigures, type CnGrain, type CnNode, type SalesMonths,
} from '../data/panels/creditNotes.js';
import type { DataVersion } from './versionService.js';
import { fetchManpower, manpowerScope, type ManpowerResult, type ManpowerScope } from '../data/panels/manpower.js';
import { effortScope, fetchEffort, type EffortScope } from '../data/panels/effort.js';
import { fetchMissedSummary, type MissedSummary } from '../data/panels/missedDoctors.js';
import { fetchHospitals, hospitalDivisions } from '../data/panels/hospitals.js';
import { fetchHeadcount, type Headcount, type HeadcountGrain } from '../data/panels/headcount.js';
import { fetchStockists, type StockistFigures } from '../data/panels/stockists.js';
import { config } from '../config.js';
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
    'No TMs in place are recorded for this selection in Infinity.vw_emp_count, so PCPM (collection per TM per month) is left blank.',
  pcpmBrand:
    'Collection has no brand in the source, so PCPM is left blank for a brand selection. Budget TM covers the whole selected geography.',
  effortBrand:
    'Doctor coverage and calls are not tracked by brand, so the effort figures cover the whole selected geography.',
  effortUnmapped: (divisions: string[]) =>
    `The effort data names divisions rather than coding them, and no name is mapped to ${divisions.length === 1 ? 'division' : 'divisions'} ${divisions.join(', ')} yet (EFFORT_DIVISIONS), so ${divisions.length === 1 ? 'its' : 'their'} effort is not shown.`,
  effortNone: (from: number | null, to: number | null) =>
    from === null || to === null
      ? 'The effort data has no months yet.'
      : `The effort data covers ${from === to ? label(from) : `${label(from)} – ${label(to)}`} only, so there is none for the selected period.`,
  hospitalCoverage:
    'The hospital master list records no visits, and the effort data no hospital visits yet, so hospitals covered and missed are left blank.',
  effortNoSource:
    'The effort data has no count of doctors met or missed at the right frequency, or of A+ doctors, so those are left blank.',
  rcpaPlan:
    'RCPA actual is available, but there is no RCPA plan source, so plan and achievement against plan are left blank.',
  rcpaNone: 'The source has no RCPA values for the selected months.',
  rcpaStale: (asOf: number, to: number) =>
    `RCPA for this selection ends at ${label(asOf)}, earlier than the selected period end (${label(to)}). The figure covers only the months that have RCPA, so it is not comparable with the sales figures beside it.`,
  cnPct:
    'Credit notes cover this period, but the source has no gross sales for it, so CN% is left blank.',
  brandCollNote:
    'Collection by brand is the product-level split of collection (COLLECTION_MATERIAL), net of GST — about 5% below total collection.',
  geoInventory:
    'Stock and GIT are recorded per plant, not per territory, so inventory cannot be split by zone, region or HQ.',
  priorYear:
    'The source has no sales, target or collection for the prior-year period, so growth on those is left blank. Secondary does cover that period, so its growth is real.',
  manpowerGeo:
    'The HR exit and hiring views carry a cost centre, not a zone, region or HQ, so attrition and new joiners are shown for whole divisions only.',
  manpowerBrand: 'People are not tracked by brand, so attrition and new joiners do not apply to a brand selection.',
  manpowerUnmapped: (divisions: string[]) =>
    `The HR views identify a division only by cost centre, and no cost centre is mapped to ${divisions.length === 1 ? 'division' : 'divisions'} ${divisions.join(', ')} yet, so its leavers and joiners cannot be picked out.`,
  rxNone: (from: number | null, to: number | null) =>
    from === null || to === null
      ? 'The source has no Rx (prescription) data yet.'
      : `The source has Rx (prescription) data for ${from === to ? label(from) : `${label(from)} – ${label(to)}`} only, so there is none for the selected period.`,
} as const;

interface Coverage {
  hasPriorSales: boolean;
  /** Credit notes exist in the period but gross sales do not, so CN% cannot be had. */
  cnWithoutGross: boolean;
  rcpaAsOf: number | null;
  to: number;
  /** A zone / region / HQ narrows the data, so plant-level figures cannot apply. */
  geoNarrowed: boolean;
  manpower: ManpowerScope;
  /** Months of the period with Rx data, and the source's whole Rx span. */
  rxMonths: number;
  rxSource: { from: number | null; to: number | null };
  brandFiltered: boolean;
  /** PCPM has collection to divide but no TMs to divide it by. */
  pcpmNoTms: boolean;
  effort: EffortScope;
  /** Months of the period with effort data, and the source's whole effort span. */
  effortMonths: number;
  effortSource: { from: number | null; to: number | null };
  /** The hospital section is shown, and visits are not recorded for it. */
  hospitalsWithoutVisits: boolean;
}

function unavailableFor(tab: TabConfig, c: Coverage): TabResponse['meta']['unavailable'] {
  const out: TabResponse['meta']['unavailable'] = [];
  const add = (key: string, label: string, reason: string) => out.push({ key, label, reason });
  const has = (p: string) => tab.panels.includes(p as never);

  if (has('primary') && !c.hasPriorSales) add('growth', 'Gr% on Tgt, Disp and Coll', REASONS.priorYear);
  if (has('pcpm') && c.brandFiltered) add('pcpm', 'PCPM', REASONS.pcpmBrand);
  else if (has('pcpm') && c.pcpmNoTms) add('pcpm', 'PCPM', REASONS.pcpm);

  if (has('rcpa')) {
    add('rcpa', 'RCPA plan and Ach%', REASONS.rcpaPlan);
    if (c.rcpaAsOf === null) add('rcpa.none', 'RCPA', REASONS.rcpaNone);
    else if (c.rcpaAsOf < c.to) add('rcpa.stale', `RCPA is as of ${label(c.rcpaAsOf)}`, REASONS.rcpaStale(c.rcpaAsOf, c.to));
  }

  if (has('inventory') && c.geoNarrowed) add('inventory', 'Inventory', REASONS.geoInventory);
  if (has('creditNote') && c.cnWithoutGross) add('creditNote.pct', 'CN%', REASONS.cnPct);
  if (has('geoTable') && tab.grain !== 'division' && tab.grain !== 'brand') {
    add('geoTable.inventory', 'Inventory value column', REASONS.geoInventory);
  }
  if (has('rx') && c.rxMonths === 0) add('rx', 'Rx, Rxber, P/D', REASONS.rxNone(c.rxSource.from, c.rxSource.to));
  if (has('effort')) {
    if (!c.effort.ok) add('effort', 'Effort', REASONS.effortUnmapped(c.effort.unmapped));
    else {
      if (c.effortMonths === 0) add('effort', 'Effort', REASONS.effortNone(c.effortSource.from, c.effortSource.to));
      if (c.effort.unmapped.length) add('effort.unmapped', 'Effort', REASONS.effortUnmapped(c.effort.unmapped));
      if (c.brandFiltered) add('effort.brand', 'Effort by brand', REASONS.effortBrand);
      add('effort.noSource', 'A+, Drs Met with Rt Frq, Missed with Rt Frq', REASONS.effortNoSource);
    }
  }
  if (has('hospitals') && c.hospitalsWithoutVisits) add('hospitals.coverage', 'Hospitals covered and missed', REASONS.hospitalCoverage);
  if (has('manpower')) {
    const m = c.manpower;
    if (!m.ok) {
      add(
        'manpower',
        'Attrition and new joiners',
        m.why === 'geo' ? REASONS.manpowerGeo : m.why === 'brand' ? REASONS.manpowerBrand : REASONS.manpowerUnmapped(m.divisions),
      );
    }
  }
  return out;
}

export async function buildLiveTab(
  tab: TabConfig,
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  version: Pick<DataVersion, 'dataVersion' | 'salesFrom' | 'salesTo' | 'rxFrom' | 'rxTo' | 'effortFrom' | 'effortTo'>,
): Promise<TabResponse> {
  const months = monthCount(filters.from, filters.to);
  // The part of the period the sales table has sales for: CN% counts only
  // these months' credit notes. Null when the period has none.
  const salesMonths: SalesMonths | null =
    version.salesFrom === null || version.salesTo === null
      ? null
      : {
          from: Math.max(filters.from, version.salesFrom),
          to: Math.min(filters.to, version.salesTo),
        };
  const pctMonths = salesMonths && salesMonths.from <= salesMonths.to ? salesMonths : null;
  const needsBreakdown = tab.panels.includes('keyBrands') || tab.panels.includes('geoTable');
  const dimension = GRAIN_DIMENSION[tab.grain] ?? 'division';

  // Every query in parallel. Sequential awaits here are a bug (§7.6), and
  // against Synapse they are the difference between 2 s and 8 s.
  const has = (p: string) => tab.panels.includes(p as never);
  const cnGrain: CnGrain | null =
    tab.grain === 'zone' || tab.grain === 'region' || tab.grain === 'hq' || tab.grain === 'division'
      ? tab.grain
      : null;
  const noCnMonths: CnByMonth = { total: NO_CN, byMonth: new Map() };
  const people = manpowerScope(scope, filters, config.HR_DIVISION_COST_CENTRES);
  const effortView = effortScope(scope, filters, config.EFFORT_DIVISIONS);
  // Hospitals: RESEARCH only — the view must include a division with a hospital list.
  const hospitalDivs = has('hospitals') ? hospitalDivisions(scope, filters, config.HOSPITAL_DIVISIONS) : [];
  // Headcount per node only where a grid shows a PCPM column.
  const headcountGrain: HeadcountGrain | null =
    has('geoTable') && tab.grain !== 'brand' ? (tab.grain as HeadcountGrain) : null;

  const [totals, trend, breakdown, mix, brandTotals, cnMonths, cnNodes, cnDetail, manpower, headcount, effort, missed, hospitals, stockists] = await Promise.all([
    fetchTotals(db, scope, filters),
    tab.panels.includes('trends')
      ? fetchTrend(db, scope, filters)
      : Promise.resolve<TrendResult>({ points: [], prior: new Map() }),
    needsBreakdown
      ? fetchBreakdown(db, scope, filters, tab.panels.includes('keyBrands') ? 'brand' : dimension)
      : Promise.resolve([]),
    tab.panels.includes('mix') ? fetchMix(db, scope, filters) : Promise.resolve([]),
    tab.panels.includes('mix')
      ? fetchBrandTotals(db, scope, filters)
      : Promise.resolve<BrandTotals>({ sec: [], rcpa: [] }),
    // Credit notes come from their own view.
    has('creditNote') || has('trends') || has('geoTable')
      ? fetchCnByMonth(db, scope, filters, pctMonths)
      : Promise.resolve(noCnMonths),
    has('geoTable') && cnGrain
      ? fetchCnBreakdown(db, scope, filters, cnGrain, pctMonths)
      : Promise.resolve(new Map<string, CnNode>()),
    has('cnDetail')
      ? fetchCnDetail(db, scope, filters, pctMonths)
      : Promise.resolve<CnDetail>({ byHq: [], bySku: [] }),
    // Leavers and joiners come from the SAP HR views.
    has('manpower') && people.ok
      ? fetchManpower(db, filters, people.costCentres)
      : Promise.resolve<ManpowerResult | null>(null),
    // Budget TM and PCPM's TMs from the headcount tables.
    has('pcpm') || has('geoTable')
      ? fetchHeadcount(db, scope, filters, headcountGrain)
      : Promise.resolve<Headcount | null>(null),
    // Doctor coverage and calls from the effort data.
    has('effort') && effortView.ok
      ? fetchEffort(db, scope, filters, config.EFFORT_DIVISIONS)
      : Promise.resolve<EffortPanel | null>(null),
    // Missed doctors (tmVisitCounts = 0) from the visit summary.
    has('effort') && effortView.ok
      ? fetchMissedSummary(db, scope, filters)
      : Promise.resolve<MissedSummary | null>(null),
    // The hospital master list, and hospital visits from the effort data.
    hospitalDivs.length
      ? fetchHospitals(db, scope, filters, hospitalDivs, config.EFFORT_DIVISIONS)
      : Promise.resolve<HospitalPanel | null>(null),
    // Stockist-wise sales from the sales table's stockist columns.
    has('stockistTable') ? fetchStockists(db, scope, filters) : Promise.resolve<StockistFigures[]>([]),
  ]);

  const cur = totals.cur;
  const prior = totals.prior;
  const cn = cnMonths.total;

  // The table is zero-filled, so a prior-year window can have rows but no sales.
  const hasPriorSales = prior !== null && prior.disp !== null;
  const geoNarrowed =
    scope.level === 'ZONE' || scope.level === 'REGION' || scope.level === 'HQ' ||
    filters.zone.length > 0 || filters.region.length > 0 || filters.hq.length > 0;
  const brandFiltered = filters.brand.length > 0;
  // Collection has no brand, so neither has PCPM.
  const pcpmOf = (coll: number | null, tms: number | null | undefined, n: number) =>
    brandFiltered ? null : M.pcpm(coll, tms ?? null, n);

  const res: TabResponse = {
    meta: {
      tab: tab.id,
      dataVersion: version.dataVersion,
      from: filters.from,
      to: filters.to,
      monthCount: months,
      effectiveScope: { level: scope.level, nodes: scope.nodes },
      unassignedRows: totals.unassignedRows,
      cached: false,
      queryMs: 0,
      builtAt: new Date().toISOString(),
      refreshing: false,
      priorFrom: hasPriorSales ? priorYear(filters.from) : null,
      priorTo: hasPriorSales ? priorYear(filters.to) : null,
      cnPctFrom: pctMonths?.from ?? null,
      cnPctTo: pctMonths?.to ?? null,
      unavailable: unavailableFor(tab, {
        hasPriorSales,
        cnWithoutGross: cn.total !== null && (cur?.gross ?? null) === null,
        manpower: people,
        rxMonths: cur?.rxMonths ?? 0,
        rxSource: { from: version.rxFrom, to: version.rxTo },
        brandFiltered,
        pcpmNoTms: !brandFiltered && (cur?.coll ?? null) !== null && !headcount?.tms,
        effort: effortView,
        effortMonths: effort?.months.length ?? 0,
        effortSource: { from: version.effortFrom, to: version.effortTo },
        hospitalsWithoutVisits: !!hospitals && !hospitals.months.some((m) => m.covered !== null),
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

  // PCPM (Coll) = collection ÷ TMs in place ÷ months selected.
  if (has('pcpm')) {
    res.pcpm = {
      budgetTm: headcount?.budgetTm ?? null,
      pcpmCollection: pcpmOf(cur?.coll ?? null, headcount?.tms, months),
    };
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
    res.creditNote = creditNote(cur, cn);
  }

  if (has('keyBrands')) {
    res.keyBrands = {
      columns: KEY_BRAND_COLUMNS,
      // The grid is a reading aid, not an export: 25 rows is already more than
      // anyone scans in a review meeting, and the CSV export carries the rest.
      rows: breakdown.slice(0, 25).map(keyBrandRow),
      // From the rollup, never from summing rows. (I3)
      total: [
        'Total',
        cur?.tgt ?? null,
        cur?.disp ?? null,
        cur?.collMat ?? null,
        M.achPct(cur?.collMat ?? null, cur?.tgt ?? null),
        M.grPct(cur?.disp ?? null, prior?.disp ?? null),
        cur?.sec ?? null,
        cur?.inventory ?? null,
        cur?.rcpa ?? null,
      ],
      note: REASONS.brandCollNote,
    };
  }

  if (has('geoTable')) {
    res.geoTable = geoTable(tab.grain, breakdown, cur, prior, geoNarrowed, cnNodes, cn, (code, coll) =>
      code === null
        ? pcpmOf(coll, headcount?.tms, months)
        : pcpmOf(coll, headcount?.byNode.get(code)?.tms, months),
    );
  }

  if (has('trends')) {
    // Headcount has no month: each month's PCPM divides by the TMs in place today.
    res.trends = trends(trend, tab.trendSeries, cnMonths, manpower, (coll) => pcpmOf(coll, headcount?.tms, 1));
  }

  if (has('mix')) {
    res.mix = mixPanel(mix, brandTotals, tab.mixDimension);
  }

  if (has('manpower')) {
    res.manpower = manpower?.panel ?? null;
  }

  if (has('rx')) {
    res.rx = rxPanel(cur, prior);
  }

  if (has('effort')) {
    res.effort = effort && withMissed(effort, missed);
  }

  if (has('stockistTable')) {
    res.stockistTable = stockistTable(stockists, cur, prior);
  }

  if (has('hospitals')) {
    res.hospitals = hospitals;
  }

  if (has('cnDetail')) {
    res.cnDetail = { columns: CN_DETAIL_COLUMNS, ...cnDetail };
  }

  return res;
}

/**
 * Drs Missed from the visit summary: the period's count, each month's, and the
 * split by category. A period without visit data keeps them blank.
 */
function withMissed(effort: EffortPanel, missed: MissedSummary | null): EffortPanel {
  if (!missed || missed.total === 0) return { ...effort, missedByCategory: null };
  return {
    ...effort,
    total: { ...effort.total, drsMissed: missed.total },
    months: effort.months.map((m) => ({ ...m, drsMissed: missed.byMonth.get(m.yrMn) ?? null })),
    missedByCategory: {
      labels: missed.byCategory.map((c) => c.label),
      values: missed.byCategory.map((c) => c.value),
    },
  };
}

function creditNote(cur: Totals | null, cn: CnFigures): CreditNotePanel {
  // Credit notes from their view; closing O/S and the gross-sales denominator
  // from the sales table. Each % sets only the months with sales against them.
  const gross = cur?.gross ?? null;
  return {
    totalCn: cn.total,
    expCn: cn.exp,
    srCn: cn.sr,
    pdCn: cn.pd,
    totalOs: cur?.os ?? null,
    cnPct: M.cnPct(cn.forPct.total, gross),
    expCnPct: M.cnPct(cn.forPct.exp, gross),
    srCnPct: M.cnPct(cn.forPct.sr, gross),
    pdCnPct: M.cnPct(cn.forPct.pd, gross),
    osPct: M.cnPct(cur?.os ?? null, gross),
  };
}

/**
 * Rx, Rxber, P/D for the period. Rxber is a monthly count of prescribers, so a
 * period's figure is its per-month average over the months with Rx data; P/D/M
 * is Rxns ÷ Rxber — the two figures shown beside it. Growth compares each with
 * the same months a year earlier.
 */
function rxPanel(cur: Totals | null, prior: Totals | null): RxPanel {
  const rxber = (t: Totals | null) => M.prescribersPerMonth(t?.rxber ?? null, t?.rxMonths ?? 0);
  const pdm = (t: Totals | null) => M.perPrescriber(t?.rxns ?? null, rxber(t));
  return {
    rxns: { value: cur?.rxns ?? null, gr: M.grPct(cur?.rxns ?? null, prior?.rxns ?? null) },
    rxber: { value: rxber(cur), gr: M.grPct(rxber(cur), rxber(prior)) },
    pdm: { value: pdm(cur), gr: M.grPct(pdm(cur), pdm(prior)) },
    from: cur?.rxFrom ?? null,
    to: cur?.rxTo ?? null,
  };
}

function stockistTable(stockists: StockistFigures[], cur: Totals | null, prior: Totals | null): StockistTablePanel {
  let growing = 0;
  let degrowing = 0;
  const rows = stockists.map((s): StockistRow => {
    const dispGr = M.grPct(s.disp, s.priorDisp);
    if (dispGr !== null && dispGr > 0) growing++;
    if (dispGr !== null && dispGr < 0) degrowing++;
    return [
      s.name, s.code, s.hq, s.hqName,
      s.disp, dispGr,
      s.coll, M.grPct(s.coll, s.priorColl),
      s.sec, M.grPct(s.sec, s.priorSec),
      s.os,
    ];
  });
  // The Total is the period's totals: rows without a stockist carry only target. (I3)
  const total: StockistRow = [
    'Total', '', '', '',
    cur?.disp ?? null, M.grPct(cur?.disp ?? null, prior?.disp ?? null),
    cur?.coll ?? null, M.grPct(cur?.coll ?? null, prior?.coll ?? null),
    cur?.sec ?? null, M.grPct(cur?.sec ?? null, prior?.sec ?? null),
    cur?.os ?? null,
  ];
  return { columns: STOCKIST_COLUMNS, rows, total, growingCount: growing, degrowingCount: degrowing };
}

function keyBrandRow(n: NodeBreakdown): KeyBrandRow {
  return [
    n.name,
    n.tgt,
    n.disp,
    // COLLECTION has no brand; its split by product does.
    n.collMat,
    M.achPct(n.collMat, n.tgt),
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
  cnNodes: Map<string, CnNode>,
  cnTotal: CnFigures,
  /** PCPM for a node's collection — or, with a null code, the Total's. */
  pcpmFor: (code: string | null, coll: number | null) => number | null,
) {
  let onTarget = 0;
  let growing = 0;
  let degrowing = 0;
  // Inventory is plant-level: it splits by division and brand, never by geography.
  const inventoryApplies = grain === 'division' || grain === 'brand';

  const rows: GeoRow[] = nodes.map((n) => {
    const node = cnNodes.get(n.code)?.cn;
    const cn = node?.total ?? null;
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
      pcpmFor(n.code, n.coll),
      cn,
      M.cnPct(node?.forPct.total ?? null, n.gross),
      n.sec,
      inventoryApplies ? n.inventory : NO_SOURCE,
      n.rcpa,
      M.rcpaPctToSec(n.rcpa, n.sec),
    ] as GeoRow;
  });

  // A node with credit notes but no sales rows in the period still gets its
  // row, so the CN column ties to the Total.
  const codes = nodes.map((n) => n.code);
  const listed = new Set(codes);
  for (const [nodeCode, node] of cnNodes) {
    if (listed.has(nodeCode) || node.cn.total === null) continue;
    codes.push(nodeCode);
    rows.push([
      node.name, null, null, null, null, null, null, NO_SOURCE,
      node.cn.total, null, null, NO_SOURCE, null, null,
    ]);
  }

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
    pcpmFor(null, cur?.coll ?? null),
    cnTotal.total,
    M.cnPct(cnTotal.forPct.total, cur?.gross ?? null),
    cur?.sec ?? null,
    geoNarrowed ? NO_SOURCE : (cur?.inventory ?? null),
    cur?.rcpa ?? null,
    M.rcpaPctToSec(cur?.rcpa ?? null, cur?.sec ?? null),
  ];

  return {
    grain,
    columns: GEO_COLUMNS,
    codes,
    rows,
    total,
    onTargetCount: onTarget,
    growingCount: growing,
    degrowingCount: degrowing,
  };
}

function trends(
  { points, prior }: TrendResult,
  series: string[],
  cn: CnByMonth,
  manpower: ManpowerResult | null,
  pcpmOfMonth: (coll: number | null) => number | null,
): TrendsPanel {
  const want = new Set(series);
  // Months from either source: a month with credit notes but no sales rows
  // still gets its point.
  const factBy = new Map(points.map((p) => [p.yrMn, p]));
  const months = [...new Set([...factBy.keys(), ...cn.byMonth.keys()])].sort((a, b) => a - b);
  const fact = (k: Exclude<keyof TrendPoint, 'yrMn'>) => months.map((m) => factBy.get(m)?.[k] ?? null);
  const cnOf = (k: keyof CnAmounts) => months.map((m) => cn.byMonth.get(m)?.[k] ?? null);
  const gross = fact('gross');

  const out: TrendsPanel = { months, labels: months.map(label) };
  if (want.has('disp')) out.disp = fact('disp');
  if (want.has('sec')) out.sec = fact('sec');
  if (want.has('rcpa')) out.rcpa = fact('rcpa');
  if (want.has('tgt')) out.tgt = fact('tgt');
  if (want.has('coll')) out.coll = fact('coll');
  if (want.has('pcpm')) {
    const pcpm = fact('coll').map(pcpmOfMonth);
    // A series of nulls would draw an empty axis: omitted instead.
    if (pcpm.some((v) => v !== null)) out.pcpm = pcpm;
  }
  if (want.has('achPct')) {
    const coll = fact('coll');
    const tgt = fact('tgt');
    out.achPct = months.map((_, i) => M.achPct(coll[i] ?? null, tgt[i] ?? null));
  }
  if (want.has('grPct')) {
    const disp = fact('disp');
    out.grPct = months.map((m, i) => M.grPct(disp[i] ?? null, prior.get(priorYear(m))?.disp ?? null));
  }
  if (want.has('cnExp')) out.cnExp = cnOf('exp');
  if (want.has('cnSr')) out.cnSr = cnOf('sr');
  if (want.has('cnPd')) out.cnPd = cnOf('pd');
  if (want.has('rxns')) out.rxns = fact('rxns');
  if (want.has('rxber')) out.rxber = fact('rxber');
  if (want.has('rxPd')) {
    const rxns = fact('rxns');
    const rxber = fact('rxber');
    out.rxPd = months.map((_, i) => M.perPrescriber(rxns[i] ?? null, rxber[i] ?? null));
  }
  // Leavers per month; omitted when this view cannot show attrition.
  if (manpower) {
    const leftOf = (k: 'tm' | 'rm' | 'zsm') => months.map((m) => manpower.leftByMonth.get(m)?.[k] ?? 0);
    if (want.has('leftTm')) out.leftTm = leftOf('tm');
    if (want.has('leftRm')) out.leftRm = leftOf('rm');
    if (want.has('leftZsm')) out.leftZsm = leftOf('zsm');
  }
  if (want.has('cnPct')) {
    const total = cnOf('total');
    out.cnPct = months.map((_, i) => M.cnPct(total[i] ?? null, gross[i] ?? null));
  }
  // rcpaPlan / rcpaActual / valuePerDr are omitted entirely: their
  // sources do not exist, and a series of nulls would draw an empty axis
  // rather than communicating "not available".
  return out;
}

function mixPanel(
  slices: Awaited<ReturnType<typeof fetchMix>>,
  brands: BrandTotals,
  dimension: MixPanel['dimension'],
): MixPanel {
  const labels = slices.map((s) => s.label);
  const pie = (list: BrandTotals['sec']) => ({
    labels: list.map((s) => s.label),
    values: list.map((s) => s.value),
  });
  return {
    dimension,
    disp: { labels, values: slices.map((s) => s.disp) },
    // COLLECTION carries no brand; its split by product does.
    coll: { labels, values: slices.map((s) => s.collMat) },
    collNote: REASONS.brandCollNote,
    // Every brand, under the feeds' own brand names.
    sec: pie(brands.sec),
    rcpa: pie(brands.rcpa),
  };
}
