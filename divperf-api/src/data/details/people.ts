/**
 * Leavers and joiners (SAP HR exit and hiring views), one row per person:
 * the people behind the attrition panel's counts. Field force only (TM, RM,
 * ZM shown as ZSM), counted by the month of leaving (DOL) or joining (BEGDA),
 * division-level only — the views carry a cost centre, not a territory, so the
 * scope rules are manpowerScope's.
 */
import { config } from '../../config.js';
import { HR_EXIT_SOURCE, HR_HIRING_SOURCE } from '../sqlFragments.js';
import { TENURE_CASE, costCentreClause, manpowerScope } from '../panels/manpower.js';
import type { SqlParams } from '../db.js';
import { fetchPage, searchClause } from './paging.js';
import { ALL, facetValue, type DetailListDef, type DetailRow } from './types.js';

const CADRE_LABEL: Record<string, string> = { TM: 'TM', RM: 'RM', ZM: 'ZSM' };
const TENURE_LABEL: Record<string, string> = {
  under6m: '< 6 Months',
  m6to12: '6 months to 1 Year',
  over1y: '> 1 Year',
};

const UNAVAILABLE = {
  geo: 'The HR exit and hiring views carry a cost centre, not a zone, region or HQ, so this list is shown for whole divisions only.',
  brand: 'People are not tracked by brand, so this list does not apply to a brand selection.',
  unmapped: (d: string[]) =>
    `No HR cost centre is mapped to ${d.length === 1 ? 'division' : 'divisions'} ${d.join(', ')} yet (HR_DIVISION_COST_CENTRES), so its people cannot be picked out.`,
};

const cadreFacet = {
  key: 'cadre',
  label: 'Cadre',
  options: [ALL, { value: 'TM', label: 'TM' }, { value: 'RM', label: 'RM' }, { value: 'ZM', label: 'ZSM' }],
};

const text = (col: string, n = 200) => `CAST(NULLIF(LTRIM(RTRIM(${col})), '') AS NVARCHAR(${n}))`;
const CADRE = 'LTRIM(RTRIM(EMP_TYPE))';

type PersonRow = {
  name: string | null; emp_code: string | null; cadre: string | null; designation: string | null;
  location: string | null; org: string | null; doj: string | null; dol: string | null;
  tenure: string | null; reason: string | null; joined: string | null; source: string | null;
};

/** Shared by both lists: scope check, cadre and month filters, search, one page. */
function peopleList(kind: 'leavers' | 'joiners'): DetailListDef {
  const leavers = kind === 'leavers';
  const dateCol = leavers ? 'DOL' : 'BEGDA';

  return {
    title: leavers ? 'Leavers' : 'New joiners',
    columns: [
      { key: 'name', label: 'Name', format: 'text' },
      { key: 'empCode', label: 'Emp code', format: 'text' },
      { key: 'cadre', label: 'Cadre', format: 'text' },
      { key: 'designation', label: 'Designation', format: 'text' },
      { key: 'location', label: 'Location', format: 'text' },
      { key: 'org', label: 'Region / unit', format: 'text' },
      ...(leavers
        ? [
            { key: 'doj', label: 'Joined', format: 'date' as const },
            { key: 'dol', label: 'Left', format: 'date' as const },
            { key: 'tenure', label: 'Tenure', format: 'text' as const },
            { key: 'reason', label: 'Reason for leaving', format: 'text' as const },
          ]
        : [
            { key: 'joined', label: 'Joined', format: 'date' as const },
            { key: 'source', label: 'Source of hire', format: 'text' as const },
          ]),
    ],
    facets: () => [
      cadreFacet,
      ...(leavers
        ? [{
            key: 'tenure',
            label: 'Tenure',
            options: [ALL, ...Object.entries(TENURE_LABEL).map(([value, label]) => ({ value, label }))],
          }]
        : []),
    ],

    async fetch(db, scope, filters, req) {
      const people = manpowerScope(scope, filters, config.HR_DIVISION_COST_CENTRES);
      if (!people.ok) {
        return {
          rows: [],
          total: 0,
          unavailable:
            people.why === 'geo' ? UNAVAILABLE.geo : people.why === 'brand' ? UNAVAILABLE.brand : UNAVAILABLE.unmapped(people.divisions),
        };
      }

      const params: SqlParams = { mFrom: String(filters.from), mTo: String(filters.to) };
      let where = `LEFT(${dateCol}, 6) BETWEEN @mFrom AND @mTo
       AND ${CADRE} IN ('TM', 'RM', 'ZM') ${costCentreClause(people.costCentres, params)}`;
      const cadre = facetValue(this, filters, req, 'cadre');
      if (cadre !== 'all') {
        params.cadre = cadre;
        where += `\n    AND ${CADRE} = @cadre`;
      }
      if (leavers) {
        const tenure = facetValue(this, filters, req, 'tenure');
        if (tenure !== 'all') {
          params.tenure = tenure;
          where += `\n    AND ${TENURE_CASE} = @tenure`;
        }
      }
      where += searchClause([text('ENAME'), text('PERNR', 20), text('BTEXT'), text('STEXT2')], req.search, params);

      const { rows, total } = await fetchPage<PersonRow>(db, {
        select: `${text('ENAME')} AS name, ${text('PERNR', 20)} AS emp_code, ${CADRE} AS cadre,
           ${text('STEXT3')} AS designation, ${text('BTEXT')} AS location, ${text('STEXT2')} AS org,
           ${text('DOJ', 8)} AS doj, ${text('DOL', 8)} AS dol,
           ${leavers ? TENURE_CASE : 'CAST(NULL AS VARCHAR(10))'} AS tenure,
           ${text('MGTXT')} AS reason, ${text('BEGDA', 8)} AS joined, ${text('STEXT')} AS source`,
        from: leavers ? HR_EXIT_SOURCE : HR_HIRING_SOURCE,
        where,
        orderBy: `${dateCol} DESC, ${text('ENAME')}`,
        params,
        page: req.page,
        pageSize: req.pageSize,
      });

      return {
        total,
        note: leavers
          ? 'Field force (TM, RM, ZSM) who left in the period, by last working day. Tenure is from joining to leaving.'
          : 'Field force (TM, RM, ZSM) who joined in the period.',
        rows: rows.map((r): DetailRow => ({
          name: r.name,
          empCode: r.emp_code?.replace(/^0+/, '') ?? null,
          cadre: CADRE_LABEL[r.cadre ?? ''] ?? r.cadre,
          designation: r.designation,
          location: r.location,
          org: r.org,
          ...(leavers
            ? { doj: r.doj, dol: r.dol, tenure: TENURE_LABEL[r.tenure ?? ''] ?? null, reason: r.reason }
            : { joined: r.joined, source: r.source }),
        })),
      };
    },
  };
}

export const leaversList = peopleList('leavers');
export const joinersList = peopleList('joiners');
