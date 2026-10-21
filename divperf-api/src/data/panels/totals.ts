/**
 * The KPI band: one query covering both windows, feeding Primary, Secondary,
 * RCPA, Inventory, and the O/S and gross sales of the CN & O/S card (its credit
 * notes come from their own view — creditNotes.ts).
 *
 * Five panels from one round trip: against Synapse a round trip costs a second,
 * so the measures every panel needs are fetched together.
 */
import type { Db } from '../db.js';
import {
  BALANCE_SELECT, DATE_KEY, DIMENSION, MEASURE_SELECT, SOURCE, closingMonth, code, num,
  type BalanceRow, type MeasureRow,
} from '../sqlFragments.js';
import { twoWindowPredicate, splitWindows, type WindowedRow } from './shared.js';
import { buildPredicate, type PanelFilters } from '../queryBuilder.js';
import type { Scope } from '../../plugins/scope.js';

type Row = MeasureRow & BalanceRow & WindowedRow & {
  rcpa_as_of: number | null;
  rx_from: number | null;
  rx_to: number | null;
};

export interface Totals {
  tgt: number | null;
  disp: number | null;
  gross: number | null;
  coll: number | null;
  /** Collection split by brand (COLLECTION_MATERIAL), net of GST. */
  collMat: number | null;
  /** Closing balances: the value in the period's last month. */
  os: number | null;
  inventory: number | null;
  sec: number | null;
  rcpa: number | null;
  /** Newest month with any RCPA in the window — the "as of" label. */
  rcpaAsOf: number | null;
  /** Prescriptions and prescriber-months (summed), and the months with Rx data. */
  rxns: number | null;
  rxber: number | null;
  rxMonths: number;
  /** First and last month in the window with Rx data. */
  rxFrom: number | null;
  rxTo: number | null;
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
        collMat: num(r.coll_mat),
        os: num(r.os),
        inventory: num(r.inventory),
        sec: num(r.sec),
        rcpa: num(r.rcpa),
        rcpaAsOf: num(r.rcpa_as_of),
        rxns: num(r.rxns),
        rxber: num(r.rxber),
        rxMonths: num(r.rx_months) ?? 0,
        rxFrom: num(r.rx_from),
        rxTo: num(r.rx_to),
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
    ${BALANCE_SELECT},
    MAX(CASE WHEN RCPA_VALUE <> 0 THEN ${DATE_KEY} END) AS rcpa_as_of,
    MIN(CASE WHEN DR_TOT <> 0 THEN ${DATE_KEY} END) AS rx_from,
    MAX(CASE WHEN DR_TOT <> 0 THEN ${DATE_KEY} END) AS rx_to
  FROM ${SOURCE}
  WHERE ${where}
  GROUP BY ${winCase}`,
      { ...params, ...closingMonth(filters.to) },
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
