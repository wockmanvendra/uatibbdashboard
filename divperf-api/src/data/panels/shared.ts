/**
 * Shared query shape for the panel queries.
 *
 * Against a serving database it would be natural to fetch the current window
 * and the prior-year window as two queries and run them with Promise.all. Not
 * here: each Synapse round trip costs roughly a second, so both windows are
 * fetched in ONE query, tagged by a window flag, and split in the caller.
 *
 * That split is not a violation of I3 — no measure is summed in Node. The SQL
 * does all the aggregation and returns at most two rows per grain; the caller
 * only decides which of them is "current" and which is "prior".
 */
import { buildPredicate, monthRange, type PanelFilters } from '../queryBuilder.js';
import type { Scope } from '../../plugins/scope.js';
import type { SqlParams } from '../db.js';
import { priorYear } from '../../lib/yrmn.js';

export type WindowTag = 'cur' | 'prior';

export interface WindowedRow {
  win: WindowTag;
}

/**
 * Predicate covering both the selected window and the same window a year
 * earlier, plus the CASE that labels each row.
 */
export function twoWindowPredicate(
  scope: Scope,
  filters: PanelFilters,
): { where: string; params: SqlParams; winCase: string } {
  const base = buildPredicate(scope, filters);

  const pFrom = String(priorYear(filters.from));
  const pTo = String(priorYear(filters.to));

  // Replace the single-range clause with an either-range clause. The rest of
  // the predicate — filters and the scope narrowing — is reused untouched, so
  // there is no second place where scope could be forgotten.
  const current = monthRange('pFrom', 'pTo');
  const where = base.where.replace(current, `(${current} OR ${monthRange('ppFrom', 'ppTo')})`);

  return {
    where,
    params: { ...base.params, ppFrom: pFrom, ppTo: pTo },
    winCase: `CASE WHEN ${current} THEN 'cur' ELSE 'prior' END`,
  };
}

/** Picks the two window rows out of a result set keyed by `win`. */
export function splitWindows<T extends WindowedRow>(
  rows: T[],
): { cur: T | null; prior: T | null } {
  return {
    cur: rows.find((r) => r.win === 'cur') ?? null,
    prior: rows.find((r) => r.win === 'prior') ?? null,
  };
}

/** Groups windowed rows by a node key, so each node has its cur/prior pair. */
export function groupByNode<T extends WindowedRow & { node_code: string }>(
  rows: T[],
): Map<string, { cur: T | null; prior: T | null; name: string }> {
  const out = new Map<string, { cur: T | null; prior: T | null; name: string }>();
  for (const r of rows) {
    const entry = out.get(r.node_code) ?? { cur: null, prior: null, name: '' };
    if (r.win === 'cur') entry.cur = r;
    else entry.prior = r;
    const named = r as T & { node_name?: string };
    if (named.node_name && (r.win === 'cur' || !entry.name)) entry.name = named.node_name;
    out.set(r.node_code, entry);
  }
  return out;
}
