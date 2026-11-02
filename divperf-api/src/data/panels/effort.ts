/**
 * Doctor coverage and call effort (config EFFORT_TABLE, dbo.infinity_effort_data):
 * one row per location and month, every column nvarchar.
 *
 * - Rows come at every level of the field structure — Territory, Region,
 *   Zone, Sales Area, All India, BU Head — and the upper levels hold their
 *   manager's own figures, not rollups. Only Territory rows are read: they
 *   carry the doctor lists, and summing them gives the totals.
 * - The month is the first six characters of effortdate (YYYYMMDD).
 * - Division is a name (division_name), mapped to a code by EFFORT_DIVISIONS.
 *   A name shared by several codes is split by the territory lookup.
 * - The HQ is sap_code, the sales table's SAP territory code; zone and region
 *   come from the territory lookup on division + HQ. Several territories can
 *   share an HQ code (two TMs in Chennai): they are summed.
 *
 * The measures, from the territory rows of the selection:
 *
 *   Count of Drs (A / B / C) = total_count (a_count, b_count, c_count)
 *   Drs Met          = total_dr_count_visited
 *   Coverage %       = Drs Met ÷ Count of Drs — total_dr_coverage is this,
 *                      truncated, on every row
 *   Rt Frq Covrg %   = total_freq_dr_coverage, weighted by each list's size
 *   Call Avg         = total_dr_call_count ÷ field_days — overall_call_average
 *                      is this on every row
 *   Field Days       = field_days per territory that worked (a vacant
 *                      territory has 0)
 *
 * Over several months the counts and field days are per month, averaged over
 * the months with effort data — a doctor on the list in August and September is
 * one doctor, not two. A+, Drs Met with Rt Frq, Drs Missed and Missed with Rt
 * Frq have no source and are null.
 *
 * Sums in SQL, one round trip; ratios in lib/metrics.ts. (I3, I4)
 */
import type { Db, SqlParams } from '../db.js';
import { EFFORT_ALIAS, EFFORT_SOURCE, TERRITORY_ALIAS, code, num, territoryJoin } from '../sqlFragments.js';
import { buildPredicate, territoryMatch, type PanelFilters } from '../queryBuilder.js';
import { permittedFor, type Scope } from '../../plugins/scope.js';
import type { EffortFigures, EffortMonth, EffortPanel } from '../../types/api.js';
import * as M from '../../lib/metrics.js';
import { label } from '../../lib/yrmn.js';

/** What the view can show: the division names to read, or why it cannot. */
export type EffortScope =
  | { ok: true; unmapped: string[] }
  | { ok: false; unmapped: string[] };

/**
 * Effort exists for the divisions EFFORT_DIVISIONS names. A view over
 * divisions none of which is mapped cannot be shown; one over some mapped and
 * some not shows the mapped ones and names the rest.
 */
export function effortScope(
  scope: Scope,
  filters: PanelFilters,
  namesByDivision: Record<string, string>,
): EffortScope {
  const permitted = permittedFor('division', scope);
  const requested = filters.division;
  const divisions =
    permitted === null
      ? requested.length ? requested : null
      : requested.length ? requested.filter((d) => permitted.includes(d)) : permitted;
  if (divisions === null) return { ok: true, unmapped: [] };
  const unmapped = divisions.filter((d) => !namesByDivision[d]);
  return { ok: unmapped.length < divisions.length, unmapped };
}

interface Row {
  ym: number | string;
  tc: number | string | null;
  a: number | string | null;
  b: number | string | null;
  c: number | string | null;
  met: number | string | null;
  fcov_w: number | string | null;
  calls: number | string | null;
  fd: number | string | null;
  fd_terr: number | string | null;
}

/** The additive sums one month, or a period, carries. */
interface Sums {
  months: number;
  tc: number;
  a: number;
  b: number;
  c: number;
  met: number;
  fcovW: number;
  calls: number;
  fd: number;
  fdTerr: number;
}

const ZERO: Sums = { months: 0, tc: 0, a: 0, b: 0, c: 0, met: 0, fcovW: 0, calls: 0, fd: 0, fdTerr: 0 };

export const NO_EFFORT: EffortFigures = {
  drs: null, aPlus: null, a: null, b: null, c: null,
  drsMet: null, coveragePct: null, drsMetRtFrq: null, rtFrqCoveragePct: null,
  callAvg: null, drsMissed: null, missedRtFrq: null, fieldDays: null,
};

/** Figures from sums; null throughout when no month has a doctor list. */
function figures(s: Sums): EffortFigures {
  if (s.months === 0 || s.tc === 0) return NO_EFFORT;
  const perMonth = (v: number) => M.perMonth(v, s.months);
  return {
    ...NO_EFFORT,
    drs: perMonth(s.tc),
    a: perMonth(s.a),
    b: perMonth(s.b),
    c: perMonth(s.c),
    drsMet: perMonth(s.met),
    coveragePct: M.pct(s.met, s.tc),
    rtFrqCoveragePct: M.ratio(s.fcovW, s.tc),
    callAvg: M.callAverage(s.calls, s.fd),
    fieldDays: M.ratio(s.fd, s.fdTerr),
  };
}

const ALIAS = EFFORT_ALIAS;
const T = TERRITORY_ALIAS;
const dec = (col: string, scale = 2) => `TRY_CAST(x.${col} AS DECIMAL(18,${scale}))`;

const text = (col: string, n = 200) => `CAST(${code(`x.${col}`)} AS NVARCHAR(${n}))`;

/**
 * FROM and WHERE for the selection's territory rows, under alias `ef`, with
 * yearMonth, div_code, hq_code, the numeric measures (tc, a, b, c, met, fcov,
 * calls, fd, hosp_total, hosp_met) and the names a list shows (zone_name, region_name, hq_name,
 * emp_code, emp_name). Null when no division name is mapped.
 */
export function effortTerritories(
  scope: Scope,
  filters: PanelFilters,
  namesByDivision: Record<string, string>,
): { from: string; where: string; params: SqlParams } | null {
  const p = buildPredicate(scope, filters, { match: territoryMatch(ALIAS), prefix: 'e' });
  const params: SqlParams = { ...p.params };

  // Division code for each name. A name under several codes is "shared": its
  // rows are kept only where the territory lookup places the HQ in that code.
  const entries = Object.entries(namesByDivision);
  const uses = new Map<string, number>();
  for (const [, name] of entries) uses.set(name, (uses.get(name) ?? 0) + 1);
  const shared = entries.some(([, name]) => uses.get(name)! > 1);
  const divisions = entries
    .map(([div, name], i) => {
      params[`ed${i}`] = div;
      params[`en${i}`] = name;
      return `SELECT @ed${i} AS div_code, @en${i} AS div_name, ${uses.get(name)! > 1 ? 1 : 0} AS shared`;
    })
    .join('\n          UNION ALL ');
  if (!divisions) return null;

  // The lookup scans the sales table, so it is joined only when needed.
  const joinTerritory = shared || p.constrained.includes('zone') || p.constrained.includes('region');
  const keepShared = shared
    ? `\n    AND (${ALIAS}.shared = 0 OR ${T}.hq_code IS NOT NULL)`
    : '';

  return {
    from: `(
    SELECT LEFT(x.effortdate, 6) AS yearMonth, dm.div_code, dm.shared,
           ${text('sap_code', 50)} AS hq_code,
           ${text('zone_name')} AS zone_name, ${text('region_name')} AS region_name,
           ${text('locat_name')} AS hq_name, ${text('emp_code', 50)} AS emp_code, ${text('emp_name')} AS emp_name,
           ${dec('total_count')} AS tc, ${dec('a_count')} AS a, ${dec('b_count')} AS b, ${dec('c_count')} AS c,
           ${dec('total_dr_count_visited')} AS met,
           ${dec('total_freq_dr_coverage', 4)} AS fcov,
           ${dec('total_dr_call_count')} AS calls,
           ${dec('field_days')} AS fd,
           ${dec('hospital_total_count')} AS hosp_total,
           ${dec('total_hospital_count_visited')} AS hosp_met
      FROM ${EFFORT_SOURCE} x
      JOIN (${divisions}) dm
        ON dm.div_name = LTRIM(RTRIM(x.division_name))
     WHERE LTRIM(RTRIM(x.locat_type)) = 'Territory'
  ) ${ALIAS}${joinTerritory ? `\n  ${territoryJoin(`${ALIAS}.div_code`, `${ALIAS}.hq_code`)}` : ''}`,
    where: `${p.where}${keepShared}`,
    params,
  };
}

export async function fetchEffort(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  namesByDivision: Record<string, string>,
): Promise<EffortPanel> {
  const q = effortTerritories(scope, filters, namesByDivision);
  if (!q) return { total: NO_EFFORT, months: [] };

  const rows = await db.all<Row>(
    `SELECT ${ALIAS}.yearMonth AS ym,
       SUM(${ALIAS}.tc) AS tc, SUM(${ALIAS}.a) AS a, SUM(${ALIAS}.b) AS b, SUM(${ALIAS}.c) AS c,
       SUM(${ALIAS}.met) AS met,
       SUM(${ALIAS}.fcov * ${ALIAS}.tc) AS fcov_w,
       SUM(${ALIAS}.calls) AS calls,
       SUM(${ALIAS}.fd) AS fd,
       COUNT(CASE WHEN ${ALIAS}.fd > 0 THEN 1 END) AS fd_terr
  FROM ${q.from}
  WHERE ${q.where}
  GROUP BY ${ALIAS}.yearMonth
  ORDER BY ${ALIAS}.yearMonth`,
    q.params,
  );

  const total = { ...ZERO };
  const months: EffortMonth[] = [];
  for (const r of rows) {
    const s: Sums = {
      months: 1,
      tc: num(r.tc) ?? 0,
      a: num(r.a) ?? 0,
      b: num(r.b) ?? 0,
      c: num(r.c) ?? 0,
      met: num(r.met) ?? 0,
      fcovW: num(r.fcov_w) ?? 0,
      calls: num(r.calls) ?? 0,
      fd: num(r.fd) ?? 0,
      fdTerr: num(r.fd_terr) ?? 0,
    };
    // A month whose lists are all empty carries no effort data.
    if (s.tc === 0) continue;
    for (const k of Object.keys(total) as (keyof Sums)[]) total[k] += s[k];
    const yrMn = Number(r.ym);
    months.push({ yrMn, label: label(yrMn), ...figures(s) });
  }

  return { total: figures(total), months };
}
