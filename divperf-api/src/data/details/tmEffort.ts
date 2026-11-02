/**
 * TM-wise effort: one row per territory and month from the effort data, the
 * rows behind the Effort Dashboard's Covrg%, Rt Frq Covrg%, Call Avg and Field
 * Days. Weakest coverage first; a territory without a TM is "Vacant".
 *
 *   Covrg %   = Drs Met ÷ Drs        (as the panel computes it)
 *   Call Avg  = calls ÷ field days
 */
import { config } from '../../config.js';
import { EFFORT_ALIAS, num } from '../sqlFragments.js';
import { effortScope, effortTerritories } from '../panels/effort.js';
import { label, monthRange } from '../../lib/yrmn.js';
import * as M from '../../lib/metrics.js';
import { fetchPage, searchClause } from './paging.js';
import { ALL, facetValue, type DetailListDef } from './types.js';

const A = EFFORT_ALIAS;
type N = string | number | null;

export const tmEffortList: DetailListDef = {
  title: 'TM-wise effort',
  columns: [
    { key: 'month', label: 'Month', format: 'month' },
    { key: 'zone', label: 'Zone', format: 'text' },
    { key: 'region', label: 'Region', format: 'text' },
    { key: 'hq', label: 'Territory', format: 'text' },
    { key: 'tm', label: 'TM', format: 'text' },
    { key: 'drs', label: 'Drs', format: 'number' },
    { key: 'met', label: 'Drs Met', format: 'number' },
    { key: 'coverage', label: 'Covrg%', format: 'percent' },
    { key: 'rtFrqCoverage', label: 'Rt Frq Covrg%', format: 'percent' },
    { key: 'calls', label: 'Calls', format: 'number' },
    { key: 'callAvg', label: 'Call Avg', format: 'decimal' },
    { key: 'fieldDays', label: 'Field Days', format: 'decimal' },
  ],
  facets: (filters) => [
    {
      key: 'month',
      label: 'Month',
      options: [ALL, ...monthRange(filters.from, filters.to).map((m) => ({ value: String(m), label: label(m) }))],
    },
    { key: 'tm', label: 'TM', options: [ALL, { value: 'vacant', label: 'Vacant only' }] },
  ],

  async fetch(db, scope, filters, req) {
    const view = effortScope(scope, filters, config.EFFORT_DIVISIONS);
    const q = view.ok ? effortTerritories(scope, filters, config.EFFORT_DIVISIONS) : null;
    if (!q) {
      return {
        rows: [],
        total: 0,
        unavailable: `The effort data names divisions rather than coding them, and no name is mapped to ${view.unmapped.join(', ')} yet (EFFORT_DIVISIONS).`,
      };
    }
    const params = { ...q.params };
    let where = q.where;

    const month = facetValue(this, filters, req, 'month');
    if (month !== 'all') {
      params.month = month;
      where += `\n    AND ${A}.yearMonth = @month`;
    }
    if (facetValue(this, filters, req, 'tm') === 'vacant') where += `\n    AND ${A}.emp_name IS NULL`;
    where += searchClause(
      [`${A}.hq_name`, `${A}.hq_code`, `${A}.emp_name`, `${A}.region_name`, `${A}.zone_name`],
      req.search,
      params,
    );

    const coverage = `CASE WHEN ${A}.tc > 0 THEN ${A}.met / ${A}.tc END`;
    const { rows, total } = await fetchPage<{
      ym: string; zone: string | null; region: string | null; hq: string | null; hq_code: string | null;
      tm: string | null; tc: N; met: N; fcov: N; calls: N; fd: N;
    }>(db, {
      select: `${A}.yearMonth AS ym, ${A}.zone_name AS zone, ${A}.region_name AS region, ${A}.hq_name AS hq,
           ${A}.hq_code, ${A}.emp_name AS tm, ${A}.tc, ${A}.met, ${A}.fcov, ${A}.calls, ${A}.fd`,
      from: q.from,
      where,
      // Weakest first: a territory with a list and no coverage leads.
      orderBy: `COALESCE(${coverage}, 2), ${A}.yearMonth, ${A}.hq_name`,
      params,
      page: req.page,
      pageSize: req.pageSize,
    });

    return {
      total,
      note: 'One row per territory and month, weakest coverage first. Covrg% = Drs Met ÷ Drs; Call Avg = calls ÷ field days.',
      rows: rows.map((r) => {
        const tc = num(r.tc);
        const met = num(r.met);
        const fd = num(r.fd);
        const calls = num(r.calls);
        return {
          month: Number(r.ym),
          zone: r.zone,
          region: r.region,
          hq: r.hq ?? r.hq_code,
          tm: r.tm ?? 'Vacant',
          drs: tc,
          met,
          coverage: M.pct(met, tc),
          rtFrqCoverage: tc ? num(r.fcov) : null,
          calls,
          callAvg: M.callAverage(calls, fd),
          fieldDays: fd,
        };
      }),
    };
  },
};
