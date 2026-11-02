/**
 * Stockist-wise primary, collection and secondary — the "Stockist" tab's grid.
 *
 * The sales table carries the stockist on each row (StockistCode,
 * StockistName). Dispatch, collection and secondary sit on stockist rows;
 * target (BUDGET1) is kept only on rows without one, so there is no target per
 * stockist. One stockist can serve several HQs and divisions: a row is the
 * stockist's figures within the selection, with the SAP codes of the HQs it
 * has rows under this period ("94CHEN, WTCHEN") and their names, each once
 * ("Chennai" — both codes are Chennai). An HQ without a name is shown by its
 * code, as elsewhere.
 */
import type { Db } from '../db.js';
import {
  BALANCE_SELECT, DIMENSION, MEASURES, SOURCE, closingMonth, code, num, type BalanceRow,
} from '../sqlFragments.js';
import { buildPredicate, type PanelFilters } from '../queryBuilder.js';
import { groupByNode, twoWindowPredicate, type WindowedRow } from './shared.js';
import type { Scope } from '../../plugins/scope.js';

const STOCKIST = code('StockistCode');
const R = (e: string) => `CAST(${e} AS DECIMAL(38,2))`;

type Row = BalanceRow & WindowedRow & {
  node_code: string;
  node_name: string | null;
  disp: string | number | null;
  coll: string | number | null;
  sec: string | number | null;
};

export interface StockistFigures {
  code: string;
  name: string;
  /** The SAP codes of its HQs this period, comma-separated. */
  hq: string;
  /** Their names, each once, comma-separated. */
  hqName: string;
  disp: number | null;
  coll: number | null;
  sec: number | null;
  /** Closing outstanding. */
  os: number | null;
  priorDisp: number | null;
  priorColl: number | null;
  priorSec: number | null;
}

/** Per stockist: its HQ codes, sorted, and their names, each once (any case). */
function hqLists(rows: { node_code: string; hq: string; hq_name: string | null }[]) {
  const byStockist = new Map<string, { hq: string; name: string }[]>();
  for (const r of rows) {
    const list = byStockist.get(r.node_code) ?? [];
    list.push({ hq: r.hq, name: r.hq_name || r.hq });
    byStockist.set(r.node_code, list);
  }
  const out = new Map<string, { codes: string; names: string }>();
  for (const [stockist, list] of byStockist) {
    list.sort((a, b) => a.hq.localeCompare(b.hq));
    const names = new Map<string, string>();
    for (const { name } of list) if (!names.has(name.toUpperCase())) names.set(name.toUpperCase(), name);
    out.set(stockist, { codes: list.map((x) => x.hq).join(', '), names: [...names.values()].join(', ') });
  }
  return out;
}

/** Every stockist in the selection with sales this period, largest dispatch first. */
export async function fetchStockists(db: Db, scope: Scope, filters: PanelFilters): Promise<StockistFigures[]> {
  const { where, params, winCase } = twoWindowPredicate(scope, filters);
  // The period's own predicate (same parameter names and values) for the HQ list.
  const period = buildPredicate(scope, filters);
  const hq = code(DIMENSION.hq.codeCol);
  const [rows, hqRows] = await Promise.all([
    db.all<Row>(
      `SELECT
      ${winCase} AS win,
      ${STOCKIST} AS node_code,
      MAX(${code('StockistName')}) AS node_name,
      ${R(MEASURES.disp)} AS disp,
      ${R(MEASURES.coll)} AS coll,
      ${R(MEASURES.sec)} AS sec,
      ${BALANCE_SELECT}
    FROM ${SOURCE}
    WHERE ${where}
      AND ${STOCKIST} IS NOT NULL
    GROUP BY ${winCase}, ${STOCKIST}`,
      { ...params, ...closingMonth(filters.to) },
    ),
    // Each stockist's HQs this period, one row per HQ.
    db.all<{ node_code: string; hq: string; hq_name: string | null }>(
      `SELECT ${STOCKIST} AS node_code, ${hq} AS hq, MAX(${code(DIMENSION.hq.nameCol)}) AS hq_name
  FROM ${SOURCE}
  WHERE ${period.where}
    AND ${STOCKIST} IS NOT NULL
    AND ${hq} IS NOT NULL
  GROUP BY ${STOCKIST}, ${hq}`,
      period.params,
    ),
  ]);
  const hqsOf = hqLists(hqRows);

  const out: StockistFigures[] = [];
  for (const [stockist, { cur, prior, name }] of groupByNode(rows)) {
    // Only in the prior year: nothing to show for this period.
    if (!cur) continue;
    out.push({
      code: stockist,
      name: name || stockist,
      hq: hqsOf.get(stockist)?.codes ?? '',
      hqName: hqsOf.get(stockist)?.names ?? '',
      disp: num(cur.disp),
      coll: num(cur.coll),
      sec: num(cur.sec),
      os: num(cur.os),
      priorDisp: prior ? num(prior.disp) : null,
      priorColl: prior ? num(prior.coll) : null,
      priorSec: prior ? num(prior.sec) : null,
    });
  }
  out.sort((a, b) => (b.disp ?? 0) - (a.disp ?? 0));
  return out;
}
