/**
 * Pulls Infinity's field structure into field_structure_infinity, one division
 * at a time — what the D2D portal's field-structure sync does, except that each
 * division is replaced in one transaction, so a failed or suspicious pull
 * leaves the previous rows in place.
 */
import type pg from 'pg';
import { config } from '../config.js';

/** [column, Infinity API field, column width]. */
const COLUMNS: [string, string, number][] = [
  ['tm_location_id', 'tmLocationId', 60],
  ['division', 'division', 150],
  ['manager1_code', 'manager1Code', 50],
  ['manager1_name', 'manager1Name', 150],
  ['manager1_location_id', 'manager1LocationId', 60],
  ['manager1_location', 'manager1Location', 150],
  ['manager1_location_type', 'manager1LocationType', 50],
  ['manager1_sap_code', 'manager1SapCode', 100],
  ['manager1_sap_name', 'manager1SapName', 150],
  ['manager2_code', 'manager2Code', 50],
  ['manager2_name', 'manager2Name', 150],
  ['manager2_location_id', 'manager2LocationId', 60],
  ['manager2_location', 'manager2Location', 150],
  ['manager2_location_type', 'manager2LocationType', 50],
  ['manager2_sap_code', 'manager2SapCode', 100],
  ['manager2_sap_name', 'manager2SapName', 150],
  ['emp_code', 'empCode', 50],
  ['emp_name', 'empName', 150],
  ['emp_location', 'empLocation', 150],
  ['emp_location_type', 'empLocationType', 50],
  ['sap_code', 'sapCode', 100],
  ['sap_name', 'sapName', 150],
  ['mirror_hq', 'mirrorHq', 10],
  ['emp_job_role', 'empJobRole', 100],
  ['job_role_id', 'jobRoleId', 60],
  ['emp_doj', 'empDOJ', 20],
  ['emp_dob', 'empDOB', 20],
  ['active_from', 'activeFrom', 20],
  ['active_to', 'activeTo', 20],
  ['email', 'email', 150],
  ['mobile', 'mobile', 50],
  ['corporate_mobile', 'corporateMobile', 50],
  ['emp_id', 'empId', 60],
  ['town', 'town', 100],
  ['state', 'state', 100],
  ['whatsapp_consent_detail', 'whatsappConsentDetail', 50],
];

const COLUMN_LIST = ['division_code', ...COLUMNS.map(([c]) => c)].join(', ');
const UPDATE_LIST = ['division_code', ...COLUMNS.slice(1).map(([c]) => c)]
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ');

export interface Division {
  divisionCode: string;
  infinityDivisionCode: string;
}

export interface DivisionResult {
  divisionCode: string;
  status: 'success' | 'error';
  rowCount?: number;
  skipped?: number;
  error?: string;
}

/** Below this many rows a shrinking division is not treated as suspicious. */
const SHRINK_GUARD_MIN = 20;

function text(v: unknown, width: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, width);
}

export async function fetchFieldStructure(infinityDivisionCode: string): Promise<unknown[]> {
  const base = config.INFINITY_REPORT_BASE_URL.replace(/\/+$/, '');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.INFINITY_API_HEADER_NAME && config.INFINITY_API_TOKEN) {
    headers[config.INFINITY_API_HEADER_NAME] = config.INFINITY_API_TOKEN;
  }
  const res = await fetch(`${base}/filed-structure/${encodeURIComponent(infinityDivisionCode)}`, {
    headers,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Infinity field-structure API answered ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('Infinity field-structure API returned something other than a list');
  return body;
}

/** Rows keyed on tmLocationId; rows without one, and repeats, are skipped. */
function toRows(records: unknown[], divisionCode: string): { rows: Record<string, string | null>[]; skipped: number } {
  const byId = new Map<string, Record<string, string | null>>();
  let skipped = 0;
  for (const rec of records) {
    const r = (rec ?? {}) as Record<string, unknown>;
    const row: Record<string, string | null> = { division_code: divisionCode };
    for (const [column, field, width] of COLUMNS) row[column] = text(r[field], width);
    const id = row.tm_location_id;
    if (!id || byId.has(id)) {
      skipped++;
      continue;
    }
    byId.set(id, row);
  }
  return { rows: [...byId.values()], skipped };
}

export async function syncDivision(
  client: pg.PoolClient,
  division: Division,
  opts: { force?: boolean; fetchRecords?: typeof fetchFieldStructure } = {},
): Promise<DivisionResult> {
  const { divisionCode } = division;
  let result: DivisionResult;
  try {
    const records = await (opts.fetchRecords ?? fetchFieldStructure)(division.infinityDivisionCode);
    const { rows, skipped } = toRows(records, divisionCode);
    if (rows.length === 0) throw new Error('Infinity returned no rows; the existing ones are kept');

    await client.query('BEGIN');
    try {
      const { rows: held } = await client.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM field_structure_infinity WHERE division_code = $1',
        [divisionCode],
      );
      const n = held[0]!.n;
      // A partial response must not silently sign half a division out.
      if (!opts.force && n >= SHRINK_GUARD_MIN && rows.length < n * 0.5) {
        throw new Error(
          `Infinity returned ${rows.length} rows where ${n} are held; refusing to drop more than half. ` +
            'Re-run with --force if this is right.',
        );
      }
      await client.query('DELETE FROM field_structure_infinity WHERE division_code = $1', [divisionCode]);
      await client.query(
        `INSERT INTO field_structure_infinity (${COLUMN_LIST})
         SELECT ${COLUMN_LIST} FROM json_populate_recordset(NULL::field_structure_infinity, $1)
         ON CONFLICT (tm_location_id) DO UPDATE SET ${UPDATE_LIST}, synced_at = NOW()`,
        [JSON.stringify(rows)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    result = { divisionCode, status: 'success', rowCount: rows.length, skipped };
  } catch (err) {
    result = { divisionCode, status: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  await client.query(
    `INSERT INTO infinity_sync_log (division_code, status, row_count, skipped_count, error_message)
     VALUES ($1, $2, $3, $4, $5)`,
    [divisionCode, result.status, result.rowCount ?? null, result.skipped ?? null, result.error ?? null],
  );
  return result;
}
