/**
 * The doctor list (visit summary): every doctor in the selection and period,
 * those the TM met, or those the TM missed (tmVisitCounts = 0). Opened from
 * Count of Drs, A / B / C, Drs Met and Drs Missed.
 */
import { VISIT_ALIAS, visitRows, type VisitStatus } from '../panels/missedDoctors.js';
import { num } from '../sqlFragments.js';
import { fetchPage, searchClause } from './paging.js';
import { ALL, facetValue, type DetailListDef } from './types.js';

const A = VISIT_ALIAS;
type N = string | number | null;

export const doctorsList: DetailListDef = {
  title: 'Doctors',
  columns: [
    { key: 'month', label: 'Month', format: 'month' },
    { key: 'zone', label: 'Zone', format: 'text' },
    { key: 'region', label: 'Region', format: 'text' },
    { key: 'hq', label: 'HQ', format: 'text' },
    { key: 'tm', label: 'TM', format: 'text' },
    { key: 'doctor', label: 'Doctor', format: 'text' },
    { key: 'doctorCode', label: 'Doctor code', format: 'text' },
    { key: 'speciality', label: 'Speciality', format: 'text' },
    { key: 'category', label: 'Cat.', format: 'text' },
    { key: 'tmVisits', label: 'TM visits', format: 'number' },
    { key: 'tmDates', label: 'TM visit dates', format: 'text' },
    { key: 'rmVisits', label: 'RM visits', format: 'number' },
    { key: 'zsmVisits', label: 'ZSM visits', format: 'number' },
  ],
  facets: () => [
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: 'missed', label: 'Missed' },
        { value: 'met', label: 'Met' },
        { value: 'all', label: 'All' },
      ],
    },
    {
      key: 'category',
      label: 'Category',
      options: [ALL, { value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }, { value: 'other', label: 'Others' }],
    },
  ],

  async fetch(db, scope, filters, req) {
    const status = facetValue(this, filters, req, 'status') as VisitStatus;
    const category = facetValue(this, filters, req, 'category');
    const q = visitRows(scope, filters, ['all', 'met', 'missed'].includes(status) ? status : 'missed');
    const params = { ...q.params };

    let where = q.where;
    if (category === 'other') where += `\n    AND (${A}.category IS NULL OR ${A}.category NOT IN ('A', 'B', 'C'))`;
    else if (category !== 'all') {
      params.cat = category;
      where += `\n    AND ${A}.category = @cat`;
    }
    where += searchClause(
      [`${A}.doctor_name`, `${A}.doctor_code`, `${A}.hq`, `${A}.tm_name`, `${A}.speciality`],
      req.search,
      params,
    );

    const { rows, total } = await fetchPage<{
      ym: string; zone: string | null; region: string | null; hq: string | null; hq_code: string | null;
      tm_name: string | null; doctor_name: string | null; doctor_code: string | null; speciality: string | null;
      category: string | null; tm_visits: N; tm_dates: string | null; rm_visits: N; zsm_visits: N;
    }>(db, {
      select: `${A}.yearMonth AS ym, ${A}.zone, ${A}.region, ${A}.hq, ${A}.hq_code, ${A}.tm_name,
           ${A}.doctor_name, ${A}.doctor_code, ${A}.speciality, ${A}.category,
           ${A}.tm_visits, ${A}.tm_dates, ${A}.rm_visits, ${A}.zsm_visits`,
      from: q.from,
      where,
      orderBy: `${A}.yearMonth, ${A}.zone, ${A}.region, ${A}.hq, ${A}.doctor_name, ${A}.doctor_code`,
      params,
      page: req.page,
      pageSize: req.pageSize,
    });

    return {
      total,
      note:
        status === 'missed'
          ? 'Doctors the TM did not visit in the month (TM visits = 0). A doctor missed in two months is listed for each.'
          : 'From the doctor visit summary; its doctor count can differ slightly from the effort summary’s Count of Drs.',
      rows: rows.map((r) => ({
        month: Number(r.ym),
        zone: r.zone,
        region: r.region,
        hq: r.hq ?? r.hq_code,
        tm: r.tm_name ?? 'Vacant',
        doctor: r.doctor_name,
        doctorCode: r.doctor_code,
        speciality: r.speciality,
        category: r.category,
        tmVisits: num(r.tm_visits),
        tmDates: r.tm_dates,
        rmVisits: num(r.rm_visits),
        zsmVisits: num(r.zsm_visits),
      })),
    };
  },
};
