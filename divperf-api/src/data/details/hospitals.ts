/**
 * The hospital master list (RESEARCH): the hospitals behind "Count of Hosp in
 * HML", by tier. Opened from the HML table; the selection's scope applies.
 */
import { config } from '../../config.js';
import { HOSPITAL_ALIAS, TIERS, hospitalDivisions, hospitalRows } from '../panels/hospitals.js';
import { fetchPage, searchClause } from './paging.js';
import { ALL, facetValue, type DetailListDef } from './types.js';

const A = HOSPITAL_ALIAS;
const TIER_LABEL = new Map<string, string>(TIERS.map((t) => [t.source, t.label]));

export const hospitalsList: DetailListDef = {
  title: 'Hospital master list',
  columns: [
    { key: 'zone', label: 'Zone', format: 'text' },
    { key: 'region', label: 'Region', format: 'text' },
    { key: 'hq', label: 'HQ', format: 'text' },
    { key: 'tm', label: 'TM', format: 'text' },
    { key: 'hospital', label: 'Hospital', format: 'text' },
    { key: 'code', label: 'Code', format: 'text' },
    { key: 'tier', label: 'Tier', format: 'text' },
    { key: 'classification', label: 'Class', format: 'text' },
    { key: 'town', label: 'Town', format: 'text' },
    { key: 'state', label: 'State', format: 'text' },
    { key: 'created', label: 'Added', format: 'text' },
  ],
  facets: () => [
    {
      key: 'tier',
      label: 'Tier',
      options: [ALL, ...TIERS.map((t) => ({ value: t.source, label: t.label })), { value: 'none', label: 'No tier' }],
    },
  ],

  async fetch(db, scope, filters, req) {
    const divisions = hospitalDivisions(scope, filters, config.HOSPITAL_DIVISIONS);
    if (!divisions.length) {
      return { rows: [], total: 0, unavailable: 'The hospital master list is kept for RESEARCH only. Choose that division to see it.' };
    }
    const q = hospitalRows(scope, filters, divisions);
    const params = { ...q.params };
    let where = q.where;

    const tier = facetValue(this, filters, req, 'tier');
    if (tier === 'none') where += `\n    AND ${A}.tier IS NULL`;
    else if (tier !== 'all') {
      params.tier = tier;
      where += `\n    AND ${A}.tier = @tier`;
    }
    where += searchClause(
      [`${A}.hospital_name`, `${A}.hospital_code`, `${A}.location`, `${A}.tm_name`, `${A}.town`],
      req.search,
      params,
    );

    const { rows, total } = await fetchPage<{
      zone: string | null; region: string | null; location: string | null; hq_code: string | null;
      tm_name: string | null; hospital_name: string | null; hospital_code: string | null; tier: string | null;
      classification: string | null; town: string | null; state: string | null; created: string | null;
    }>(db, {
      select: `${A}.zone, ${A}.region, ${A}.location, ${A}.hq_code, ${A}.tm_name, ${A}.hospital_name,
           ${A}.hospital_code, ${A}.tier, ${A}.classification, ${A}.town, ${A}.state, ${A}.created`,
      from: q.from,
      where,
      orderBy: `COALESCE(${A}.tier, 'Tier 9'), ${A}.zone, ${A}.region, ${A}.location, ${A}.hospital_name`,
      params,
      page: req.page,
      pageSize: req.pageSize,
    });

    return {
      total,
      note: 'Hospitals in the master list for the selection, by tier. Visits are not recorded per hospital yet.',
      rows: rows.map((r) => ({
        zone: r.zone,
        region: r.region,
        hq: r.location ?? r.hq_code,
        tm: r.tm_name ?? 'Vacant',
        hospital: r.hospital_name,
        code: r.hospital_code,
        tier: r.tier ? (TIER_LABEL.get(r.tier) ?? r.tier) : null,
        classification: r.classification,
        town: r.town,
        state: r.state,
        created: r.created,
      })),
    };
  },
};
