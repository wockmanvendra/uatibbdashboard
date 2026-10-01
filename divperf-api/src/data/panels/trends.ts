/**
 * The monthly trend series behind the charts.
 *
 * Both windows come back in one round trip — the selected months and the same
 * months a year earlier — so month-on-month growth can be paired without a
 * second query. At most 72 rows.
 */
import type { Db } from '../db.js';
import { DATE_KEY, MEASURE_SELECT, SOURCE, num, type MeasureRow } from '../sqlFragments.js';
import { type PanelFilters } from '../queryBuilder.js';
import { twoWindowPredicate } from './shared.js';
import type { Scope } from '../../plugins/scope.js';

type Row = MeasureRow & { date_key: number };

export interface TrendPoint {
  yrMn: number;
  tgt: number | null;
  disp: number | null;
  gross: number | null;
  coll: number | null;
  cn: number | null;
  inventory: number | null;
  sec: number | null;
  rcpa: number | null;
}

export interface TrendResult {
  /** The selected months, in order. */
  points: TrendPoint[];
  /** The prior-year window, keyed by month. */
  prior: Map<number, TrendPoint>;
}

export async function fetchTrend(db: Db, scope: Scope, filters: PanelFilters): Promise<TrendResult> {
  const { where, params } = twoWindowPredicate(scope, filters);

  const rows = await db.all<Row>(
    `SELECT
    ${DATE_KEY} AS date_key,
    ${MEASURE_SELECT}
  FROM ${SOURCE}
  WHERE ${where}
  GROUP BY ${DATE_KEY}
  ORDER BY ${DATE_KEY}`,
    params,
  );

  const all = rows.map(
    (r): TrendPoint => ({
      yrMn: Number(r.date_key),
      tgt: num(r.tgt),
      disp: num(r.disp),
      gross: num(r.gross),
      coll: num(r.coll),
      cn: num(r.cn),
      inventory: num(r.inventory),
      sec: num(r.sec),
      rcpa: num(r.rcpa),
    }),
  );

  return {
    points: all.filter((p) => p.yrMn >= filters.from && p.yrMn <= filters.to),
    prior: new Map(all.filter((p) => p.yrMn < filters.from).map((p) => [p.yrMn, p])),
  };
}
