/**
 * Shared pieces of the detail lists: one page of rows with the total, search,
 * and facet clauses. Every value is a bound parameter.
 */
import type { Db, SqlParams } from '../db.js';

/** LIKE pattern for a search term: its wildcards matched literally. */
export const likeTerm = (s: string) => `%${s.replace(/[%_[]/g, '[$&]')}%`;

/** `(a LIKE @q OR b LIKE @q …)` for a search term, or '' without one. */
export function searchClause(columns: string[], term: string | undefined, params: SqlParams): string {
  const t = term?.trim();
  if (!t) return '';
  params.q = likeTerm(t);
  return `\n    AND (${columns.map((c) => `${c} LIKE @q`).join(' OR ')})`;
}

/** `AND expr IN (@f0, …)` binding `values` under parameter names `prefix0…`. */
export function inClause(expr: string, values: string[], params: SqlParams, prefix: string): string {
  if (!values.length) return '';
  const names = values.map((v, i) => {
    params[`${prefix}${i}`] = v;
    return `@${prefix}${i}`;
  });
  return `\n    AND ${expr} IN (${names.join(', ')})`;
}

export interface PageQuery {
  /** The SELECT list, without ROW_NUMBER or the total. */
  select: string;
  from: string;
  where: string;
  orderBy: string;
  params: SqlParams;
  page: number;
  pageSize: number;
}

/**
 * One page, and the total from the same pass. The dedicated pool has no
 * OFFSET/FETCH, so pages are cut by ROW_NUMBER, the total by COUNT(*) OVER ().
 */
export async function fetchPage<T extends object>(
  db: Db,
  { select, from, where, orderBy, params, page, pageSize }: PageQuery,
): Promise<{ rows: T[]; total: number }> {
  const rows = await db.all<T & { rn: unknown; total: string | number }>(
    `SELECT x.* FROM (
    SELECT ${select},
           ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS rn,
           COUNT_BIG(*) OVER () AS total
      FROM ${from}
     WHERE ${where}
  ) x
  WHERE x.rn BETWEEN @rFrom AND @rTo
  ORDER BY x.rn`,
    { ...params, rFrom: (page - 1) * pageSize + 1, rTo: page * pageSize },
  );
  const total = rows.length ? Number(rows[0]!.total) : 0;
  return {
    total,
    rows: rows.map(({ rn: _rn, total: _total, ...rest }) => rest as unknown as T),
  };
}
