/**
 * Hospital coverage & tier mix — RESEARCH only (config HOSPITAL_DIVISIONS).
 *
 * The hospital master list (HML, config HOSPITAL_TABLE, Infinity.Hospital_List)
 * has one row per hospital: its division, HQ (sapCode — the sales table's SAP
 * territory code) and tier (tierName "Tier 1"…"Tier 4", blank for many). It is
 * a list of today's hospitals, so the counts do not depend on the period. Zone
 * and region filters go through the territory lookup on division + HQ.
 *
 * Coverage has no per-hospital source: the list records no visits. The effort
 * data counts each territory's hospitals and those visited, per month — the
 * monthly covered / missed comes from there, and is blank while it records no
 * visits at all (as today). Coverage by tier has no source yet.
 */
import type { Db } from '../db.js';
import { EFFORT_ALIAS, HOSPITAL_SOURCE, code, divisionCode, num, territoryJoin } from '../sqlFragments.js';
import { buildPredicate, territoryMatch, type PanelFilters } from '../queryBuilder.js';
import { effortTerritories } from './effort.js';
import { permittedFor, type Scope } from '../../plugins/scope.js';
import type { HospitalMonth, HospitalPanel, HospitalTierFigures } from '../../types/api.js';
import * as M from '../../lib/metrics.js';
import { label } from '../../lib/yrmn.js';

export const HOSPITAL_ALIAS = 'hl';
const A = HOSPITAL_ALIAS;

/** The HML's tier names, in column order, with the report's labels. */
export const TIERS = [
  { source: 'Tier 1', label: 'Tier I' },
  { source: 'Tier 2', label: 'Tier II' },
  { source: 'Tier 3', label: 'Tier III' },
  { source: 'Tier 4', label: 'Tier IV' },
] as const;

/**
 * The hospital divisions this view covers: its divisions (the filter, held to
 * the user's own) that have a hospital list. Empty — no section — unless one
 * is in view; an all-divisions view with no division chosen shows none.
 */
export function hospitalDivisions(scope: Scope, filters: PanelFilters, hospitalDivisions: string[]): string[] {
  const permitted = permittedFor('division', scope);
  const requested = filters.division;
  const inView =
    permitted === null
      ? requested
      : requested.length ? requested.filter((d) => permitted.includes(d)) : permitted;
  return inView.filter((d) => hospitalDivisions.includes(d));
}

/** FROM and WHERE for the selection's hospitals, under alias `hl`: div_code, hq_code, tier and the list's own columns. */
export function hospitalRows(scope: Scope, filters: PanelFilters, divisions: string[]) {
  const p = buildPredicate(scope, { ...filters, division: divisions }, {
    match: territoryMatch(A), prefix: 'k', months: false,
  });
  const joinTerritory = p.constrained.includes('zone') || p.constrained.includes('region');
  const text = (col: string, n = 200) => `CAST(${code(col)} AS NVARCHAR(${n}))`;
  return {
    from: `(
    SELECT ${divisionCode('divisionCode')} AS div_code, ${text('sapCode', 50)} AS hq_code, ${text('tierName', 50)} AS tier,
           ${text('zone')} AS zone, ${text('region')} AS region, ${text('location')} AS location,
           ${text('employeeName')} AS tm_name, ${text('hospitalCode', 100)} AS hospital_code,
           ${text('hospitalName')} AS hospital_name, ${text('classification', 50)} AS classification,
           ${text('town')} AS town, ${text('state')} AS state, ${text('creationDate', 20)} AS created
      FROM ${HOSPITAL_SOURCE}
  ) ${A}${joinTerritory ? `\n  ${territoryJoin(`${A}.div_code`, `${A}.hq_code`)}` : ''}`,
    where: p.where,
    params: p.params,
  };
}

const figures = (labelText: string, count: number): HospitalTierFigures => ({
  label: labelText, count, covered: null, coveredPct: null, missed: null,
});

export async function fetchHospitals(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  divisions: string[],
  effortNames: Record<string, string>,
): Promise<HospitalPanel> {
  const q = hospitalRows(scope, filters, divisions);
  const effort = effortTerritories(scope, { ...filters, division: divisions }, effortNames);

  const [tierRows, monthRows] = await Promise.all([
    db.all<{ tier: string | null; n: number | string }>(
      `SELECT ${A}.tier AS tier, COUNT_BIG(*) AS n
  FROM ${q.from}
  WHERE ${q.where}
  GROUP BY ${A}.tier`,
      q.params,
    ),
    effort
      ? db.all<{ ym: string; total: number | string | null; met: number | string | null }>(
          `SELECT ${EFFORT_ALIAS}.yearMonth AS ym, SUM(${EFFORT_ALIAS}.hosp_total) AS total, SUM(${EFFORT_ALIAS}.hosp_met) AS met
  FROM ${effort.from}
  WHERE ${effort.where}
  GROUP BY ${EFFORT_ALIAS}.yearMonth
  ORDER BY ${EFFORT_ALIAS}.yearMonth`,
          effort.params,
        )
      : Promise.resolve([]),
  ]);

  const byTier = new Map(tierRows.map((r) => [r.tier ?? '', Number(r.n)]));
  const tiers = TIERS.map((t) => figures(t.label, byTier.get(t.source) ?? 0));
  const tiered = tiers.reduce((s, t) => s + t.count, 0);
  const total = [...byTier.values()].reduce((s, n) => s + n, 0);

  // No visit at all in the period means visits are not recorded, not that
  // every hospital was missed.
  const recorded = monthRows.some((r) => (num(r.met) ?? 0) > 0);
  const months: HospitalMonth[] = monthRows
    .filter((r) => (num(r.total) ?? 0) > 0)
    .map((r) => {
      const all = num(r.total);
      const covered = recorded ? (num(r.met) ?? 0) : null;
      return {
        yrMn: Number(r.ym),
        label: label(Number(r.ym)),
        total: all,
        covered,
        missed: covered === null || all === null ? null : Math.max(all - covered, 0),
        coveragePct: covered === null ? null : M.pct(covered, all),
      };
    });

  return { total: figures('Total', total), tiers, untiered: total - tiered, months };
}

