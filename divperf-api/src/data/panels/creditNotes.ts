/**
 * Credit notes, from their own view (config CN_TABLE,
 * Infinity.VW_Credit_Note_Details): Exp / SR / PD and the total, by division,
 * territory, product and month.
 *
 * The view has no zone, region or brand. Zone and region come through the
 * territory lookup (TERRITORY_JOIN), which reads the sales table — a scan — so
 * it is joined only when a query filters or groups on either. A brand filter
 * matches the products that carry the brand (CN_MATCH).
 *
 * CN% divides by gross sales from the sales table, and its numerator counts
 * only the months that have sales (`SalesMonths`): credit notes start a year
 * before the sales data. Where a grid needs CN% per row, both sides are
 * aggregated in the same statement and joined there, so no measure is summed
 * in Node. (I3)
 */
import type { Db, SqlParams } from '../db.js';
import {
  CN_ALIAS, CN_COLUMN, CN_SOURCE, cnMeasureSelect, DATE_KEY, DIMENSION, MEASURES, PRODUCT_KEY,
  SOURCE, TERRITORY_ALIAS, TERRITORY_JOIN, UNASSIGNED, code, num, type CnMeasureRow,
} from '../sqlFragments.js';
import { buildPredicate, CN_MATCH, type PanelFilters } from '../queryBuilder.js';
import type { Scope } from '../../plugins/scope.js';
import type { CnDetailRow } from '../../types/api.js';
import * as M from '../../lib/metrics.js';

export interface CnAmounts {
  exp: number | null;
  sr: number | null;
  pd: number | null;
  total: number | null;
}

export interface CnFigures extends CnAmounts {
  /**
   * The same amounts over only the period's months with sales — CN%'s
   * numerators. Null where the full amount is null, or no month has sales.
   */
  forPct: CnAmounts;
}

/** The part of the selected period the sales table has sales for, as YYYYMM. */
export interface SalesMonths {
  from: number;
  to: number;
}

const NO_AMOUNTS: CnAmounts = { exp: null, sr: null, pd: null, total: null };
export const NO_CN: CnFigures = { ...NO_AMOUNTS, forPct: NO_AMOUNTS };

function figures(r: CnMeasureRow | null | undefined): CnFigures {
  if (!r) return NO_CN;
  const full = { exp: num(r.cn_exp), sr: num(r.cn_sr), pd: num(r.cn_pd), total: num(r.cn_total) };
  const part = (k: keyof CnAmounts, p: string | number | null) => (full[k] === null ? null : num(p));
  return {
    ...full,
    forPct: {
      exp: part('exp', r.cn_exp_p),
      sr: part('sr', r.cn_sr_p),
      pd: part('pd', r.cn_pd_p),
      total: part('total', r.cn_total_p),
    },
  };
}

const T = TERRITORY_ALIAS;

/**
 * FROM and WHERE for a credit-note query: the filters and the user's scope,
 * through the same predicate builder the sales queries use.
 */
function cnQuery(
  scope: Scope,
  filters: PanelFilters,
  salesMonths: SalesMonths | null,
  { territory = false }: { territory?: boolean } = {},
): { from: string; where: string; params: SqlParams; measures: string } {
  const p = buildPredicate(scope, filters, { match: CN_MATCH, prefix: 'c' });
  const joinTerritory = territory || p.constrained.includes('zone') || p.constrained.includes('region');

  let where = p.where;
  // With no division constrained (an all-divisions user, no filter), hold
  // credit notes to the divisions the dashboard covers. The view also holds
  // divisions with no sales rows at all: no division filter could reach them,
  // and their CN% would have no gross sales to divide by.
  if (!p.constrained.includes('division')) {
    where += `\n    AND ${code(CN_COLUMN.division)} IN (SELECT DISTINCT ${code(DIMENSION.division.codeCol)} FROM ${SOURCE})`;
  }

  return {
    from: `${CN_SOURCE} ${CN_ALIAS}${joinTerritory ? `\n  ${TERRITORY_JOIN}` : ''}`,
    where,
    params: salesMonths
      ? { ...p.params, gFrom: String(salesMonths.from), gTo: String(salesMonths.to) }
      : p.params,
    measures: cnMeasureSelect(salesMonths !== null),
  };
}

export interface CnByMonth {
  /** The whole selected period. */
  total: CnFigures;
  byMonth: Map<number, CnFigures>;
}

/** The period total and the monthly series, in one round trip (ROLLUP). */
export async function fetchCnByMonth(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  salesMonths: SalesMonths | null,
): Promise<CnByMonth> {
  const { from, where, params, measures } = cnQuery(scope, filters, salesMonths);

  const rows = await db.all<CnMeasureRow & { date_key: number | string | null }>(
    `SELECT
    ${DATE_KEY} AS date_key,
    ${measures}
  FROM ${from}
  WHERE ${where}
  GROUP BY ROLLUP(${DATE_KEY})`,
    params,
  );

  // The ROLLUP row is the one without a month.
  return {
    total: figures(rows.find((r) => r.date_key === null)),
    byMonth: new Map(
      rows.filter((r) => r.date_key !== null).map((r) => [Number(r.date_key), figures(r)]),
    ),
  };
}

export type CnGrain = 'division' | 'zone' | 'region' | 'hq';

/** The node each grain groups on, and where its display name comes from. */
const NODE: Record<CnGrain, { code: string; name: string; territory: boolean }> = {
  division: { code: code(CN_COLUMN.division), name: 'NULL', territory: false },
  zone: { code: `${T}.zone_code`, name: `${T}.zone_name`, territory: true },
  region: { code: `${T}.region_code`, name: `${T}.region_name`, territory: true },
  hq: { code: code(CN_COLUMN.hq), name: `${T}.hq_name`, territory: true },
};

export interface CnNode {
  name: string;
  cn: CnFigures;
}

/**
 * Credit notes per zone, region, HQ or division — the CN column of the geo
 * grids. Codes match the sales breakdown's, "Unassigned" included, so the two
 * join by code.
 */
export async function fetchCnBreakdown(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  grain: CnGrain,
  salesMonths: SalesMonths | null,
): Promise<Map<string, CnNode>> {
  const node = NODE[grain];
  const { from, where, params, measures } = cnQuery(scope, filters, salesMonths, { territory: node.territory });
  const key = `COALESCE(${node.code}, '${UNASSIGNED}')`;

  const rows = await db.all<CnMeasureRow & { node_code: string; node_name: string | null }>(
    `SELECT
    ${key} AS node_code,
    MAX(${node.name}) AS node_name,
    ${measures}
  FROM ${from}
  WHERE ${where}
  GROUP BY ${key}`,
    params,
  );

  return new Map(
    rows.map((r) => [r.node_code, { name: r.node_name || r.node_code, cn: figures(r) }]),
  );
}

export interface CnDetail {
  byHq: CnDetailRow[];
  bySku: CnDetailRow[];
}

type DetailRow = CnMeasureRow & { node_code: string | number; node_name: string | null; gross: string | number | null };

/**
 * The Credit note tab's grids: credit notes by HQ and by SKU, each with CN% on
 * that HQ's or SKU's own gross sales. Nodes with no credit note in the period
 * are left out — the view is zero-filled, and a grid of dashes helps no one.
 */
export async function fetchCnDetail(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  salesMonths: SalesMonths | null,
): Promise<CnDetail> {
  const [byHq, bySku] = await Promise.all([
    fetchByHq(db, scope, filters, salesMonths),
    fetchBySku(db, scope, filters, salesMonths),
  ]);
  return { byHq, bySku };
}

/** The sales side of a detail grid: gross sales per node, under the same filters and scope. */
function grossBy(scope: Scope, filters: PanelFilters, node: string): { sql: string; params: SqlParams } {
  const fact = buildPredicate(scope, filters, { prefix: 'f' });
  return {
    sql: `SELECT ${node} AS node_code, CAST(${MEASURES.gross} AS DECIMAL(38,2)) AS gross
      FROM ${SOURCE}
     WHERE ${fact.where}
     GROUP BY ${node}`,
    params: fact.params,
  };
}

const toDetail = (rows: DetailRow[], nameFor: (r: DetailRow) => string): CnDetailRow[] =>
  rows
    .filter((r) => num(r.cn_total) !== null)
    .map((r): CnDetailRow => {
      const cn = figures(r);
      return [nameFor(r), String(r.node_code), cn.exp, cn.sr, cn.pd, cn.total, M.cnPct(cn.forPct.total, num(r.gross))];
    })
    .sort((a, b) => (b[5] ?? 0) - (a[5] ?? 0));

async function fetchByHq(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  salesMonths: SalesMonths | null,
): Promise<CnDetailRow[]> {
  const { from, where, params, measures } = cnQuery(scope, filters, salesMonths, { territory: true });
  const hq = `COALESCE(${code(CN_COLUMN.hq)}, '${UNASSIGNED}')`;
  const gross = grossBy(scope, filters, `COALESCE(${code(DIMENSION.hq.codeCol)}, '${UNASSIGNED}')`);

  const rows = await db.all<DetailRow>(
    `SELECT n.*, g.gross
  FROM (
    SELECT ${hq} AS node_code, MAX(${T}.hq_name) AS node_name,
    ${measures}
    FROM ${from}
    WHERE ${where}
    GROUP BY ${hq}
  ) n
  LEFT JOIN (
    ${gross.sql}
  ) g ON g.node_code = n.node_code`,
    { ...params, ...gross.params },
  );
  return toDetail(rows, (r) => r.node_name || String(r.node_code));
}

/**
 * Per SKU. The sales table's product descriptions do not belong to their
 * product codes (one code carries a dozen unrelated descriptions), so a SKU is
 * named by its brand — the name on its sales rows, else any — with the product
 * code beside it.
 */
async function fetchBySku(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  salesMonths: SalesMonths | null,
): Promise<CnDetailRow[]> {
  const { from, where, params, measures } = cnQuery(scope, filters, salesMonths);
  const gross = grossBy(scope, filters, PRODUCT_KEY);
  const brand = code(DIMENSION.brand.codeCol);

  const rows = await db.all<DetailRow>(
    `SELECT n.*, b.brand AS node_name, g.gross
  FROM (
    SELECT ${CN_COLUMN.product} AS node_code,
    ${measures}
    FROM ${from}
    WHERE ${where}
    GROUP BY ${CN_COLUMN.product}
  ) n
  LEFT JOIN (
    SELECT ${PRODUCT_KEY} AS node_code,
           COALESCE(MAX(CASE WHEN NET_SALES <> 0 THEN ${brand} END), MAX(${brand})) AS brand
      FROM ${SOURCE}
     GROUP BY ${PRODUCT_KEY}
  ) b ON b.node_code = n.node_code
  LEFT JOIN (
    ${gross.sql}
  ) g ON g.node_code = n.node_code`,
    { ...params, ...gross.params },
  );
  return toDetail(rows, (r) => r.node_name || `Product ${r.node_code}`);
}
