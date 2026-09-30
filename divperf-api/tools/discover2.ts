/**
 * Discovery round 2 — hypothesis tests.
 * Read-only. Outside src/ per invariant I9.  Usage: npx tsx tools/discover2.ts
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
  server: env.WH_SERVER!,
  database: env.WH_DATABASE!,
  user: env.WH_USER!,
  password: env.WH_PASSWORD!,
  port: 1433,
  options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
  pool: { min: 1, max: 2 },
  requestTimeout: 180_000,
  connectionTimeout: 60_000,
};

const STEPS: { title: string; sql: string; note?: string }[] = [
  {
    title: 'H1 — Is BUDGET the budgeted TM headcount?  (§4.4 PCPM denominator)',
    note: 'If BUDGET is a headcount it will be small integers per HQ/month, and BUDGET1 the money target.',
    sql: `
      SELECT TOP 20 YR_MN, BZIRK, TERRITORY_NAME,
        CAST(SUM(CAST(BUDGET AS DECIMAL(38,6)))  AS DECIMAL(18,4)) AS budget_sum,
        CAST(SUM(CAST(BUDGET1 AS DECIMAL(38,6))) AS DECIMAL(18,2)) AS budget1_sum,
        COUNT_BIG(*) AS rows_n
      FROM ${VIEW}
      WHERE YR_MN = '202607' AND SPART = '78' AND BUDGET <> 0
      GROUP BY YR_MN, BZIRK, TERRITORY_NAME
      ORDER BY budget_sum DESC;`,
  },
  {
    title: 'H1b — Distinct BUDGET values (is it integral?)',
    sql: `
      SELECT TOP 25 CAST(BUDGET AS DECIMAL(18,6)) AS budget_value, COUNT_BIG(*) AS rows_n
      FROM ${VIEW} WHERE BUDGET <> 0
      GROUP BY CAST(BUDGET AS DECIMAL(18,6)) ORDER BY rows_n DESC;`,
  },
  {
    title: 'H2 — Grain mixing: which columns are populated together?  (§4.3 nulls)',
    note: 'Hypothesis: the view UNIONs a material-grain sales feed with a customer-grain collection/OS feed.',
    sql: `
      SELECT
        CASE WHEN MATNR IS NULL THEN 'matnr NULL' ELSE 'matnr set' END AS matnr_state,
        CASE WHEN CUSTOMER IS NULL THEN 'cust NULL' ELSE 'cust set' END AS cust_state,
        CASE WHEN TDATE IS NULL THEN 'tdate NULL' ELSE 'tdate set' END AS tdate_state,
        COUNT_BIG(*) AS rows_n,
        CAST(SUM(CAST(GROSS_SALES AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS gross,
        CAST(SUM(CAST(NET_SALES  AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS net,
        CAST(SUM(CAST(CR_NOTES   AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS cn,
        CAST(SUM(CAST(COLLECTION AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS coll,
        CAST(SUM(CAST(OS         AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS os,
        CAST(SUM(CAST(STOCK      AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS stock,
        CAST(SUM(CAST(BUDGET     AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS budget,
        CAST(SUM(CAST(BUDGET1    AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS budget1
      FROM ${VIEW}
      GROUP BY
        CASE WHEN MATNR IS NULL THEN 'matnr NULL' ELSE 'matnr set' END,
        CASE WHEN CUSTOMER IS NULL THEN 'cust NULL' ELSE 'cust set' END,
        CASE WHEN TDATE IS NULL THEN 'tdate NULL' ELSE 'tdate set' END
      ORDER BY rows_n DESC;`,
  },
  {
    title: 'H3 — Sign convention on COLLECTION / OS / CR_NOTES',
    sql: `
      SELECT
        SUM(CASE WHEN COLLECTION < 0 THEN 1 ELSE 0 END) AS coll_neg,
        SUM(CASE WHEN COLLECTION > 0 THEN 1 ELSE 0 END) AS coll_pos,
        SUM(CASE WHEN OS < 0 THEN 1 ELSE 0 END)         AS os_neg,
        SUM(CASE WHEN OS > 0 THEN 1 ELSE 0 END)         AS os_pos,
        SUM(CASE WHEN CR_NOTES < 0 THEN 1 ELSE 0 END)   AS cn_neg,
        SUM(CASE WHEN CR_NOTES > 0 THEN 1 ELSE 0 END)   AS cn_pos,
        SUM(CASE WHEN GROSS_SALES < 0 THEN 1 ELSE 0 END) AS gross_neg
      FROM ${VIEW};`,
  },
  {
    title: 'H4 — Month gap check: every YR_MN present',
    sql: `SELECT YR_MN, COUNT_BIG(*) AS rows_n FROM ${VIEW} GROUP BY YR_MN ORDER BY YR_MN;`,
  },
  {
    title: 'H5 — Is BUDGET1 aligned to GROSS or NET at division/month?  (§12 Q3/Q4)',
    sql: `
      SELECT TOP 12 YR_MN,
        CAST(SUM(CAST(BUDGET1 AS DECIMAL(38,6))) AS DECIMAL(38,2))     AS budget1,
        CAST(SUM(CAST(GROSS_SALES AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS gross,
        CAST(SUM(CAST(NET_SALES AS DECIMAL(38,6))) AS DECIMAL(38,2))   AS net,
        CAST(-SUM(CAST(COLLECTION AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS coll_pos,
        CAST(100.0 * SUM(CAST(GROSS_SALES AS DECIMAL(38,6)))
             / NULLIF(SUM(CAST(BUDGET1 AS DECIMAL(38,6))),0) AS DECIMAL(10,1)) AS ach_gross_pct,
        CAST(100.0 * -SUM(CAST(COLLECTION AS DECIMAL(38,6)))
             / NULLIF(SUM(CAST(BUDGET1 AS DECIMAL(38,6))),0) AS DECIMAL(10,1)) AS ach_coll_pct
      FROM ${VIEW} WHERE SPART = '78'
      GROUP BY YR_MN ORDER BY YR_MN DESC;`,
  },
  {
    title: 'H6 — Is brand-level COLLECTION available?  (Key Brands table has a Coll column)',
    sql: `
      SELECT
        CASE WHEN BRAND IS NULL THEN 'brand NULL' ELSE 'brand set' END AS brand_state,
        CAST(SUM(CAST(COLLECTION AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS coll,
        CAST(SUM(CAST(OS AS DECIMAL(38,6))) AS DECIMAL(38,2))         AS os,
        CAST(SUM(CAST(BUDGET1 AS DECIMAL(38,6))) AS DECIMAL(38,2))    AS budget1,
        CAST(SUM(CAST(STOCK AS DECIMAL(38,6))) AS DECIMAL(38,2))      AS stock,
        CAST(SUM(CAST(GIT AS DECIMAL(38,6))) AS DECIMAL(38,2))        AS git
      FROM ${VIEW} GROUP BY CASE WHEN BRAND IS NULL THEN 'brand NULL' ELSE 'brand set' END;`,
  },
  {
    title: 'H7 — Latency floor probe: trivial single-row aggregate (§4.0)',
    sql: `
      SELECT CAST(SUM(CAST(NET_SALES AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS net
      FROM ${VIEW} WHERE YR_MN = '202607' AND SPART = '78';`,
  },
  {
    title: 'H7b — Same query again (result-set cache / warm probe)',
    sql: `
      SELECT CAST(SUM(CAST(NET_SALES AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS net
      FROM ${VIEW} WHERE YR_MN = '202607' AND SPART = '78';`,
  },
  {
    title: 'H8 — Realistic tab-panel query cost (division month range rollup)',
    sql: `
      SELECT SPART,
        CAST(SUM(CAST(BUDGET1 AS DECIMAL(38,6))) AS DECIMAL(38,2))     AS tgt,
        CAST(SUM(CAST(GROSS_SALES AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS disp,
        CAST(-SUM(CAST(COLLECTION AS DECIMAL(38,6))) AS DECIMAL(38,2)) AS coll,
        CAST(SUM(CAST(CR_NOTES AS DECIMAL(38,6))) AS DECIMAL(38,2))    AS cn,
        CAST(SUM(CAST(OS AS DECIMAL(38,6))) AS DECIMAL(38,2))          AS os
      FROM ${VIEW}
      WHERE YR_MN BETWEEN '202604' AND '202608'
      GROUP BY SPART ORDER BY disp DESC;`,
  },
];

const fmt = (v: unknown) =>
  v === null || v === undefined ? 'NULL' : v instanceof Date ? v.toISOString() : String(v);

function table(rows: Record<string, unknown>[]): string {
  const first = rows?.[0];
  if (!first) return '(no rows)';
  const cols = Object.keys(first);
  const ws = cols.map((c) => Math.min(50, Math.max(c.length, ...rows.map((r) => fmt(r[c]).length))));
  const w = (i: number) => ws[i] ?? 10;
  const line = (cs: string[]) =>
    '| ' + cs.map((s, i) => s.slice(0, w(i)).padEnd(w(i))).join(' | ') + ' |';
  return [line(cols), '|' + ws.map((x) => '-'.repeat(x + 2)).join('|') + '|',
    ...rows.map((r) => line(cols.map((c) => fmt(r[c]))))].join('\n');
}

const pool = await new sql.ConnectionPool(config).connect();
for (const s of STEPS) {
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
