/**
 * Per-node breakdowns: the Key Brands grid, the geo grids, and the mix donuts.
 *
 * One query serves a whole grid, returning both windows so `Gr%` per row is
 * available without a second round trip.
 */
import type { Db } from '../db.js';
import {
  BALANCE_SELECT, DIMENSION, MEASURES, MEASURE_SELECT, SOURCE, closingMonth, code, num,
  type BalanceRow, type MeasureRow,
} from '../sqlFragments.js';
import { buildPredicate, grainSelect, type PanelFilters } from '../queryBuilder.js';
import { twoWindowPredicate, groupByNode, type WindowedRow } from './shared.js';
import type { Scope } from '../../plugins/scope.js';
import type { DimensionName } from '../sqlFragments.js';

type Row = MeasureRow & BalanceRow & WindowedRow & { node_code: string; node_name: string };

export interface NodeBreakdown {
  code: string;
  name: string;
  tgt: number | null;
  disp: number | null;
  gross: number | null;
  coll: number | null;
  /** Collection split by brand (COLLECTION_MATERIAL), net of GST. */
  collMat: number | null;
  /** Closing stock + GIT: the value in the period's last month. */
  inventory: number | null;
  sec: number | null;
  rcpa: number | null;
  /** Same measures for the prior-year window; null when it holds no data. */
  priorDisp: number | null;
  priorColl: number | null;
  priorCollMat: number | null;
}

/**
 * Rows grouped by one hierarchy level, current and prior window together.
 * Ordering is done in SQL; any top-N cut is applied by the caller after the
 * rows are back, so the SQL stays dialect-neutral (no TOP, no LIMIT).
 */
export async function fetchBreakdown(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  dimension: DimensionName,
): Promise<NodeBreakdown[]> {
  const { where, params, winCase } = twoWindowPredicate(scope, filters);
  const grain = grainSelect(dimension);

  const rows = await db.all<Row>(
    `SELECT
    ${winCase} AS win,
    ${grain.select},
    ${MEASURE_SELECT},
    ${BALANCE_SELECT}
  FROM ${SOURCE}
  WHERE ${where}
  GROUP BY ${winCase}, ${grain.groupBy}
  ORDER BY ${grain.groupBy}`,
    { ...params, ...closingMonth(filters.to) },
  );

  const grouped = groupByNode(rows);
  const out: NodeBreakdown[] = [];

  for (const [nodeCode, entry] of grouped) {
    // A node present only in the prior year has nothing to show this period.
    // It is dropped rather than rendered as a row of em dashes.
    if (!entry.cur) continue;
    const c = entry.cur;
    out.push({
      code: nodeCode,
      name: entry.name || nodeCode,
      tgt: num(c.tgt),
      disp: num(c.disp),
      gross: num(c.gross),
      coll: num(c.coll),
      collMat: num(c.coll_mat),
      inventory: num(c.inventory),
      sec: num(c.sec),
      rcpa: num(c.rcpa),
      priorDisp: entry.prior ? num(entry.prior.disp) : null,
      priorColl: entry.prior ? num(entry.prior.coll) : null,
      priorCollMat: entry.prior ? num(entry.prior.coll_mat) : null,
    });
  }

  // Descending by dispatch is what every one of these grids opens on.
  out.sort((a, b) => (b.disp ?? 0) - (a.disp ?? 0));
  return out;
}

export interface MixSlice {
  label: string;
  disp: number | null;
  coll: number | null;
  /** Collection split by brand (COLLECTION_MATERIAL), net of GST. */
  collMat: number | null;
  gross: number | null;
  sec: number | null;
  rcpa: number | null;
}

export interface BrandTotals {
  /** Every brand with secondary sales, largest first. */
  sec: { label: string; value: number }[];
  /** Every brand with RCPA value, largest first. */
  rcpa: { label: string; value: number }[];
}

/**
 * Secondary and RCPA by brand, every brand — the Secondary and RCPA mix pies.
 *
 * These feeds name brands differently from dispatch (WOSULIN CART where
 * dispatch has WOSULIN CTG), so they cannot share the dispatch pie's top
 * brands. The predicate carries the brand filter, so a brand selection
 * narrows the pies to the chosen brands. Rows without a brand hold
 * collection, not secondary or RCPA, and are left out.
 */
export async function fetchBrandTotals(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
): Promise<BrandTotals> {
  const { where, params } = buildPredicate(scope, filters);
  const brand = code(DIMENSION.brand.codeCol);

  const rows = await db.all<{ brand: string; sec: string | number | null; rcpa: string | number | null }>(
    `SELECT
    ${brand} AS brand,
    CAST(${MEASURES.sec} AS DECIMAL(38,2)) AS sec,
    CAST(${MEASURES.rcpa} AS DECIMAL(38,2)) AS rcpa
  FROM ${SOURCE}
  WHERE ${where} AND ${brand} IS NOT NULL
  GROUP BY ${brand}`,
    params,
  );

  const pie = (k: 'sec' | 'rcpa') =>
    rows
      .map((r) => ({ label: r.brand, value: num(r[k]) ?? 0 }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return { sec: pie('sec'), rcpa: pie('rcpa') };
}

/** Brands named in the dispatch mix; the rest are folded into "Others". */
export const MIX_TOP_BRANDS = 4;
export const MIX_OTHERS = 'Others';

/**
 * The dispatch mix: the top brands by dispatch in the selected period, plus
 * "Others". Ranking and folding both happen in SQL — nothing is summed here.
 *
 * Dispatch, secondary and RCPA carry a brand, so those slices are real.
 * COLLECTION does not — it is recorded per customer with a blank brand — so
 * the Coll mix uses COLLECTION_MATERIAL, its split by product.
 */
export async function fetchMix(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
): Promise<MixSlice[]> {
  const { where, params } = buildPredicate(scope, filters);
  const brand = DIMENSION.brand.codeCol;

  const rows = await db.all<MeasureRow & { grp: string }>(
    `SELECT
    COALESCE(t.top_brand, '${MIX_OTHERS}') AS grp,
    ${MEASURE_SELECT}
  FROM ${SOURCE} s
  LEFT JOIN (
    SELECT TOP ${MIX_TOP_BRANDS} ${code(brand)} AS top_brand
    FROM ${SOURCE}
    WHERE ${where} AND ${code(brand)} IS NOT NULL
    GROUP BY ${code(brand)}
    ORDER BY SUM(CAST(NET_SALES AS DECIMAL(38,6))) DESC
  ) t ON t.top_brand = ${code(`s.${brand}`)}
  WHERE ${where}
  GROUP BY COALESCE(t.top_brand, '${MIX_OTHERS}')`,
    params,
  );

  return rows
    .map((r) => ({
      label: r.grp,
      disp: num(r.disp),
      coll: num(r.coll),
      collMat: num(r.coll_mat),
      gross: num(r.gross),
      sec: num(r.sec),
      rcpa: num(r.rcpa),
    }))
    // Largest first; "Others" always last, as a legend reads.
    .sort((a, b) =>
      a.label === MIX_OTHERS ? 1 : b.label === MIX_OTHERS ? -1 : (b.disp ?? 0) - (a.disp ?? 0),
    );
}
