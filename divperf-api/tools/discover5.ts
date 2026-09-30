/**
 * Discovery round 5 — dbo.RCPA_New, the richest of the missing-data tables.
 *
 * READ-ONLY.
 *
 * If this table carries a single-valued `hq` plus `employeeCode`/`jobTitle`, it
 * closes three of the four gaps at once:
 *   RCPA        value / rxn / compValue -> the RCPA panel and charts
 *   PCPM        DISTINCT employeeCode where jobTitle is a TM -> the denominator
 *   Effort tab  speciality, classification, doctorCode -> the Effort sheet
 *
 *   npx tsx tools/discover5.ts
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
const VIEW = env.WH_VIEW!;

const config: sql.config = {
  server: env.WH_SERVER!, database: env.WH_DATABASE!,
  user: env.WH_USER!, password: env.WH_PASSWORD!,
  port: 1433,
  options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
  pool: { min: 1, max: 2 }, requestTimeout: 240_000, connectionTimeout: 60_000,
};

const T = 'dbo.RCPA_New';

const steps: { title: string; sql: string; note?: string }[] = [
  {
    title: 'Sample rows',
    sql: `SELECT TOP 4 division, zone, region, hq, employeeCode, jobTitle, doctorCode,
                       speciality, classification, brand, activityDate, rxn, value, compValue
          FROM ${T};`,
  },
  {
    title: 'activityDate format and coverage',
    note: 'Needs to be reducible to a YR_MN month key to line up with the sales view.',
    sql: `
      SELECT MIN(activityDate) AS min_date, MAX(activityDate) AS max_date,
             COUNT(DISTINCT activityDate) AS distinct_dates, COUNT_BIG(*) AS rows_n
      FROM ${T};`,
  },
  {
    title: 'jobTitle values — which identify a TM, for the PCPM denominator?',
    sql: `
      SELECT jobTitle, COUNT_BIG(*) AS rows_n, COUNT(DISTINCT employeeCode) AS n_employees
      FROM ${T} GROUP BY jobTitle ORDER BY n_employees DESC;`,
  },
  {
    title: 'Headcount by month — the PCPM denominator, if jobTitle resolves',
    note: 'DISTINCT employeeCode per month is exactly "No. of budgeted TMs".',
    sql: `
      SELECT LEFT(CONVERT(VARCHAR(10), TRY_CONVERT(DATE, activityDate, 103), 112), 6) AS yr_mn,
             COUNT(DISTINCT employeeCode) AS n_employees,
             COUNT(DISTINCT hq) AS n_hq,
             COUNT(DISTINCT doctorCode) AS n_doctors,
             CAST(SUM(value) AS DECIMAL(38,2)) AS rcpa_value
      FROM ${T}
      WHERE TRY_CONVERT(DATE, activityDate, 103) IS NOT NULL
      GROUP BY LEFT(CONVERT(VARCHAR(10), TRY_CONVERT(DATE, activityDate, 103), 112), 6)
      ORDER BY yr_mn;`,
  },
  {
    title: 'hq — single-valued, and does it join to BZIRK?',
    note: 'SecondaryData.sapLocationCode is comma-separated; if RCPA_New.hq is not, it is the better join key.',
    sql: `
      SELECT
        (SELECT COUNT(DISTINCT hq) FROM ${T}) AS distinct_hq,
        (SELECT COUNT(*) FROM (SELECT DISTINCT hq FROM ${T} WHERE hq LIKE '%,%') x) AS hq_with_comma,
        (SELECT COUNT(*) FROM
          (SELECT DISTINCT LTRIM(RTRIM(hq)) c FROM ${T} WHERE hq IS NOT NULL) a
          JOIN (SELECT DISTINCT LTRIM(RTRIM(BZIRK)) c FROM ${VIEW} WHERE BZIRK IS NOT NULL) b
          ON a.c = b.c) AS hq_matching_bzirk,
        (SELECT COUNT(*) FROM
          (SELECT DISTINCT UPPER(LTRIM(RTRIM(hq))) c FROM ${T} WHERE hq IS NOT NULL) a
          JOIN (SELECT DISTINCT UPPER(LTRIM(RTRIM(TERRITORY_NAME))) c FROM ${VIEW} WHERE TERRITORY_NAME IS NOT NULL) b
          ON a.c = b.c) AS hq_matching_territory_name;`,
  },
  {
    title: 'Sample hq values',
    sql: `SELECT TOP 20 hq, COUNT_BIG(*) AS rows_n FROM ${T} GROUP BY hq ORDER BY rows_n DESC;`,
  },
  {
    title: 'division values — join key to the sales view',
    sql: `SELECT division, COUNT_BIG(*) AS rows_n, COUNT(DISTINCT employeeCode) AS n_emp,
                 CAST(SUM(value) AS DECIMAL(38,2)) AS rcpa_value
          FROM ${T} GROUP BY division ORDER BY rcpa_value DESC;`,
  },
  {
    title: 'classification — the A+/A/B/C buckets on the Effort sheet',
    sql: `SELECT classification, COUNT_BIG(*) AS rows_n, COUNT(DISTINCT doctorCode) AS n_doctors
          FROM ${T} GROUP BY classification ORDER BY n_doctors DESC;`,
  },
  {
    title: 'speciality — the Dr. Speciality filter on the Effort sheet',
    sql: `SELECT TOP 20 speciality, COUNT(DISTINCT doctorCode) AS n_doctors
          FROM ${T} GROUP BY speciality ORDER BY n_doctors DESC;`,
  },
  {
    title: 'brand overlap with the sales view',
    sql: `
      SELECT
        (SELECT COUNT(DISTINCT UPPER(LTRIM(RTRIM(brand)))) FROM ${T} WHERE brand IS NOT NULL) AS rcpa_brands,
        (SELECT COUNT(*) FROM
          (SELECT DISTINCT UPPER(LTRIM(RTRIM(brand))) b FROM ${T} WHERE brand IS NOT NULL) a
          JOIN (SELECT DISTINCT UPPER(LTRIM(RTRIM(BRAND))) b FROM ${VIEW} WHERE BRAND IS NOT NULL) s
          ON a.b = s.b) AS matching_brands;`,
  },
  {
    title: 'MERIND, Apr-Aug 2026 — what the RCPA panel would show',
    note: 'The figures that would replace the em dashes on the Division tab today.',
    sql: `
      SELECT LEFT(CONVERT(VARCHAR(10), TRY_CONVERT(DATE, activityDate, 103), 112), 6) AS yr_mn,
             COUNT(DISTINCT employeeCode) AS tms,
             COUNT(DISTINCT doctorCode) AS doctors,
             SUM(rxn) AS rxns,
             CAST(SUM(value) AS DECIMAL(38,2)) AS rcpa_value,
             CAST(SUM(compValue) AS DECIMAL(38,2)) AS comp_value
      FROM ${T}
      WHERE UPPER(division) = 'MERIND'
        AND LEFT(CONVERT(VARCHAR(10), TRY_CONVERT(DATE, activityDate, 103), 112), 6)
            BETWEEN '202604' AND '202608'
      GROUP BY LEFT(CONVERT(VARCHAR(10), TRY_CONVERT(DATE, activityDate, 103), 112), 6)
      ORDER BY yr_mn;`,
  },
];

const fmt = (v: unknown) =>
  v === null || v === undefined ? 'NULL' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

function table(rows: Record<string, unknown>[]): string {
  const first = rows?.[0];
  if (!first) return '(no rows)';
  const cols = Object.keys(first);
  const ws = cols.map((c) => Math.min(38, Math.max(c.length, ...rows.map((r) => fmt(r[c]).length))));
  const w = (i: number) => ws[i] ?? 10;
  const line = (cs: string[]) => '| ' + cs.map((s, i) => s.slice(0, w(i)).padEnd(w(i))).join(' | ') + ' |';
  return [line(cols), '|' + ws.map((x) => '-'.repeat(x + 2)).join('|') + '|',
    ...rows.map((r) => line(cols.map((c) => fmt(r[c]))))].join('\n');
}

const pool = await new sql.ConnectionPool(config).connect();
process.stdout.write(`# dbo.RCPA_New discovery — ${new Date().toISOString()}\n`);
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
