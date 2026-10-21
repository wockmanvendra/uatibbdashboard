/**
 * Headcount, by division and HQ, with no month — the position today:
 *
 *   Budget TM   = no_of_tm   (config BUDGET_TM_TABLE, Infinity.budgeted_tm)
 *   TMs         = emp_count  (config EMP_COUNT_TABLE, Infinity.vw_emp_count)
 *
 * TMs in place is PCPM's divisor: PCPM (Coll) = collection ÷ TMs ÷ months.
 *
 * Both carry the sales table's SAP territory code as the HQ. The budget's
 * division code drops the leading zero ("2" for "02"), so a one-character
 * code is padded. Zone and region come from the territory lookup. People are
 * not split by brand, so a brand filter leaves the counts whole.
 *
 * One round trip, one pass: the selection's totals, and per node for a grid's
 * grain (ROLLUP).
 */
import type { Db } from '../db.js';
import {
  BUDGET_TM_SOURCE, DIMENSION, EMP_COUNT_SOURCE, SOURCE, TERRITORY_ALIAS, UNASSIGNED, code, num, territoryJoin,
} from '../sqlFragments.js';
import { buildPredicate, territoryMatch, type PanelFilters } from '../queryBuilder.js';
import type { Scope } from '../../plugins/scope.js';

export interface HeadcountFigures {
  budgetTm: number | null;
  /** TMs in place. */
  tms: number | null;
}

export interface Headcount extends HeadcountFigures {
  /** Per node of the requested grain, by node code. */
  byNode: Map<string, HeadcountFigures>;
}

export type HeadcountGrain = 'division' | 'zone' | 'region' | 'hq';

const ALIAS = 'hc';
const T = TERRITORY_ALIAS;

/** The node each headcount row belongs to, per grain — matching the grids' codes. */
const NODE: Record<HeadcountGrain, string> = {
  division: `COALESCE(${ALIAS}.div_code, '${UNASSIGNED}')`,
  zone: `COALESCE(${T}.zone_code, '${UNASSIGNED}')`,
  region: `COALESCE(${T}.region_code, '${UNASSIGNED}')`,
  hq: `COALESCE(${ALIAS}.hq_code, '${UNASSIGNED}')`,
};

const padDivision = (col: string) =>
  `CASE WHEN LEN(${code(col)}) = 1 THEN '0' + ${code(col)} ELSE ${code(col)} END`;

interface Row {
  /** 1 on the ROLLUP's total row. */
  is_total: number | string;
  node_code: string | null;
  budget_tm: number | string | null;
  tms: number | string | null;
}

export async function fetchHeadcount(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  grain: HeadcountGrain | null,
): Promise<Headcount> {
  const p = buildPredicate(scope, filters, { match: territoryMatch(ALIAS), prefix: 'h', months: false });

  let where = p.where;
  // With no division constrained, hold to the divisions the dashboard covers:
  // the people view also has rows under division "0" with no HQ.
  if (!p.constrained.includes('division')) {
    where += `\n    AND ${ALIAS}.div_code IN (SELECT DISTINCT ${code(DIMENSION.division.codeCol)} FROM ${SOURCE})`;
  }

  const source = `(
    SELECT div_code, hq_code, SUM(budget_tm) AS budget_tm, SUM(tms) AS tms
      FROM (
        SELECT ${padDivision('division')} AS div_code, ${code('sap_code')} AS hq_code,
               CAST(no_of_tm AS INT) AS budget_tm, CAST(NULL AS INT) AS tms
          FROM ${BUDGET_TM_SOURCE}
        UNION ALL
        SELECT ${code('divisioncode')}, ${code('sapcode')}, CAST(NULL AS INT), CAST(emp_count AS INT)
          FROM ${EMP_COUNT_SOURCE}
      ) u
     GROUP BY div_code, hq_code
  ) ${ALIAS}
  ${territoryJoin(`${ALIAS}.div_code`, `${ALIAS}.hq_code`)}`;

  // Without a grain, the total alone.
  const node = grain ? NODE[grain] : null;
  const rows = await db.all<Row>(
    `SELECT ${node ? `GROUPING(${node})` : '1'} AS is_total, ${node ?? 'CAST(NULL AS NVARCHAR(100))'} AS node_code,
       SUM(${ALIAS}.budget_tm) AS budget_tm, SUM(${ALIAS}.tms) AS tms
  FROM ${source}
  WHERE ${where}${node ? `\n  GROUP BY ROLLUP(${node})` : ''}`,
    p.params,
  );

  const out: Headcount = { budgetTm: null, tms: null, byNode: new Map() };
  for (const r of rows) {
    const figures = { budgetTm: num(r.budget_tm), tms: num(r.tms) };
    if (Number(r.is_total) === 1) Object.assign(out, figures);
    else if (grain && r.node_code !== null) out.byNode.set(r.node_code, figures);
  }
  return out;
}
