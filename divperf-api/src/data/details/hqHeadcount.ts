/**
 * HQ headcount and PCPM: per HQ, the budgeted TMs, the TMs in place, the
 * vacancy, the period's collection and PCPM — the rows behind Budget TM and
 * PCPM (Coll). Biggest vacancy first, then lowest PCPM.
 *
 *   Vacancy = budgeted TMs − TMs in place, never below 0
 *   PCPM    = collection ÷ TMs in place ÷ months selected
 */
import { DIMENSION, MEASURES, MONTH_COL, SOURCE, TERRITORY_ALIAS, code, divisionCode, num } from '../sqlFragments.js';
import { HEADCOUNT_ALIAS, headcountRows } from '../panels/headcount.js';
import { monthCount } from '../../lib/yrmn.js';
import * as M from '../../lib/metrics.js';
import { fetchPage, searchClause } from './paging.js';
import { ALL, facetValue, type DetailListDef } from './types.js';

const H = HEADCOUNT_ALIAS;
const T = TERRITORY_ALIAS;
type N = string | number | null;

export const hqHeadcountList: DetailListDef = {
  title: 'HQ headcount & PCPM',
  columns: [
    { key: 'zone', label: 'Zone', format: 'text' },
    { key: 'region', label: 'Region', format: 'text' },
    { key: 'hq', label: 'HQ', format: 'text' },
    { key: 'hqCode', label: 'SAP code', format: 'text' },
    { key: 'budgetTm', label: 'Budget TM', format: 'number' },
    { key: 'tms', label: 'TMs in place', format: 'number' },
    { key: 'vacancy', label: 'Vacancy', format: 'number' },
    { key: 'coll', label: 'Coll (₹ L)', format: 'money' },
    { key: 'pcpm', label: 'PCPM (₹ L)', format: 'money' },
  ],
  facets: () => [
    { key: 'vacancy', label: 'HQs', options: [ALL, { value: 'short', label: 'Short of budget' }] },
  ],

  async fetch(db, scope, filters, req) {
    const q = headcountRows(scope, filters);
    const months = monthCount(filters.from, filters.to);
    // Collection has no brand, so a brand selection has no collection to show.
    const brandFiltered = filters.brand.length > 0;
    const params = { ...q.params, cFrom: String(filters.from), cTo: String(filters.to) };

    let where = q.where;
    if (facetValue(this, filters, req, 'vacancy') === 'short') {
      where += `\n    AND COALESCE(${H}.budget_tm, 0) > COALESCE(${H}.tms, 0)`;
    }
    where += searchClause([`${T}.hq_name`, `${H}.hq_code`, `${T}.region_name`, `${T}.zone_name`], req.search, params);

    // The period's collection per division + HQ, from the sales table.
    const from = `${q.from}
  LEFT JOIN (
    SELECT ${divisionCode(DIMENSION.division.codeCol)} AS div_code, ${code(DIMENSION.hq.codeCol)} AS hq_code,
           ${MEASURES.coll} AS coll
      FROM ${SOURCE}
     WHERE ${MONTH_COL} BETWEEN @cFrom AND @cTo
     GROUP BY ${divisionCode(DIMENSION.division.codeCol)}, ${code(DIMENSION.hq.codeCol)}
  ) c ON c.div_code = ${H}.div_code AND c.hq_code = ${H}.hq_code`;

    const vacancy = `CASE WHEN COALESCE(${H}.budget_tm, 0) > COALESCE(${H}.tms, 0)
                 THEN COALESCE(${H}.budget_tm, 0) - COALESCE(${H}.tms, 0) ELSE 0 END`;
    const { rows, total } = await fetchPage<{
      zone: string | null; region: string | null; hq: string | null; hq_code: string | null;
      budget_tm: N; tms: N; vacancy: N; coll: N;
    }>(db, {
      select: `${T}.zone_name AS zone, ${T}.region_name AS region, ${T}.hq_name AS hq, ${H}.hq_code,
           ${H}.budget_tm, ${H}.tms, ${vacancy} AS vacancy, CAST(c.coll AS DECIMAL(38,2)) AS coll`,
      from,
      where,
      orderBy: `${vacancy} DESC, c.coll / NULLIF(${H}.tms, 0), ${T}.hq_name`,
      params,
      page: req.page,
      pageSize: req.pageSize,
    });

    return {
      total,
      note: brandFiltered
        ? 'Collection has no brand in the source, so Coll and PCPM are blank for a brand selection.'
        : `PCPM = collection ÷ TMs in place ÷ ${months} month${months === 1 ? '' : 's'}. TMs in place are today's; budget is Infinity.budgeted_tm.`,
      rows: rows.map((r) => {
        const tms = num(r.tms);
        const coll = brandFiltered ? null : num(r.coll);
        return {
          zone: r.zone,
          region: r.region,
          hq: r.hq ?? r.hq_code,
          hqCode: r.hq_code,
          budgetTm: num(r.budget_tm),
          tms,
          vacancy: num(r.vacancy),
          coll,
          pcpm: M.pcpm(coll, tms, months),
        };
      }),
    };
  },
};
