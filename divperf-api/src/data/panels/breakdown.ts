/**
 * Per-node breakdowns: the Key Brands grid, the geo grids, and the mix donuts.
 *
 * One query serves a whole grid, returning both windows so `Gr%` per row is
 * available without a second round trip.
 */
import type { Db } from '../db.js';
import {
  BRAND_GROUP_SQL, MEASURE_SELECT, SOURCE, num, type MeasureRow,
} from '../sqlFragments.js';
import { grainSelect, type PanelFilters } from '../queryBuilder.js';
import { twoWindowPredicate, groupByNode, type WindowedRow } from './shared.js';
import type { Scope } from '../../plugins/scope.js';
import type { DimensionName } from '../sqlFragments.js';

type Row = MeasureRow & WindowedRow & { node_code: string; node_name: string };

export interface NodeBreakdown {
  code: string;
  name: string;
  tgt: number | null;
  disp: number | null;
  gross: number | null;
  coll: number | null;
  cn: number | null;
  os: number | null;
  inventory: number | null;
  sec: number | null;
  rcpa: number | null;
  /** Same measures for the prior-year window; null when it holds no data. */
  priorDisp: number | null;
  priorColl: number | null;
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
    ${MEASURE_SELECT}
  FROM ${SOURCE}
  WHERE ${where}
  GROUP BY ${winCase}, ${grain.groupBy}
  ORDER BY ${grain.groupBy}`,
    params,
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
      cn: num(c.cn),
      os: num(c.os),
      inventory: num(c.inventory),
      sec: num(c.sec),
      rcpa: num(c.rcpa),
      priorDisp: entry.prior ? num(entry.prior.disp) : null,
      priorColl: entry.prior ? num(entry.prior.coll) : null,
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
  gross: number | null;
  sec: number | null;
  rcpa: number | null;
}

/**
 * The mix donuts, grouped by brand group.
 *
 * Dispatch, secondary and RCPA carry a brand, so those slices are real.
 * Collection does not — it is recorded per customer with a blank brand — so it
 * lands entirely in one group and the Coll donut is not meaningful until a
 * brand-level collection feed exists. It is returned anyway so the caller can
 * decide.
 */
export async function fetchMix(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
): Promise<MixSlice[]> {
  const { where, params, winCase } = twoWindowPredicate(scope, filters);

  const rows = await db.all<MeasureRow & WindowedRow & { grp: string }>(
    `SELECT
    ${winCase} AS win,
    ${BRAND_GROUP_SQL} AS grp,
    ${MEASURE_SELECT}
  FROM ${SOURCE}
  WHERE ${where}
  GROUP BY ${winCase}, ${BRAND_GROUP_SQL}`,
    params,
  );

  return rows
    .filter((r) => r.win === 'cur')
    .map((r) => ({
      label: r.grp,
      disp: num(r.disp),
      coll: num(r.coll),
      gross: num(r.gross),
      sec: num(r.sec),
      rcpa: num(r.rcpa),
    }))
    .sort((a, b) => (b.disp ?? 0) - (a.disp ?? 0));
}
