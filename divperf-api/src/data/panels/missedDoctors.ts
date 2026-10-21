/**
 * Missed doctors (config VISIT_SUMMARY_TABLE, dbo.infinity_Visit_Summary): one
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
 * Counting and paging are done in SQL. (I3)
 */
import type { Db, SqlParams } from '../db.js';
import {
  DIMENSION, SOURCE, VISIT_SOURCE, code, num, territoryJoin,
} from '../sqlFragments.js';
import { buildPredicate, territoryMatch, type PanelFilters } from '../queryBuilder.js';
import type { Scope } from '../../plugins/scope.js';
import type { MissedDoctorRow, MissedDoctorsResponse } from '../../types/api.js';

const ALIAS = 'vs';

/** Text columns are nvarchar(max); a bounded copy can be sorted and compared. */
const text = (col: string, n = 200) => `CAST(${code(col)} AS NVARCHAR(${n}))`;

/** The missed rows, with the columns every query reads. */
const MISSED = `(
    SELECT LEFT(effortdate, 6) AS yearMonth,
           ${code('divisionCode')} AS div_code,
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
           rmVisitCounts AS rm_visits,
           zsmVisitCounts AS zsm_visits
      FROM ${VISIT_SOURCE}
     WHERE tmVisitCounts = 0
  ) ${ALIAS}`;

/** FROM and WHERE for the selection: the filters and the user's scope. */
function missedQuery(scope: Scope, filters: PanelFilters): { from: string; where: string; params: SqlParams } {
  const p = buildPredicate(scope, filters, { match: territoryMatch(ALIAS), prefix: 'v' });
  const joinTerritory = p.constrained.includes('zone') || p.constrained.includes('region');

  let where = p.where;
  // With no division constrained, hold to the divisions the dashboard covers:
  // the table also has rows under division "0" (Market Access, Nepal, tests).
  if (!p.constrained.includes('division')) {
    where += `\n    AND ${ALIAS}.div_code IN (SELECT DISTINCT ${code(DIMENSION.division.codeCol)} FROM ${SOURCE})`;
  }
  return {
    from: `${MISSED}${joinTerritory ? `\n  ${territoryJoin(`${ALIAS}.div_code`, `${ALIAS}.hq_code`)}` : ''}`,
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
  const { from, where, params } = missedQuery(scope, filters);
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

export interface MissedListOptions {
  page: number;
  pageSize: number;
  /** Matched against doctor name and code, HQ, TM and speciality. */
  search?: string;
  /** Only these categories ("Unclassified" for none). */
  categories?: string[];
}

interface ListRow {
  rn: string | number;
  total: string | number;
  ym: string | number;
  zone: string | null;
  region: string | null;
  hq: string | null;
  hq_code: string | null;
  tm_code: string | null;
  tm_name: string | null;
  doctor_code: string | null;
  doctor_name: string | null;
  speciality: string | null;
  category: string | null;
  rm_visits: string | number | null;
  zsm_visits: string | number | null;
}

/** LIKE pattern for a search term: its wildcards matched literally. */
const likeTerm = (s: string) => `%${s.replace(/[%_[]/g, '[$&]')}%`;

/**
 * One page of the missed doctors, by month, zone, region, HQ and doctor. The
 * dedicated pool has no OFFSET/FETCH, so pages are cut by ROW_NUMBER, and the
 * total comes from the same pass (COUNT(*) OVER ()).
 */
export async function fetchMissedDoctors(
  db: Db,
  scope: Scope,
  filters: PanelFilters,
  { page, pageSize, search, categories }: MissedListOptions,
): Promise<MissedDoctorsResponse> {
  const q = missedQuery(scope, filters);
  const params: SqlParams = { ...q.params };
  let where = q.where;

  const term = search?.trim();
  if (term) {
    params.q = likeTerm(term);
    where += `\n    AND (${['doctor_name', 'doctor_code', 'hq', 'tm_name', 'speciality']
      .map((c) => `${ALIAS}.${c} LIKE @q`)
      .join(' OR ')})`;
  }
  if (categories?.length) {
    const named = categories.filter((c) => c !== NO_CATEGORY);
    const parts = named.map((c, i) => {
      params[`k${i}`] = c;
      return `@k${i}`;
    });
    const clauses = [
      ...(parts.length ? [`${ALIAS}.category IN (${parts.join(', ')})`] : []),
      ...(categories.includes(NO_CATEGORY) ? [`${ALIAS}.category IS NULL`] : []),
    ];
    where += `\n    AND (${clauses.join(' OR ')})`;
  }

  params.rFrom = (page - 1) * pageSize + 1;
  params.rTo = page * pageSize;

  const rows = await db.all<ListRow>(
    `SELECT x.* FROM (
    SELECT ${ALIAS}.yearMonth AS ym, ${ALIAS}.zone, ${ALIAS}.region, ${ALIAS}.hq, ${ALIAS}.hq_code,
           ${ALIAS}.tm_code, ${ALIAS}.tm_name, ${ALIAS}.doctor_code, ${ALIAS}.doctor_name,
           ${ALIAS}.speciality, ${ALIAS}.category, ${ALIAS}.rm_visits, ${ALIAS}.zsm_visits,
           ROW_NUMBER() OVER (ORDER BY ${ALIAS}.yearMonth, ${ALIAS}.zone, ${ALIAS}.region, ${ALIAS}.hq,
                                       ${ALIAS}.doctor_name, ${ALIAS}.doctor_code) AS rn,
           COUNT_BIG(*) OVER () AS total
      FROM ${q.from}
     WHERE ${where}
  ) x
  WHERE x.rn BETWEEN @rFrom AND @rTo
  ORDER BY x.rn`,
    params,
  );

  return {
    total: rows.length ? Number(rows[0]!.total) : 0,
    page,
    pageSize,
    rows: rows.map(
      (r): MissedDoctorRow => ({
        month: Number(r.ym),
        zone: r.zone,
        region: r.region,
        hq: r.hq,
        hqCode: r.hq_code,
        tmName: r.tm_name,
        tmCode: r.tm_code,
        doctorCode: r.doctor_code,
        doctorName: r.doctor_name,
        speciality: r.speciality,
        category: r.category,
        rmVisits: num(r.rm_visits),
        zsmVisits: num(r.zsm_visits),
      }),
    ),
  };
}
