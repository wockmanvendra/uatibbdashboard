/**
 * Discovery round 4 — can SecondaryData / RCPA actually be joined to the sales
 * view, and at what grain?
 *
 * READ-ONLY. The decisive questions:
 *   1. Are division/zone/region CODES (joinable to SPART/VKBUR/VKGRP) or NAMES?
 *   2. Does sapLocationCode join to BZIRK (the HQ code)?
 *   3. What is the yearMonth format, and does coverage include FY25-26?
 *   4. SecondaryData vs SecondaryData_test — which is current?
 *   5. Does primaryValue reconcile against NET_SALES in the sales view? If it
 *      does, the two sources agree and the join is trustworthy.
 *
 *   npx tsx tools/discover4.ts
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

const SD = 'dbo.SecondaryData_test';

const steps: { title: string; sql: string; note?: string }[] = [
  {
    title: 'SecondaryData vs SecondaryData_test — size and coverage',
    sql: `
      SELECT 'SecondaryData' AS tbl, COUNT_BIG(*) AS rows_n,
             MIN(yearMonth) AS min_ym, MAX(yearMonth) AS max_ym,
             COUNT(DISTINCT yearMonth) AS n_months
      FROM dbo.SecondaryData
      UNION ALL
      SELECT 'SecondaryData_test', COUNT_BIG(*), MIN(yearMonth), MAX(yearMonth),
             COUNT(DISTINCT yearMonth)
      FROM dbo.SecondaryData_test;`,
  },
  {
    title: 'Sample rows — what do the geography values actually look like?',
    note: 'Codes join; names do not. This is the single most important answer here.',
    sql: `SELECT TOP 5 division, zone, region, location, sapLocationName, sapLocationCode,
                     yearMonth, stockistCode, brandName, productCode
          FROM ${SD};`,
  },
  {
    title: 'Month coverage and the measures, by month',
    note: 'Does this cover 202504-202603, the 12 months missing from the sales view?',
    sql: `
      SELECT yearMonth,
             COUNT_BIG(*) AS rows_n,
             CAST(SUM(secondaryValue)    AS DECIMAL(38,2)) AS secondary_value,
             CAST(SUM(adjSecondaryValue) AS DECIMAL(38,2)) AS adj_secondary_value,
             CAST(SUM(primaryValue)      AS DECIMAL(38,2)) AS primary_value,
             CAST(SUM(rcpaValue)         AS DECIMAL(38,2)) AS rcpa_value,
             CAST(SUM(closingValue)      AS DECIMAL(38,2)) AS closing_value
      FROM ${SD}
      GROUP BY yearMonth ORDER BY yearMonth;`,
  },
  {
    title: 'Distinct division values',
    note: 'Compare with SPART (78, 83, 85, ...) and DIV_NAME (MERIND, PHARMA, ...).',
    sql: `
      SELECT division, COUNT_BIG(*) AS rows_n,
             CAST(SUM(secondaryValue) AS DECIMAL(38,2)) AS secondary_value
      FROM ${SD} GROUP BY division ORDER BY secondary_value DESC;`,
  },
  {
    title: 'Distinct zone values (top 25)',
    sql: `SELECT TOP 25 zone, COUNT_BIG(*) AS rows_n FROM ${SD} GROUP BY zone ORDER BY rows_n DESC;`,
  },
  {
    title: 'sapLocationCode vs BZIRK — do the HQ codes overlap?',
    note: 'A non-zero match count means the geo tabs can carry secondary and RCPA.',
    sql: `
      WITH sd AS (SELECT DISTINCT LTRIM(RTRIM(sapLocationCode)) AS c FROM ${SD} WHERE sapLocationCode IS NOT NULL),
           sv AS (SELECT DISTINCT LTRIM(RTRIM(BZIRK)) AS c FROM ${VIEW} WHERE BZIRK IS NOT NULL)
      SELECT (SELECT COUNT(*) FROM sd) AS sd_codes,
             (SELECT COUNT(*) FROM sv) AS sales_codes,
             (SELECT COUNT(*) FROM sd JOIN sv ON sd.c = sv.c) AS matching_codes;`,
  },
  {
    title: 'Sample of matching HQ codes',
    sql: `
      WITH sd AS (SELECT DISTINCT LTRIM(RTRIM(sapLocationCode)) AS c FROM ${SD} WHERE sapLocationCode IS NOT NULL),
           sv AS (SELECT DISTINCT LTRIM(RTRIM(BZIRK)) AS c, MAX(TERRITORY_NAME) AS nm FROM ${VIEW} WHERE BZIRK IS NOT NULL GROUP BY LTRIM(RTRIM(BZIRK)))
      SELECT TOP 15 sd.c AS code, sv.nm AS sales_territory_name FROM sd JOIN sv ON sd.c = sv.c;`,
  },
  {
    title: 'brandName vs BRAND — do the brand names overlap?',
    sql: `
      WITH sd AS (SELECT DISTINCT UPPER(LTRIM(RTRIM(brandName))) AS b FROM ${SD} WHERE brandName IS NOT NULL),
           sv AS (SELECT DISTINCT UPPER(LTRIM(RTRIM(BRAND))) AS b FROM ${VIEW} WHERE BRAND IS NOT NULL)
      SELECT (SELECT COUNT(*) FROM sd) AS sd_brands,
             (SELECT COUNT(*) FROM sv) AS sales_brands,
             (SELECT COUNT(*) FROM sd JOIN sv ON sd.b = sv.b) AS matching_brands;`,
  },
  {
    title: 'RCPA tables in dbo — which is current?',
    sql: `
      SELECT 'RCPA' AS tbl, COUNT_BIG(*) AS rows_n FROM dbo.RCPA
      UNION ALL SELECT 'RCPA_New', COUNT_BIG(*) FROM dbo.RCPA_New
      UNION ALL SELECT 'RCPA_test', COUNT_BIG(*) FROM dbo.RCPA_test
      UNION ALL SELECT 'RCPA_test_April', COUNT_BIG(*) FROM dbo.RCPA_test_April
      UNION ALL SELECT 'Hospital_RCPA', COUNT_BIG(*) FROM dbo.Hospital_RCPA;`,
  },
  {
    title: 'Columns of dbo.RCPA_New',
    note: 'Looking for DOCTOR_CODE, territory, speciality — the Effort-sheet fields.',
    sql: `
      SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS max_len
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='RCPA_New' ORDER BY ORDINAL_POSITION;`,
  },
  {
    title: 'Columns of dbo.RCPA',
    sql: `
      SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS max_len
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='RCPA' ORDER BY ORDINAL_POSITION;`,
  },
];

const fmt = (v: unknown) =>
  v === null || v === undefined ? 'NULL' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

function table(rows: Record<string, unknown>[]): string {
  const first = rows?.[0];
  if (!first) return '(no rows)';
  const cols = Object.keys(first);
  const ws = cols.map((c) => Math.min(40, Math.max(c.length, ...rows.map((r) => fmt(r[c]).length))));
  const w = (i: number) => ws[i] ?? 10;
  const line = (cs: string[]) => '| ' + cs.map((s, i) => s.slice(0, w(i)).padEnd(w(i))).join(' | ') + ' |';
  return [line(cols), '|' + ws.map((x) => '-'.repeat(x + 2)).join('|') + '|',
    ...rows.map((r) => line(cols.map((c) => fmt(r[c]))))].join('\n');
}

const pool = await new sql.ConnectionPool(config).connect();
process.stdout.write(`# Secondary / RCPA join feasibility — ${new Date().toISOString()}\n`);
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
