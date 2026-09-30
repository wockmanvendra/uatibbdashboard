/**
 * Discovery round 3 — the RCPA and secondary-sales sources.
 *
 * READ-ONLY. Nothing here creates or alters an object; the CREATE VIEW the DBA
 * supplied is used only as a map of which tables and columns exist.
 *
 * What we are trying to establish, in order of importance to the dashboard:
 *   1. Do the base tables carry a TERRITORY/HQ column? The supplied view rolls
 *      up to division + brand group, which would only fill the Division tab.
 *      The geo tabs need a geography column on the base table.
 *   2. Does DIVISION_CODE join to SPART in the sales view?
 *   3. Is BRAND_GROUP the stored attribute that §12 Q16 asks for?
 *   4. Does RCPA_2526 cover FY25-26 — the 12 months missing from sales?
 *   5. What grain and columns does the secondary-sales table have?
 *
 *   npx tsx tools/discover3.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sql from 'mssql';

const here = path.dirname(fileURLToPath(import.meta.url));
const env: Record<string, string> = {};
for (const line of readFileSync(path.join(here, '..', '.env.discovery'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const config: sql.config = {
  server: env.WH_SERVER!,
  database: env.WH_DATABASE!,
  user: env.WH_USER!,
  password: env.WH_PASSWORD!,
  port: 1433,
  options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
  pool: { min: 1, max: 2 },
  requestTimeout: 240_000,
  connectionTimeout: 60_000,
};

const steps: { title: string; sql: string; note?: string }[] = [
  {
    title: 'Locate the tables — anything RCPA, secondary, or in the Infinity schema',
    sql: `
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'Infinity'
         OR TABLE_NAME LIKE '%RCPA%'
         OR TABLE_NAME LIKE '%econdary%'
         OR TABLE_NAME LIKE '%SEC[_]%'
      ORDER BY TABLE_SCHEMA, TABLE_NAME;`,
  },
  {
    title: 'Columns of Infinity.RCPA_Rupal  (current fiscal year)',
    note: 'Looking specifically for a territory / HQ / zone column and a doctor speciality.',
    sql: `
      SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE,
             CHARACTER_MAXIMUM_LENGTH AS max_len, NUMERIC_PRECISION AS prec,
             NUMERIC_SCALE AS scale, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'Infinity' AND TABLE_NAME = 'RCPA_Rupal'
      ORDER BY ORDINAL_POSITION;`,
  },
  {
    title: 'Columns of Infinity.RCPA_2526  (prior fiscal year)',
    sql: `
      SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE,
             CHARACTER_MAXIMUM_LENGTH AS max_len, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'Infinity' AND TABLE_NAME = 'RCPA_2526'
      ORDER BY ORDINAL_POSITION;`,
  },
  {
    title: 'Columns of the secondary-sales table',
    sql: `
      SELECT TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE,
             CHARACTER_MAXIMUM_LENGTH AS max_len, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME LIKE '%econdarydata%' OR TABLE_NAME LIKE '%econdary%'
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;`,
  },
  {
    title: 'RCPA_Rupal — row count and month coverage',
    sql: `
      SELECT COUNT_BIG(*) AS rows_n,
             COUNT(DISTINCT MONTH) AS distinct_months,
             MIN(MONTH) AS min_month, MAX(MONTH) AS max_month,
             COUNT(DISTINCT DIVISION_CODE) AS n_divisions,
             COUNT(DISTINCT BRAND_GROUP) AS n_brand_groups,
             COUNT(DISTINCT DOCTOR_CODE) AS n_doctors
      FROM Infinity.RCPA_Rupal;`,
  },
  {
    title: 'RCPA_2526 — row count and month coverage',
    note: 'If this covers 202504-202603 it fills the 12-month hole in the sales view.',
    sql: `
      SELECT COUNT_BIG(*) AS rows_n,
             COUNT(DISTINCT MONTH) AS distinct_months,
             MIN(MONTH) AS min_month, MAX(MONTH) AS max_month,
             COUNT(DISTINCT DIVISION_CODE) AS n_divisions,
             COUNT(DISTINCT DOCTOR_CODE) AS n_doctors
      FROM Infinity.RCPA_2526;`,
  },
  {
    title: 'RCPA_Rupal — sample rows',
    sql: `SELECT TOP 3 * FROM Infinity.RCPA_Rupal;`,
  },
  {
    title: 'RCPA_Rupal — distinct months, in order',
    sql: `
      SELECT CONVERT(VARCHAR(10), CONVERT(DATE, MONTH, 103), 23) AS month_iso,
             COUNT_BIG(*) AS rows_n,
             CAST(SUM(CAST(WOCK_BRAND_VALUE_IN_ABSOLUTE AS FLOAT)) AS DECIMAL(38,2)) AS rcpa_value
      FROM Infinity.RCPA_Rupal
      GROUP BY CONVERT(VARCHAR(10), CONVERT(DATE, MONTH, 103), 23)
      ORDER BY month_iso;`,
  },
  {
    title: 'DIVISION_CODE values — do they join to SPART in the sales view?',
    note: 'SPART is nvarchar(2) with values like 78, 83, 85. A mismatch here breaks every join.',
    sql: `
      SELECT DIVISION_CODE, COUNT_BIG(*) AS rows_n,
             CAST(SUM(CAST(WOCK_BRAND_VALUE_IN_ABSOLUTE AS FLOAT)) AS DECIMAL(38,2)) AS rcpa_value
      FROM Infinity.RCPA_Rupal
      GROUP BY DIVISION_CODE ORDER BY rcpa_value DESC;`,
  },
  {
    title: 'BRAND_GROUP values — the stored grouping §12 Q16 asks about',
    sql: `
      SELECT TOP 40 UPPER(BRAND_GROUP) AS brand_group, COUNT_BIG(*) AS rows_n,
             CAST(SUM(CAST(WOCK_BRAND_VALUE_IN_ABSOLUTE AS FLOAT)) AS DECIMAL(38,2)) AS rcpa_value
      FROM Infinity.RCPA_Rupal
      GROUP BY UPPER(BRAND_GROUP) ORDER BY rcpa_value DESC;`,
  },
  {
    title: 'QTR_DR_STATUS_MAPPING values',
    sql: `
      SELECT ISNULL(QTR_DR_STATUS_MAPPING,'(null)') AS status, COUNT_BIG(*) AS rows_n
      FROM Infinity.RCPA_Rupal GROUP BY QTR_DR_STATUS_MAPPING ORDER BY rows_n DESC;`,
  },
];

const fmt = (v: unknown) =>
  v === null || v === undefined ? 'NULL' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

function table(rows: Record<string, unknown>[]): string {
  const first = rows?.[0];
  if (!first) return '(no rows)';
  const cols = Object.keys(first);
  const ws = cols.map((c) => Math.min(42, Math.max(c.length, ...rows.map((r) => fmt(r[c]).length))));
  const w = (i: number) => ws[i] ?? 10;
  const line = (cs: string[]) => '| ' + cs.map((s, i) => s.slice(0, w(i)).padEnd(w(i))).join(' | ') + ' |';
  return [line(cols), '|' + ws.map((x) => '-'.repeat(x + 2)).join('|') + '|',
    ...rows.map((r) => line(cols.map((c) => fmt(r[c]))))].join('\n');
}

const pool = await new sql.ConnectionPool(config).connect();
process.stdout.write(`# RCPA / secondary discovery — ${new Date().toISOString()}\n`);

for (const s of steps) {
  process.stdout.write(`\n\n## ${s.title}\n`);
  if (s.note) process.stdout.write(`\n> ${s.note}\n`);
  const t0 = Date.now();
  try {
    const r = await pool.request().query(s.sql);
    process.stdout.write(`\n_${Date.now() - t0} ms_\n\n\`\`\`\n${table(r.recordset as never)}\n\`\`\`\n`);
  } catch (e) {
    process.stdout.write(`\n**FAILED (${Date.now() - t0} ms):** ${(e as Error).message}\n`);
  }
}
await pool.close();
