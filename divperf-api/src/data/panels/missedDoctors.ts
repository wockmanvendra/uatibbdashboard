/**
 * Doctor visits (config VISIT_SUMMARY_TABLE, dbo.infinity_Visit_Summary): one
 * row per doctor, territory and month, with the TM's, RM's and ZSM's visit
 * counts. A doctor is missed when the TM did not visit them: tmVisitCounts = 0.
 *
 * - The month is the first six characters of effortdate (YYYYMMDD).
 * - divisionCode is the sales division code; sapCode is the sales table's SAP
 *   territory code, the HQ. Zone and region filters go through the territory
 *   lookup on the two, as for credit notes and effort. The zone, region and HQ
 *   shown are the table's own names.
 * - A doctor missed in two months, or listed under two territories, counts once
 *   for each: the count is the number of rows the list shows.
 * - Doctors are not split by brand, so a brand filter leaves the list whole.
 *
 * This module counts the missed doctors for the Effort Dashboard; the list
 * itself is details/doctors.ts. Counting is done in SQL. (I3)
 */
import type { Db, SqlParams } from '../db.js';
import {
  DIMENSION, SOURCE, VISIT_SOURCE, code, divisionCode, num, territoryJoin,
} from '../sqlFragments.js';
import { buildPredicate, territoryMatch, type PanelFilters } from '../queryBuilder.js';
import type { Scope } from '../../plugins/scope.js';

export const VISIT_ALIAS = 'vs';
const ALIAS = VISIT_ALIAS;

/** Text columns are nvarchar(max); a bounded copy can be sorted and compared. */
const text = (col: string, n = 200) => `CAST(${code(col)} AS NVARCHAR(${n}))`;

/** Which doctors: every one, those the TM met, or those the TM missed. */
export type VisitStatus = 'all' | 'met' | 'missed';

const STATUS_CONDITION: Record<VisitStatus, string> = {
  all: '1 = 1',
  met: 'tmVisitCounts > 0',
  missed: 'tmVisitCounts = 0',
};

/**
 * FROM and WHERE for the selection's visit rows, under alias `vs`, with
 * yearMonth, div_code, hq_code, zone, region, hq, tm_code, tm_name,
 * doctor_code, doctor_name, speciality, category, tm_visits, tm_dates,
 * rm_visits and zsm_visits.
 */
export function visitRows(
  scope: Scope,
  filters: PanelFilters,
  status: VisitStatus,
): { from: string; where: string; params: SqlParams } {
  const p = buildPredicate(scope, filters, { match: territoryMatch(ALIAS), prefix: 'v' });
  const joinTerritory = p.constrained.includes('zone') || p.constrained.includes('region');

  let where = p.where;
  // With no division constrained, hold to the divisions the dashboard covers:
  // the table also has rows under division "0" (Market Access, Nepal, tests).
  if (!p.constrained.includes('division')) {
    where += `\n    AND ${ALIAS}.div_code IN (SELECT DISTINCT ${divisionCode(DIMENSION.division.codeCol)} FROM ${SOURCE})`;
  }
  const rows = `(
    SELECT LEFT(effortdate, 6) AS yearMonth,
           ${divisionCode('divisionCode')} AS div_code,
           ${text('sapCode', 50)} AS hq_code,
           ${text('zone')} AS zone,
           ${text('region')} AS region,
           ${text('hq')} AS hq,
           ${text('employeeCode', 50)} AS tm_code,
           ${text('employeeName')} AS tm_name,
           ${text('doctorCode', 100)} AS doctor_code,
           ${text('doctorName')} AS doctor_name,
           ${text('speciality')} AS speciality,
           ${text('classification', 50)} AS category,
           tmVisitCounts AS tm_visits,
           ${text('tmVisitDates', 400)} AS tm_dates,
           rmVisitCounts AS rm_visits,
           zsmVisitCounts AS zsm_visits
      FROM ${VISIT_SOURCE}
     WHERE ${STATUS_CONDITION[status]}
  ) ${ALIAS}`;
  return {
    from: `${rows}${joinTerritory ? `\n  ${territoryJoin(`${ALIAS}.div_code`, `${ALIAS}.hq_code`)}` : ''}`,
    where,
    params: p.params,
  };
}

/** A, B, C first — the doctor categories — then the rest by name. */
export function categoryOrder(a: string, b: string): number {
  const rank = (c: string) => (['A', 'B', 'C'].indexOf(c) + 1 || 4);
  return rank(a) - rank(b) || a.localeCompare(b);
}

export const NO_CATEGORY = 'Unclassified';

export interface MissedSummary {
  /** Every missed row in the selection and period. */
  total: number;
  byMonth: Map<number, number>;
  /** By category, A, B, C first. */
  byCategory: { label: string; value: number }[];
}

/** Missed doctors per month and per category, in one round trip. */
export async function fetchMissedSummary(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
): Promise<MissedSummary> {
  const { from, where, params } = visitRows(scope, filters, 'missed');
  const rows = await db.all<{ ym: string | number; category: string | null; n: string | number }>(
    `SELECT ${ALIAS}.yearMonth AS ym, ${ALIAS}.category AS category, COUNT_BIG(*) AS n
  FROM ${from}
  WHERE ${where}
  GROUP BY ${ALIAS}.yearMonth, ${ALIAS}.category`,
    params,
  );

  const byMonth = new Map<number, number>();
  const byCategory = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const n = num(r.n) ?? 0;
    const ym = Number(r.ym);
    const category = r.category ?? NO_CATEGORY;
    total += n;
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + n);
    byCategory.set(category, (byCategory.get(category) ?? 0) + n);
  }
  return {
    total,
    byMonth,
    byCategory: [...byCategory]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => categoryOrder(a.label, b.label)),
  };
}
