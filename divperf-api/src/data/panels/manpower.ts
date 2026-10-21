/**
 * Field-force movement: leavers (config HR_EXIT_TABLE,
 * Infinity.VW_Exit_Details) and joiners (HR_HIRING_TABLE,
 * Infinity.VW_Hiring_Details) — SAP HR, one row per person.
 *
 * - Cadre is EMP_TYPE: TM, RM, ZM (the dashboard's ZSM). It agrees with
 *   Infinity's role for every person found in both.
 * - A leaver counts in the month of their DOL, the last working day. HR's MONYR
 *   is the month the exit was processed — later than the DOL month for 258 of
 *   442 leavers, by up to two months. A joiner counts in the month of BEGDA,
 *   the joining date (DOJ is blank in the hiring view).
 * - Tenure at exit is DOL − DOJ: under 6 months, 6 months to 1 year, over
 *   1 year, by calendar dates. (HR's TEN_RANGE rounds to completed months, so
 *   6 months 13 days is "3-6 Months" there and "6 months to 1 year" here.)
 * - Division comes from the cost centre (KOSTL) through
 *   HR_DIVISION_COST_CENTRES. The views carry no zone, region or HQ code — only
 *   free-text org units — so the figures are for whole divisions; whether a
 *   view can show them at all is `manpowerScope`'s call.
 *
 * Every count is made in SQL, in one round trip. (I3)
 */
import type { Db, SqlParams } from '../db.js';
import { HR_EXIT_SOURCE, HR_HIRING_SOURCE } from '../sqlFragments.js';
import type { PanelFilters } from '../queryBuilder.js';
import { permittedFor, type Scope } from '../../plugins/scope.js';
import type { CadreCounts, ManpowerPanel, TenureCounts } from '../../types/api.js';

/** What the view can show: the cost centres to count, or why it cannot. */
export type ManpowerScope =
  /** null: every cost centre (an all-divisions user with no division chosen). */
  | { ok: true; costCentres: string[] | null }
  | { ok: false; why: 'geo' }
  | { ok: false; why: 'brand' }
  | { ok: false; why: 'unmapped'; divisions: string[] };

export function manpowerScope(
  scope: Scope,
  filters: PanelFilters,
  costCentresByDivision: Record<string, string[]>,
): ManpowerScope {
  // No zone, region or HQ in the HR views: a view narrowed to one shows
  // nothing rather than its whole division's people.
  const geo =
    scope.level === 'ZONE' || scope.level === 'REGION' || scope.level === 'HQ' ||
    filters.zone.length > 0 || filters.region.length > 0 || filters.hq.length > 0;
  if (geo) return { ok: false, why: 'geo' };
  if (filters.brand.length > 0) return { ok: false, why: 'brand' };

  const permitted = permittedFor('division', scope);
  const requested = filters.division;
  const divisions =
    permitted === null
      ? requested.length ? requested : null
      : requested.length ? requested.filter((d) => permitted.includes(d)) : permitted;
  if (divisions === null) return { ok: true, costCentres: null };

  const unmapped = divisions.filter((d) => !costCentresByDivision[d]?.length);
  if (unmapped.length) return { ok: false, why: 'unmapped', divisions: unmapped };
  // An empty list — only out-of-scope divisions asked for — counts nothing.
  return { ok: true, costCentres: divisions.flatMap((d) => costCentresByDivision[d]!) };
}

export interface ManpowerResult {
  panel: ManpowerPanel;
  /** Leavers per month (YYYYMM, by DOL), by cadre — the attrition chart. */
  leftByMonth: Map<number, CadreCounts>;
}

const CADRE: Record<string, keyof CadreCounts> = { TM: 'tm', RM: 'rm', ZM: 'zsm' };
const TENURE = ['under6m', 'm6to12', 'over1y'] as const;

const zeroCadres = (): CadreCounts => ({ tm: 0, rm: 0, zsm: 0 });
const zeroTenure = (): TenureCounts => ({ under6m: 0, m6to12: 0, over1y: 0 });

interface Row {
  grp: 'total' | 'month' | 'tenure';
  kind: 'left' | 'joined';
  cadre: string;
  ym: number | string | null;
  tenure: (typeof TENURE)[number] | null;
  n: number | string;
}

const date = (col: string) => `TRY_CONVERT(date, ${col}, 112)`;

export async function fetchManpower(
  db: Db,
  filters: PanelFilters,
  costCentres: string[] | null,
): Promise<ManpowerResult> {
  const params: SqlParams = { mFrom: String(filters.from), mTo: String(filters.to) };
  let centres = '';
  if (costCentres !== null) {
    const names = costCentres.map((c, i) => {
      params[`k${i}`] = c;
      return `@k${i}`;
    });
    centres = names.length ? `AND LTRIM(RTRIM(KOSTL)) IN (${names.join(', ')})` : 'AND 1 = 0';
  }

  const rows = await db.all<Row>(
    `WITH base AS (
    SELECT 'left' AS kind, LTRIM(RTRIM(EMP_TYPE)) AS cadre, CAST(LEFT(DOL, 6) AS INT) AS ym,
           CASE WHEN ${date('DOJ')} IS NULL THEN NULL
                WHEN ${date('DOL')} < DATEADD(month, 6, ${date('DOJ')}) THEN 'under6m'
                WHEN ${date('DOL')} < DATEADD(year, 1, ${date('DOJ')}) THEN 'm6to12'
                ELSE 'over1y' END AS tenure
      FROM ${HR_EXIT_SOURCE}
     WHERE LEFT(DOL, 6) BETWEEN @mFrom AND @mTo ${centres}
    UNION ALL
    SELECT 'joined', LTRIM(RTRIM(EMP_TYPE)), CAST(LEFT(BEGDA, 6) AS INT), CAST(NULL AS VARCHAR(10))
      FROM ${HR_HIRING_SOURCE}
     WHERE LEFT(BEGDA, 6) BETWEEN @mFrom AND @mTo ${centres}
  )
  SELECT 'total' AS grp, kind, cadre, CAST(NULL AS INT) AS ym, CAST(NULL AS VARCHAR(10)) AS tenure, COUNT(*) AS n
    FROM base GROUP BY kind, cadre
  UNION ALL
  SELECT 'month', kind, cadre, ym, NULL, COUNT(*)
    FROM base WHERE kind = 'left' GROUP BY kind, cadre, ym
  UNION ALL
  SELECT 'tenure', kind, cadre, NULL, tenure, COUNT(*)
    FROM base WHERE kind = 'left' AND tenure IS NOT NULL GROUP BY kind, cadre, tenure`,
    params,
  );

  const left = zeroCadres();
  const joined = zeroCadres();
  const leftByTenure = { tm: zeroTenure(), rm: zeroTenure(), zsm: zeroTenure() };
  const leftByMonth = new Map<number, CadreCounts>();

  for (const r of rows) {
    const cadre = CADRE[r.cadre];
    if (!cadre) continue; // only TM / RM / ZM are field force
    const n = Number(r.n);
    if (r.grp === 'total') (r.kind === 'left' ? left : joined)[cadre] = n;
    else if (r.grp === 'tenure' && r.tenure) leftByTenure[cadre][r.tenure] = n;
    else if (r.grp === 'month' && r.ym !== null) {
      const ym = Number(r.ym);
      const month = leftByMonth.get(ym) ?? zeroCadres();
      month[cadre] = n;
      leftByMonth.set(ym, month);
    }
  }

  return {
    panel: {
      left,
      joined,
      leftByTenure,
    },
    leftByMonth,
  };
}
