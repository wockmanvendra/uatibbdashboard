/**
 * The KPI band: one query covering both windows, feeding Primary, Secondary,
 * RCPA, Inventory and CN & O/S.
 *
 * Five panels from one round trip: against Synapse a round trip costs a second,
 * so the measures every panel needs are fetched together.
 */
import type { Db } from '../db.js';
import { DATE_KEY, DIMENSION, MEASURE_SELECT, SOURCE, code, num, type MeasureRow } from '../sqlFragments.js';
import { twoWindowPredicate, splitWindows, type WindowedRow } from './shared.js';
import { buildPredicate, type PanelFilters } from '../queryBuilder.js';
import type { Scope } from '../../plugins/scope.js';

type Row = MeasureRow & WindowedRow & { rcpa_as_of: number | null };

export interface Totals {
  tgt: number | null;
  disp: number | null;
  gross: number | null;
  coll: number | null;
  cn: number | null;
  os: number | null;
  inventory: number | null;
  sec: number | null;
  rcpa: number | null;
  /** Newest month with any RCPA in the window — the "as of" label. */
  rcpaAsOf: number | null;
  srcRows: number;
}

export interface TotalsResult {
  cur: Totals | null;
  prior: Totals | null;
  /** Source rows whose geography did not resolve — surfaced in the UI footer. */
  unassignedRows: number;
}

const toTotals = (r: Row | null): Totals | null =>
  r === null
    ? null
    : {
        tgt: num(r.tgt),
        disp: num(r.disp),
        gross: num(r.gross),
        coll: num(r.coll),
        cn: num(r.cn),
        os: num(r.os),
        inventory: num(r.inventory),
        sec: num(r.sec),
        rcpa: num(r.rcpa),
        rcpaAsOf: num(r.rcpa_as_of),
        srcRows: num(r.src_rows) ?? 0,
      };

export async function fetchTotals(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
): Promise<TotalsResult> {
  const { where, params, winCase } = twoWindowPredicate(scope, filters);

  // Both queries in parallel. Awaiting them in sequence costs a second of pure
  // latency against Synapse for no reason — they share nothing. (§7.6)
  const [rows, unassignedRows] = await Promise.all([
    db.all<Row>(
      `SELECT
    ${winCase} AS win,
    ${MEASURE_SELECT},
    MAX(CASE WHEN RCPA_VALUE <> 0 THEN ${DATE_KEY} END) AS rcpa_as_of
  FROM ${SOURCE}
  WHERE ${where}
  GROUP BY ${winCase}`,
      params,
    ),
    countUnassigned(db, scope, filters),
  ]);

  const { cur, prior } = splitWindows(rows);
  return { cur: toTotals(cur), prior: toTotals(prior), unassignedRows };
}

/**
 * Rows in the selected window whose zone code is null or blank — the number
 * that tells a manager whether a geography split still ties to the total.
 */
async function countUnassigned(db: Db, scope: Scope, filters: PanelFilters): Promise<number> {
  const { where, params } = buildPredicate(scope, filters);
  const row = await db.one<{ n: string | number }>(
    `SELECT COUNT_BIG(*) AS n
  FROM ${SOURCE}
  WHERE ${where}
    AND ${code(DIMENSION.zone.codeCol)} IS NULL`,
    params,
  );
  return num(row?.n) ?? 0;
}
