/**
 * Reconciliation harness. (ARCHITECTURE.md §10 Phase 2 — "Confirm the numbers
 * tie to the Excel report for one month before building anything else")
 *
 * Runs the REAL panel aggregations read-only against the warehouse view, using
 * the metric definitions agreed in §5, and prints:
 *
 *   1. the figures each dashboard panel would show,
 *   2. internal consistency checks that must hold if the SQL is right.
 *
 * The SQL here is the specification for the `agg_*` CTAS builds and for
 * data/panels/*. Getting it right now is why this runs before the serving tier
 * exists — a definition mistake found here is free, and found after the
 * pipeline is built is not.
 *
 * Read-only, and outside src/ per invariant I9.
 *
 *   npx tsx tools/reconcile.ts [division] [fromYrMn] [toYrMn]
 *   npx tsx tools/reconcile.ts 78 202604 202608
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
const DIVISION = process.argv[2] ?? '78';
const FROM = process.argv[3] ?? '202604';
const TO = process.argv[4] ?? '202608';

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

/**
 * Measure expressions, stated once.
 *
 *  - Disp  = NET_SALES            (user, §5)
 *  - Tgt   = BUDGET1              (§4.3 — BUDGET is 209 dimensionless rows)
 *  - Coll  = -COLLECTION          (§4.3 — stored as a credit)
 *  - Gross = NET_SALES + CR_NOTES (identity confirmed against the source)
 */
const M = {
  tgt: 'SUM(CAST(BUDGET1 AS DECIMAL(38,6)))',
  disp: 'SUM(CAST(NET_SALES AS DECIMAL(38,6)))',
  coll: '-SUM(CAST(COLLECTION AS DECIMAL(38,6)))',
  cn: 'SUM(CAST(CR_NOTES AS DECIMAL(38,6)))',
  gross: 'SUM(CAST(NET_SALES AS DECIMAL(38,6)) + CAST(CR_NOTES AS DECIMAL(38,6)))',
  os: 'SUM(CAST(OS AS DECIMAL(38,6)))',
  stock: 'SUM(CAST(STOCK AS DECIMAL(38,6)))',
  git: 'SUM(CAST(GIT AS DECIMAL(38,6)))',
};

const D = (e: string, s = 2) => `CAST(${e} AS DECIMAL(38,${s}))`;

/** Prior-year window for Gr%. */
const priorYr = (yrMn: string) => String(Number(yrMn) - 100);

const scope = `WHERE YR_MN BETWEEN @from AND @to AND SPART = @div`;

const QUERIES: { title: string; sql: string; note?: string }[] = [
  {
    title: 'PRIMARY panel — Tgt / Disp / Coll with Ach% (current window)',
    sql: `
      SELECT
        ${D(M.tgt)}   AS tgt,
        ${D(M.disp)}  AS disp,
        ${D(M.coll)}  AS coll,
        ${D(M.gross)} AS gross,
        ${D(M.cn)}    AS cn,
        ${D(`100.0 * ${M.disp} / NULLIF(${M.tgt},0)`, 1)} AS disp_ach_pct,
        ${D(`100.0 * ${M.coll} / NULLIF(${M.tgt},0)`, 1)} AS coll_ach_pct,
        ${D(`100.0 * ${M.cn}   / NULLIF(${M.gross},0)`, 2)} AS cn_pct
      FROM ${VIEW} ${scope};`,
  },
  {
    title: 'PRIMARY panel — prior-year window (drives Gr%)',
    note: 'Expected to be empty for FY26-27: months 202504–202603 are absent from the source.',
    sql: `
      SELECT
        COUNT_BIG(*) AS rows_in_prior_window,
        ${D(M.tgt)}  AS tgt,
        ${D(M.disp)} AS disp,
        ${D(M.coll)} AS coll
      FROM ${VIEW}
      WHERE YR_MN BETWEEN @pfrom AND @pto AND SPART = @div;`,
  },
  {
    title: 'CN and O/S panel',
    sql: `
      SELECT
        ${D(M.cn)}    AS total_cn,
        ${D(M.os)}    AS total_os,
        ${D(M.gross)} AS gross,
        ${D(`100.0 * ${M.cn} / NULLIF(${M.gross},0)`, 2)} AS cn_pct
      FROM ${VIEW} ${scope};`,
  },
  {
    title: 'INVENTORY panel — stock + GIT',
    sql: `
      SELECT ${D(M.stock)} AS stock, ${D(M.git)} AS git,
             ${D(`${M.stock} + ${M.git}`)} AS inventory
      FROM ${VIEW} ${scope};`,
  },
  {
    title: 'TREND — monthly series (Tgt / Disp / Coll / CN)',
    sql: `
      SELECT YR_MN,
        ${D(M.tgt)}  AS tgt,
        ${D(M.disp)} AS disp,
        ${D(M.coll)} AS coll,
        ${D(M.cn)}   AS cn
      FROM ${VIEW} ${scope}
      GROUP BY YR_MN ORDER BY YR_MN;`,
  },
  {
    title: 'KEY BRANDS panel — top 15 by dispatch',
    note:
      'Coll, Sec and RCPA are absent by construction: collection is customer-grain ' +
      'and carries no brand (§4.3). Only Tgt, Disp and Inventory are real here.',
    sql: `
      SELECT TOP 15
        ISNULL(BRAND, '(Unassigned)') AS brand,
        ${D(M.tgt)}  AS tgt,
        ${D(M.disp)} AS disp,
        ${D(`${M.stock} + ${M.git}`)} AS inventory,
        ${D(M.coll)} AS coll_should_be_zero,
        ${D(`100.0 * ${M.disp} / NULLIF(${M.tgt},0)`, 1)} AS ach_pct
      FROM ${VIEW} ${scope}
      GROUP BY ISNULL(BRAND, '(Unassigned)')
      ORDER BY disp DESC;`,
  },
  {
    title: 'ZONE grid — the Zonal Performance tab',
    sql: `
      SELECT
        ISNULL(VKBUR, '(Unassigned)')     AS zone_code,
        ISNULL(MAX(ZONE_NAME),'Unassigned') AS zone_name,
        ${D(M.tgt)}  AS tgt,
        ${D(M.disp)} AS disp,
        ${D(M.coll)} AS coll,
        ${D(M.cn)}   AS cn,
        ${D(M.os)}   AS os,
        ${D(`100.0 * ${M.coll} / NULLIF(${M.tgt},0)`, 1)} AS ach_on_coll_pct,
        ${D(`100.0 * ${M.cn} / NULLIF(${M.gross},0)`, 2)} AS cn_pct
      FROM ${VIEW} ${scope}
      GROUP BY ISNULL(VKBUR, '(Unassigned)')
      ORDER BY disp DESC;`,
  },
  {
    title: 'CHECK 1 — zone rollup must equal the division total',
    note: 'If this is non-zero, dim_geo grouping is losing or duplicating rows.',
    sql: `
      WITH div AS (SELECT ${D(M.disp)} AS d, ${D(M.coll)} AS c FROM ${VIEW} ${scope}),
      byzone AS (
        SELECT ${D(M.disp)} AS d, ${D(M.coll)} AS c
        FROM ${VIEW} ${scope}
        GROUP BY ISNULL(VKBUR, '(Unassigned)')
      )
      SELECT
        (SELECT d FROM div) AS div_disp,
        (SELECT SUM(d) FROM byzone) AS zone_disp_sum,
        (SELECT d FROM div) - (SELECT SUM(d) FROM byzone) AS disp_diff,
        (SELECT c FROM div) AS div_coll,
        (SELECT SUM(c) FROM byzone) AS zone_coll_sum,
        (SELECT c FROM div) - (SELECT SUM(c) FROM byzone) AS coll_diff;`,
  },
  {
    title: 'CHECK 2 — GROSS_SALES − CR_NOTES = NET_SALES',
    sql: `
      SELECT ${D(`SUM(CAST(GROSS_SALES AS DECIMAL(38,6))
                       - CAST(CR_NOTES AS DECIMAL(38,6))
                       - CAST(NET_SALES AS DECIMAL(38,6)))`, 4)} AS should_be_zero
      FROM ${VIEW} ${scope};`,
  },
  {
    title: 'CHECK 3 — how much dispatch sits on rows with no brand?',
    note:
      'Key Brands and the mix donuts group by brand; anything here lands in ' +
      '"Unassigned" and the brand rows will not sum to the division total without it.',
    sql: `
      SELECT
        CASE WHEN BRAND IS NULL THEN 'brand NULL' ELSE 'brand set' END AS state,
        ${D(M.disp)} AS disp,
        ${D(M.tgt)}  AS tgt,
        ${D(M.coll)} AS coll,
        COUNT_BIG(*) AS rows_n
      FROM ${VIEW} ${scope}
      GROUP BY CASE WHEN BRAND IS NULL THEN 'brand NULL' ELSE 'brand set' END;`,
  },
  {
    title: 'CHECK 4 — how much dispatch sits on rows with no geography?',
    note: 'These are the rows the "Unassigned" footer count in the UI reports.',
    sql: `
      SELECT
        CASE WHEN VKBUR IS NULL THEN 'no zone' ELSE 'has zone' END AS state,
        ${D(M.disp)} AS disp,
        ${D(M.coll)} AS coll,
        ${D(M.os)}   AS os,
        COUNT_BIG(*) AS rows_n
      FROM ${VIEW} ${scope}
      GROUP BY CASE WHEN VKBUR IS NULL THEN 'no zone' ELSE 'has zone' END;`,
  },
  {
    title: 'CHECK 5 — does any HQ appear under more than one region in this window?',
    note: 'Non-empty means dim_geo must be keyed on (zone, region, hq), not hq alone.',
    sql: `
      SELECT TOP 15 BZIRK, COUNT(DISTINCT VKGRP) AS n_regions, COUNT(DISTINCT VKBUR) AS n_zones
      FROM ${VIEW} ${scope}
      GROUP BY BZIRK HAVING COUNT(DISTINCT VKGRP) > 1
      ORDER BY n_regions DESC;`,
  },
];

const fmt = (v: unknown) =>
  v === null || v === undefined ? 'NULL' : v instanceof Date ? v.toISOString() : String(v);

function table(rows: Record<string, unknown>[]): string {
  const first = rows?.[0];
  if (!first) return '(no rows)';
  const cols = Object.keys(first);
  const ws = cols.map((c) => Math.min(46, Math.max(c.length, ...rows.map((r) => fmt(r[c]).length))));
  const w = (i: number) => ws[i] ?? 10;
  const line = (cs: string[]) => '| ' + cs.map((s, i) => s.slice(0, w(i)).padEnd(w(i))).join(' | ') + ' |';
  return [line(cols), '|' + ws.map((x) => '-'.repeat(x + 2)).join('|') + '|',
    ...rows.map((r) => line(cols.map((c) => fmt(r[c]))))].join('\n');
}

/** Indian abbreviation, so the figures can be eyeballed against an MIS report. */
function inr(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(2)} L`;
  return `${s}${a.toFixed(0)}`;
}

const pool = await new sql.ConnectionPool(config).connect();

process.stdout.write(
  `# Reconciliation — division ${DIVISION}, ${FROM}..${TO}\n\n` +
    `View: ${VIEW}\nRun:  ${new Date().toISOString()}\n\n` +
    `Definitions: Disp = NET_SALES · Tgt = BUDGET1 · Coll = -COLLECTION · ` +
    `Gross = NET_SALES + CR_NOTES\n`,
);

for (const q of QUERIES) {
  process.stdout.write(`\n\n## ${q.title}\n`);
  if (q.note) process.stdout.write(`\n> ${q.note}\n`);
  const t0 = Date.now();
  try {
    const r = await pool
      .request()
      .input('from', sql.NVarChar(24), FROM)
      .input('to', sql.NVarChar(24), TO)
      .input('pfrom', sql.NVarChar(24), priorYr(FROM))
      .input('pto', sql.NVarChar(24), priorYr(TO))
      .input('div', sql.NVarChar(2), DIVISION)
      .query(q.sql);
    const rows = r.recordset as unknown as Record<string, unknown>[];
    process.stdout.write(`\n_${Date.now() - t0} ms_\n\n\`\`\`\n${table(rows)}\n\`\`\`\n`);

    // Repeat the single-row money panels in lakh/crore for eyeballing.
    if (rows?.length === 1) {
      const money = Object.entries(rows[0]!)
        .filter(([k, v]) => typeof v === 'string' && !k.includes('pct') && Number(v) > 1000)
        .map(([k, v]) => `${k} = ${inr(Number(v))}`);
      if (money.length) process.stdout.write(`\n${money.join(' · ')}\n`);
    }
  } catch (e) {
    process.stdout.write(`\n**FAILED (${Date.now() - t0} ms):** ${(e as Error).message}\n`);
  }
}

await pool.close();
