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
 *
 * The same predicate serves both sources — the sales table and the credit-note
 * view — through a matcher per source, so the scope rules exist once.
 */
import { permittedFor, type Scope } from '../plugins/scope.js';
import {
  CN_COLUMN, DIMENSION, MONTH_COL, PRODUCT_KEY, SOURCE, TERRITORY_ALIAS,
  code, codeOrUnassigned, type DimensionName,
} from './sqlFragments.js';
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

export type FilterKey = keyof Omit<PanelFilters, 'from' | 'to'>;

export interface Predicate {
  /** Everything after WHERE, already scope-narrowed. */
  where: string;
  params: SqlParams;
  /** The dimensions it constrains, after scope narrowing. */
  constrained: FilterKey[];
}

/** How one source matches each filter dimension against a bound list, "(@p0, @p1)". */
export type Matchers = Record<FilterKey, (list: string) => string>;

/**
 * The sales table: every dimension is a column on the row. `code()` so a
 * filter on a code matches the same normalisation the GROUP BY uses —
 * otherwise selecting a zone whose code has trailing whitespace in the source
 * silently returns nothing.
 */
export const FACT_MATCH: Matchers = {
  division: (l) => `${code(DIMENSION.division.codeCol)} IN ${l}`,
  brand: (l) => `${code(DIMENSION.brand.codeCol)} IN ${l}`,
  zone: (l) => `${code(DIMENSION.zone.codeCol)} IN ${l}`,
  region: (l) => `${code(DIMENSION.region.codeCol)} IN ${l}`,
  hq: (l) => `${code(DIMENSION.hq.codeCol)} IN ${l}`,
};

/**
 * The credit-note view, which carries only division, territory and product.
 * Zone and region come from the territory lookup (TERRITORY_JOIN), so a query
 * whose predicate constrains either must include that join. A brand matches
 * the products that carry it anywhere in the sales table — sales and secondary
 * rows name some brands differently, and either name should find the product.
 */
export const CN_MATCH: Matchers = {
  division: (l) => `${code(CN_COLUMN.division)} IN ${l}`,
  hq: (l) => `${code(CN_COLUMN.hq)} IN ${l}`,
  zone: (l) => `${TERRITORY_ALIAS}.zone_code IN ${l}`,
  region: (l) => `${TERRITORY_ALIAS}.region_code IN ${l}`,
  brand: (l) =>
    `${CN_COLUMN.product} IN (SELECT ${PRODUCT_KEY} FROM ${SOURCE} WHERE ${code(DIMENSION.brand.codeCol)} IN ${l})`,
};

/**
 * A source read through a derived table, `alias`, that carries normalised
 * `div_code` and `hq_code` columns: the effort data and the headcount
 * tables. Zone and region come from the territory lookup, joined on those two
 * (territoryJoin). These sources count people and doctors, which are not
 * split by brand, so a brand filter leaves them whole — the caller says so.
 */
export const territoryMatch = (alias: string): Matchers => ({
  division: (l) => `${alias}.div_code IN ${l}`,
  hq: (l) => `${alias}.hq_code IN ${l}`,
  zone: (l) => `${TERRITORY_ALIAS}.zone_code IN ${l}`,
  region: (l) => `${TERRITORY_ALIAS}.region_code IN ${l}`,
  brand: () => '1 = 1',
});

export interface PredicateOptions {
  /** How the source matches each dimension. The sales table by default. */
  match?: Matchers;
  /**
   * Prefix for the generated list parameters, so two predicates can share one
   * statement. The month parameters are shared: both cover the same window.
   */
  prefix?: string;
  /** False for a source with no month column (headcount). */
  months?: boolean;
}

/**
 * Builds the predicate for a month range plus the filter set, narrowed to the
 * user's scope.
 *
 * `scope` is a required positional argument for the same reason `scopeHash` is
 * required in the cache key builder: making it optional is how national numbers
 * end up on an area manager's screen.
 */
export function buildPredicate(
  scope: Scope,
  filters: PanelFilters,
  { match = FACT_MATCH, prefix = 'p', months = true }: PredicateOptions = {},
): Predicate {
  const clauses: string[] = [];
  const params: SqlParams = {};
  const constrained: FilterKey[] = [];
  let n = 0;

  // The month range. The month column is nvarchar, so it is compared as text;
  // zero-padded YYYYMM sorts identically either way.
  if (months) {
    params.pFrom = String(filters.from);
    params.pTo = String(filters.to);
    clauses.push(monthRange('pFrom', 'pTo'));
  } else {
    clauses.push('1 = 1');
  }

  const inList = (key: FilterKey, values: string[]) => {
    const names = values.map(() => `@${prefix}${n++}`);
    values.forEach((v, i) => {
      params[names[i]!.slice(1)] = v;
    });
    clauses.push(match[key](`(${names.join(', ')})`));
    constrained.push(key);
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
    inList(key, effective);
  }

  return { where: clauses.join('\n    AND '), params, constrained };
}

/** `month BETWEEN @from AND @to`, for the named parameters. */
export const monthRange = (from: string, to: string) => `${MONTH_COL} BETWEEN @${from} AND @${to}`;

/**
 * Returns the values to constrain on, or null for "no constraint".
 * Intersects with what the scope permits on this dimension: the nodes at the
 * scope's own level, and the user's divisions.
 */
function narrow(
  key: FilterKey,
  requested: string[],
  scope: Scope,
): string[] | null {
  const permitted = permittedFor(key, scope);
  if (permitted === null) return requested.length ? requested : null;
  if (requested.length === 0) return permitted;
  const allowed = new Set(permitted);
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
