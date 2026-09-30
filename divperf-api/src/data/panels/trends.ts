/**
 * The monthly trend series behind the four charts.
 *
 * Only the current window is fetched: the charts plot the selected months, and
 * growth is a KPI-band figure rather than a series. That keeps this to one
 * round trip returning at most 36 rows.
 */
import type { Db } from '../db.js';
import { DATE_KEY, MEASURE_SELECT, SOURCE, num, type MeasureRow } from '../sqlFragments.js';
import { buildPredicate, type PanelFilters } from '../queryBuilder.js';
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

export async function fetchTrend(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
): Promise<TrendPoint[]> {
  const { where, params } = buildPredicate(scope, filters);

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

  return rows.map((r) => ({
    yrMn: Number(r.date_key),
    tgt: num(r.tgt),
    disp: num(r.disp),
    gross: num(r.gross),
    coll: num(r.coll),
    cn: num(r.cn),
    inventory: num(r.inventory),
    sec: num(r.sec),
    rcpa: num(r.rcpa),
  }));
}
