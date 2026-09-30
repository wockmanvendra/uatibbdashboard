/**
 * Read-only discovery against the Synapse warehouse.
 *
 * This file is deliberately OUTSIDE src/. Per invariant I9 the API never
 * connects to Synapse; only offline tooling (this script, and later the load
 * pipeline) authenticates to it. `grep -ri synapse src/` must stay empty.
 *
 * Usage:  npm run discover          (reads WH_* vars from .env.discovery)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sql from 'mssql';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, '..', '.env.discovery');

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw = '';
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(`Missing ${envPath}. Copy .env.discovery.example and fill it in.`);
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv();
const need = (k: string) => {
  const v = env[k];
  if (!v) throw new Error(`Missing ${k} in .env.discovery`);
  return v;
};

const config: sql.config = {
  server: need('WH_SERVER'),
  database: need('WH_DATABASE'),
  user: need('WH_USER'),
  password: need('WH_PASSWORD'),
  port: 1433,
  options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
  pool: { min: 1, max: 2, idleTimeoutMillis: 30_000 },
  requestTimeout: 180_000,
  connectionTimeout: 60_000,
};

const VIEW = env.WH_VIEW ?? 'eflash.VW_SALES_PRIMARY_ALL_HIST_AZURE';
const [VIEW_SCHEMA, VIEW_NAME] = VIEW.split('.');

type Step = { title: string; sql: string; note?: string };

const STEPS: Step[] = [
  {
    title: 'Server / pool identity  (§4.0 PENDING: dedicated or serverless?)',
    sql: `
      SELECT
        @@VERSION                                   AS version_string,
        SERVERPROPERTY('Edition')                   AS edition,
        SERVERPROPERTY('EngineEdition')             AS engine_edition,
        DB_NAME()                                   AS current_db,
        SUSER_SNAME()                               AS login_name;`,
    note:
      'EngineEdition 6 = Synapse dedicated SQL pool (Azure SQL DW). ' +
      'EngineEdition 11 = Synapse serverless SQL pool. 5 = Azure SQL Database.',
  },
  {
    title: 'Service objective / DWU level',
    sql: `SELECT TOP 5 * FROM sys.database_service_objectives;`,
  },
  {
    title: 'View definition  (§4.1 PENDING: single table or join?)',
    sql: `
      SELECT m.definition
      FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE s.name = '${VIEW_SCHEMA}' AND o.name = '${VIEW_NAME}';`,
  },
  {
    title: 'Column types  (§4.5 PENDING: exact DDL)',
    sql: `
      SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE,
             CHARACTER_MAXIMUM_LENGTH AS max_len,
             NUMERIC_PRECISION AS prec, NUMERIC_SCALE AS scale, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${VIEW_SCHEMA}' AND TABLE_NAME = '${VIEW_NAME}'
      ORDER BY ORDINAL_POSITION;`,
  },
  {
    title: 'Row count and month coverage  (§4.9 open month, I8 YR_MN)',
    sql: `
      SELECT COUNT_BIG(*) AS total_rows,
             MIN(YR_MN) AS min_yr_mn, MAX(YR_MN) AS max_yr_mn,
             COUNT(DISTINCT YR_MN) AS distinct_months,
             MIN(TDATE) AS min_tdate, MAX(TDATE) AS max_tdate
      FROM ${VIEW};`,
  },
  {
    title: 'Rows per month (last 30 months)',
    sql: `
      SELECT TOP 30 YR_MN, COUNT_BIG(*) AS rows_in_month,
             CAST(SUM(CAST(NET_SALES AS DECIMAL(38,4))) AS DECIMAL(38,2))   AS net_sales,
             CAST(SUM(CAST(GROSS_SALES AS DECIMAL(38,4))) AS DECIMAL(38,2)) AS gross_sales,
             CAST(SUM(CAST(CR_NOTES AS DECIMAL(38,4))) AS DECIMAL(38,2))    AS cr_notes,
             CAST(SUM(CAST(BUDGET AS DECIMAL(38,4))) AS DECIMAL(38,2))      AS budget,
             CAST(SUM(CAST(BUDGET1 AS DECIMAL(38,4))) AS DECIMAL(38,2))     AS budget1,
             CAST(SUM(CAST(COLLECTION AS DECIMAL(38,4))) AS DECIMAL(38,2))  AS collection
      FROM ${VIEW}
      GROUP BY YR_MN
      ORDER BY YR_MN DESC;`,
    note:
      '§12 Q3: BUDGET vs BUDGET1 — compare magnitudes against Coll/Disp. ' +
      '§12 Q4: Disp = NET_SALES or GROSS_SALES — check GROSS - CR_NOTES = NET.',
  },
  {
    title: 'Does GROSS_SALES - CR_NOTES = NET_SALES?  (§12 Q4)',
    sql: `
      SELECT TOP 12 YR_MN,
        CAST(SUM(CAST(GROSS_SALES AS DECIMAL(38,4))) AS DECIMAL(38,2)) AS gross,
        CAST(SUM(CAST(CR_NOTES AS DECIMAL(38,4))) AS DECIMAL(38,2))    AS cn,
        CAST(SUM(CAST(NET_SALES AS DECIMAL(38,4))) AS DECIMAL(38,2))   AS net,
        CAST(SUM(CAST(GROSS_SALES AS DECIMAL(38,4))
                 - CAST(CR_NOTES AS DECIMAL(38,4))
                 - CAST(NET_SALES AS DECIMAL(38,4))) AS DECIMAL(38,2)) AS gross_minus_cn_minus_net
      FROM ${VIEW}
      GROUP BY YR_MN ORDER BY YR_MN DESC;`,
  },
  {
    title: 'Hierarchy cardinalities  (§4.6 agg table sizing)',
    sql: `
      SELECT
        COUNT(DISTINCT SPART)    AS n_spart,
        COUNT(DISTINCT DIV_NAME) AS n_div_name,
        COUNT(DISTINCT VKBUR)    AS n_vkbur,
        COUNT(DISTINCT ZONE_NAME)AS n_zone_name,
        COUNT(DISTINCT VKGRP)    AS n_vkgrp,
        COUNT(DISTINCT REGION_NAME) AS n_region_name,
        COUNT(DISTINCT BZIRK)    AS n_bzirk,
        COUNT(DISTINCT TERRITORY_NAME) AS n_territory_name,
        COUNT(DISTINCT BRAND)    AS n_brand,
        COUNT(DISTINCT MATNR)    AS n_matnr,
        COUNT(DISTINCT CUSTOMER) AS n_customer,
        COUNT(DISTINCT WERKS)    AS n_werks
      FROM ${VIEW};`,
  },
  {
    title: 'Null / blank counts per dimension column  (§4.3 unassigned handling)',
    sql: `
      SELECT
        SUM(CASE WHEN YR_MN IS NULL THEN 1 ELSE 0 END)          AS null_yr_mn,
        SUM(CASE WHEN TDATE IS NULL THEN 1 ELSE 0 END)          AS null_tdate,
        SUM(CASE WHEN SPART IS NULL THEN 1 ELSE 0 END)          AS null_spart,
        SUM(CASE WHEN DIV_NAME IS NULL THEN 1 ELSE 0 END)       AS null_div_name,
        SUM(CASE WHEN VKBUR IS NULL THEN 1 ELSE 0 END)          AS null_vkbur,
        SUM(CASE WHEN ZONE_NAME IS NULL THEN 1 ELSE 0 END)      AS null_zone_name,
        SUM(CASE WHEN VKGRP IS NULL THEN 1 ELSE 0 END)          AS null_vkgrp,
        SUM(CASE WHEN REGION_NAME IS NULL THEN 1 ELSE 0 END)    AS null_region_name,
        SUM(CASE WHEN BZIRK IS NULL THEN 1 ELSE 0 END)          AS null_bzirk,
        SUM(CASE WHEN TERRITORY_NAME IS NULL THEN 1 ELSE 0 END) AS null_territory_name,
        SUM(CASE WHEN BRAND IS NULL THEN 1 ELSE 0 END)          AS null_brand,
        SUM(CASE WHEN MATNR IS NULL THEN 1 ELSE 0 END)          AS null_matnr,
        SUM(CASE WHEN CUSTOMER IS NULL THEN 1 ELSE 0 END)       AS null_customer,
        SUM(CASE WHEN WERKS IS NULL THEN 1 ELSE 0 END)          AS null_werks,
        COUNT_BIG(*) AS total_rows
      FROM ${VIEW};`,
  },
  {
    title: 'Divisions',
    sql: `
      SELECT SPART, DIV_NAME, COUNT_BIG(*) AS rows_n,
             CAST(SUM(CAST(NET_SALES AS DECIMAL(38,4))) AS DECIMAL(38,2)) AS net_sales
      FROM ${VIEW} GROUP BY SPART, DIV_NAME ORDER BY net_sales DESC;`,
  },
  {
    title: 'Geo tree: zone -> region -> hq  (§4.3 PENDING: zone/region consistency)',
    sql: `
      SELECT TOP 200 VKBUR, ZONE_NAME, VKGRP, REGION_NAME, BZIRK, TERRITORY_NAME,
             COUNT_BIG(*) AS rows_n
      FROM ${VIEW}
      GROUP BY VKBUR, ZONE_NAME, VKGRP, REGION_NAME, BZIRK, TERRITORY_NAME
      ORDER BY rows_n DESC;`,
  },
  {
    title: 'Regions appearing under more than one zone  (§4.3 validation)',
    sql: `
      SELECT VKGRP, REGION_NAME, COUNT(DISTINCT VKBUR) AS n_zones,
             MAX(ZONE_NAME) AS a_zone, MIN(ZONE_NAME) AS b_zone
      FROM ${VIEW}
      GROUP BY VKGRP, REGION_NAME
      HAVING COUNT(DISTINCT VKBUR) > 1
      ORDER BY n_zones DESC;`,
  },
  {
    title: 'HQs appearing under more than one region  (§4.3 validation)',
    sql: `
      SELECT TOP 50 BZIRK, TERRITORY_NAME, COUNT(DISTINCT VKGRP) AS n_regions
      FROM ${VIEW}
      GROUP BY BZIRK, TERRITORY_NAME
      HAVING COUNT(DISTINCT VKGRP) > 1
      ORDER BY n_regions DESC;`,
  },
  {
    title: 'Brands  (§12 Q16: mix-pie brand groups)',
    sql: `
      SELECT TOP 100 BRAND, COUNT(DISTINCT MATNR) AS n_materials, COUNT_BIG(*) AS rows_n,
             CAST(SUM(CAST(NET_SALES AS DECIMAL(38,4))) AS DECIMAL(38,2)) AS net_sales
      FROM ${VIEW} GROUP BY BRAND ORDER BY net_sales DESC;`,
  },
  {
    title: 'Measure column sanity — are ORDERS/STOCK/GIT/OS populated?',
    sql: `
      SELECT
        CAST(SUM(CAST(ORDERS AS DECIMAL(38,4))) AS DECIMAL(38,2))              AS orders,
        CAST(SUM(CAST(COLLECTION AS DECIMAL(38,4))) AS DECIMAL(38,2))          AS collection,
        CAST(SUM(CAST(COLLECTION_MATERIAL AS DECIMAL(38,4))) AS DECIMAL(38,2)) AS collection_material,
        CAST(SUM(CAST(OS AS DECIMAL(38,4))) AS DECIMAL(38,2))                  AS os,
        CAST(SUM(CAST(STOCK AS DECIMAL(38,4))) AS DECIMAL(38,2))               AS stock,
        CAST(SUM(CAST(GIT AS DECIMAL(38,4))) AS DECIMAL(38,2))                 AS git,
        CAST(SUM(CAST(BUDGET AS DECIMAL(38,4))) AS DECIMAL(38,2))              AS budget,
        CAST(SUM(CAST(BUDGET1 AS DECIMAL(38,4))) AS DECIMAL(38,2))             AS budget1
      FROM ${VIEW};`,
  },
  {
    title: 'agg_hq_brand_month size estimate  (§4.6: must stay under ~500k rows)',
    sql: `
      SELECT COUNT_BIG(*) AS agg_hq_brand_month_rows FROM (
        SELECT DISTINCT YR_MN, SPART, BZIRK, BRAND FROM ${VIEW}
      ) x;`,
  },
  {
    title: 'Sample rows',
    sql: `SELECT TOP 5 * FROM ${VIEW} ORDER BY YR_MN DESC;`,
  },
];

function fmt(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return '0x' + v.toString('hex');
  return String(v);
}

function table(rows: Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return '(no rows)';
  const cols = Object.keys(first);
  const widths = cols.map((c) =>
    Math.min(60, Math.max(c.length, ...rows.map((r) => fmt(r[c]).length))),
  );
  const w = (i: number) => widths[i] ?? 10;
  const line = (cells: string[]) =>
    '| ' + cells.map((s, i) => s.slice(0, w(i)).padEnd(w(i))).join(' | ') + ' |';
  return [
    line(cols),
    '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|',
    ...rows.map((r) => line(cols.map((c) => fmt(r[c])))),
  ].join('\n');
}

async function main() {
  process.stdout.write(`# Synapse discovery — ${VIEW}\n\nRun at ${new Date().toISOString()}\n`);
  const pool = await new sql.ConnectionPool(config).connect();
  try {
    for (const step of STEPS) {
      process.stdout.write(`\n\n## ${step.title}\n`);
      if (step.note) process.stdout.write(`\n> ${step.note}\n`);
      const t0 = Date.now();
      try {
        const res = await pool.request().query(step.sql);
        const ms = Date.now() - t0;
        process.stdout.write(`\n_${ms} ms_\n\n`);
        // sql_modules.definition is a single long string; print it raw.
        const rows = res.recordset as unknown as Record<string, unknown>[];
        const only = rows?.length === 1 ? rows[0] : undefined;
        if (only && only.definition !== undefined) {
          process.stdout.write('```sql\n' + String(only.definition).trim() + '\n```\n');
        } else {
          process.stdout.write('```\n' + table(rows ?? []) + '\n```\n');
        }
      } catch (err) {
        process.stdout.write(`\n**FAILED after ${Date.now() - t0} ms:** ${(err as Error).message}\n`);
      }
    }
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error('\nDISCOVERY FAILED:', e);
  process.exit(1);
});
