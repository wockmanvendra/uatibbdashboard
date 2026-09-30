/**
 * Composes the WHERE clause shared by every panel query. (§7.3)
 *
 * Invariant I5: the scope predicate is applied HERE, in the data layer, and not
 * in a route handler. Every function in this layer takes a `Scope`, and the
 * type signature makes it impossible to build a predicate without one — so it
 * cannot be forgotten when a new panel is added.
 *
 * Every value is a bound parameter. There is no string concatenation of user
 * input anywhere in this file: filter values only ever reach SQL as `@p0`,
 * `@p1`, … placeholders whose names this module generates.
 */
import type { Scope } from '../plugins/scope.js';
import { DIMENSION, MONTH_COL, code, codeOrUnassigned, type DimensionName } from './sqlFragments.js';
import type { SqlParams } from './db.js';

export interface PanelFilters {
  from: number;
  to: number;
  division: string[];
  brand: string[];
  zone: string[];
  region: string[];
  hq: string[];
}

export interface Predicate {
  /** Everything after WHERE, already scope-narrowed. */
  where: string;
  params: SqlParams;
}

/** Maps a filter dimension to the source column it constrains. */
const FILTER_COLUMN: Record<keyof Omit<PanelFilters, 'from' | 'to'>, string> = {
  division: DIMENSION.division.codeCol,
  brand: DIMENSION.brand.codeCol,
  zone: DIMENSION.zone.codeCol,
  region: DIMENSION.region.codeCol,
  hq: DIMENSION.hq.codeCol,
};

/** Which filter dimension each scope level constrains. */
const SCOPE_DIMENSION: Record<Exclude<Scope['level'], 'ALL'>, keyof typeof FILTER_COLUMN> = {
  DIVISION: 'division',
  ZONE: 'zone',
  REGION: 'region',
  HQ: 'hq',
};

/**
 * Builds the predicate for a month range plus the filter set, narrowed to the
 * user's scope.
 *
 * `scope` is a required positional argument for the same reason `scopeHash` is
 * required in the cache key builder: making it optional is how national numbers
 * end up on an area manager's screen.
 */
export function buildPredicate(scope: Scope, filters: PanelFilters): Predicate {
  const clauses: string[] = [];
  const params: SqlParams = {};
  let n = 0;

  // The month range. The month column is nvarchar, so it is compared as text;
  // zero-padded YYYYMM sorts identically either way.
  params.pFrom = String(filters.from);
  params.pTo = String(filters.to);
  clauses.push(monthRange('pFrom', 'pTo'));

  const inList = (column: string, values: string[]) => {
    const names = values.map(() => `@p${n++}`);
    values.forEach((v, i) => {
      params[names[i]!.slice(1)] = v;
    });
    // `code()` so a filter on a code matches the same normalisation the
    // GROUP BY uses — otherwise selecting a zone whose code has trailing
    // whitespace in the source silently returns nothing.
    clauses.push(`${code(column)} IN (${names.join(', ')})`);
  };

  for (const key of ['division', 'brand', 'zone', 'region', 'hq'] as const) {
    // Narrow the requested set to what this user may see, per §6.2 rule 6:
    // filters outside scope are intersected down, never rejected outright.
    const effective = narrow(key, filters[key], scope);

    // An empty result after narrowing means the user asked only for nodes they
    // do not own. Emitting `1 = 0` returns an empty dashboard, which is
    // correct — it must never fall through to "no filter" and show everything.
    if (effective === null) continue;
    if (effective.length === 0) {
      clauses.push('1 = 0');
      continue;
    }
    inList(FILTER_COLUMN[key], effective);
  }

  return { where: clauses.join('\n    AND '), params };
}

/** `month BETWEEN @from AND @to`, for the named parameters. */
export const monthRange = (from: string, to: string) => `${MONTH_COL} BETWEEN @${from} AND @${to}`;

/**
 * Returns the values to constrain on, or null for "no constraint".
 * Applies the scope intersection for the dimension the scope is defined at.
 */
function narrow(
  key: keyof typeof FILTER_COLUMN,
  requested: string[],
  scope: Scope,
): string[] | null {
  const scopedDimension = scope.level === 'ALL' ? null : SCOPE_DIMENSION[scope.level];

  if (scopedDimension !== key) {
    return requested.length ? requested : null;
  }

  // This is the dimension the user's scope is defined at.
  if (requested.length === 0) return scope.nodes;
  const allowed = new Set(scope.nodes);
  return requested.filter((r) => allowed.has(r));
}

/**
 * SELECT ... GROUP BY for a hierarchy grain, returning code and display name.
 * `MAX(name)` because the source pairs one code with several spellings; a node
 * with no name at all is shown by its code.
 */
export function grainSelect(dimension: DimensionName): {
  select: string;
  groupBy: string;
} {
  const { codeCol, nameCol } = DIMENSION[dimension];
  const node = codeOrUnassigned(codeCol);
  return {
    select: `${node} AS node_code,\n    COALESCE(MAX(${code(nameCol)}), ${node}) AS node_name`,
    groupBy: node,
  };
}
