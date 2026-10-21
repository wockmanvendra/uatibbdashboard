/**
 * The data version token and the open month. (§4.9)
 *
 * Both are derived from the sources: the open month is the newest month in the
 * sales table, and the version is a fingerprint of every source — the sales
 * table, the credit-note view, the HR exit and hiring views, the effort data
 * and the headcount tables: row counts,
 * newest months and running totals — which changes whenever any is reloaded.
 * The sources have no load timestamp, so `updatedAt` is when this process
 * first saw the current version.
 *
 * The frontend polls this every 60 s to decide whether to invalidate open-month
 * queries, so it must be cheap. It is cached in-process for a minute; against
 * Synapse the underlying query costs a second or two and must never run per
 * request.
 */
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../data/db.js';
import {
  BUDGET_TM_SOURCE, CN_SOURCE, DATE_KEY, EFFORT_SOURCE, EMP_COUNT_SOURCE, HR_EXIT_SOURCE, HR_HIRING_SOURCE, SOURCE,
} from '../data/sqlFragments.js';
import { AVAILABLE_MONTHS, DATA_VERSION, OPEN_YR_MN } from './mockData.js';

export interface DataVersion {
  dataVersion: string;
  openYrMn: number;
  updatedAt: string;
  /**
   * The first and last months with any gross sales in the sales table — the
   * months CN% can be computed over. Null when it has none. Not sent to the
   * browser; /api/meta/version returns the three fields above.
   */
  salesFrom: number | null;
  salesTo: number | null;
  /** The first and last months with Rx (prescription) data — named when a period has none. */
  rxFrom: number | null;
  rxTo: number | null;
  /** The first and last months of the effort data — named when a period has none. */
  effortFrom: number | null;
  effortTo: number | null;
}

const TTL_MS = 60_000;

let cached: { value: DataVersion; at: number } | null = null;
let inflight: Promise<DataVersion> | null = null;

export async function getDataVersion(): Promise<DataVersion> {
  if (config.USE_MOCK_DATA) {
    return {
      dataVersion: DATA_VERSION,
      openYrMn: OPEN_YR_MN,
      updatedAt: new Date().toISOString(),
      salesFrom: AVAILABLE_MONTHS[0] ?? null,
      salesTo: OPEN_YR_MN,
      rxFrom: AVAILABLE_MONTHS[0] ?? null,
      rxTo: OPEN_YR_MN,
      effortFrom: AVAILABLE_MONTHS[0] ?? null,
      effortTo: OPEN_YR_MN,
    };
  }

  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  // Collapse concurrent misses into one query. Without this, a burst of first
  // requests each pays the full Synapse round trip.
  inflight ??= load().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function load(): Promise<DataVersion> {
  // One statement, every source: a round trip costs a second.
  const row = await getDb().one<{
    open_yr_mn: number | string | null;
    n_rows: number | string;
    net: number | string | null;
    sec: number | string | null;
    sales_from: number | string | null;
    sales_to: number | string | null;
    rx_from: number | string | null;
    rx_to: number | string | null;
    cn_month: number | string | null;
    cn_rows: number | string | null;
    cn: number | string | null;
    exits: number | string | null;
    last_exit: string | null;
    hires: number | string | null;
    last_hire: string | null;
    effort_rows: number | string | null;
    effort_from: number | string | null;
    effort_to: number | string | null;
    budget_tm: number | string | null;
    emp_count: number | string | null;
  }>(
    `SELECT s.*, c.*, e.*, h.*, ef.*, bt.*, ec.*
       FROM (SELECT MAX(${DATE_KEY}) AS open_yr_mn, COUNT_BIG(*) AS n_rows,
                    SUM(CAST(NET_SALES AS DECIMAL(38,2))) AS net, SUM(CAST(secondary AS DECIMAL(38,2))) AS sec,
                    MIN(CASE WHEN GROSS_SALES <> 0 THEN ${DATE_KEY} END) AS sales_from,
                    MAX(CASE WHEN GROSS_SALES <> 0 THEN ${DATE_KEY} END) AS sales_to,
                    MIN(CASE WHEN DR_TOT <> 0 THEN ${DATE_KEY} END) AS rx_from,
                    MAX(CASE WHEN DR_TOT <> 0 THEN ${DATE_KEY} END) AS rx_to
               FROM ${SOURCE}) s
      CROSS JOIN
            (SELECT MAX(${DATE_KEY}) AS cn_month, COUNT_BIG(*) AS cn_rows,
                    SUM(CAST(Total_CreditNote AS DECIMAL(38,2))) AS cn
               FROM ${CN_SOURCE}) c
      CROSS JOIN (SELECT COUNT_BIG(*) AS exits, MAX(DOL) AS last_exit FROM ${HR_EXIT_SOURCE}) e
      CROSS JOIN (SELECT COUNT_BIG(*) AS hires, MAX(BEGDA) AS last_hire FROM ${HR_HIRING_SOURCE}) h
      CROSS JOIN (SELECT COUNT_BIG(*) AS effort_rows,
                         MIN(TRY_CAST(LEFT(effortdate, 6) AS INT)) AS effort_from,
                         MAX(TRY_CAST(LEFT(effortdate, 6) AS INT)) AS effort_to
                    FROM ${EFFORT_SOURCE}) ef
      CROSS JOIN (SELECT SUM(CAST(no_of_tm AS INT)) AS budget_tm FROM ${BUDGET_TM_SOURCE}) bt
      CROSS JOIN (SELECT SUM(CAST(emp_count AS INT)) AS emp_count FROM ${EMP_COUNT_SOURCE}) ec`,
  );

  const openYrMn = Number(row?.open_yr_mn ?? 0);
  const fingerprint = createHash('sha256')
    .update(
      [openYrMn, row?.n_rows, row?.net, row?.sec, row?.cn_month, row?.cn_rows, row?.cn,
        row?.exits, row?.last_exit, row?.hires, row?.last_hire,
        row?.effort_rows, row?.effort_from, row?.effort_to, row?.budget_tm, row?.emp_count].join('|'),
    )
    .digest('hex')
    .slice(0, 10);
  const dataVersion = `${openYrMn}-${fingerprint}`;

  const value: DataVersion = {
    dataVersion,
    openYrMn,
    salesFrom: row?.sales_from === null || row?.sales_from === undefined ? null : Number(row.sales_from),
    salesTo: row?.sales_to === null || row?.sales_to === undefined ? null : Number(row.sales_to),
    rxFrom: row?.rx_from === null || row?.rx_from === undefined ? null : Number(row.rx_from),
    rxTo: row?.rx_to === null || row?.rx_to === undefined ? null : Number(row.rx_to),
    effortFrom: row?.effort_from === null || row?.effort_from === undefined ? null : Number(row.effort_from),
    effortTo: row?.effort_to === null || row?.effort_to === undefined ? null : Number(row.effort_to),
    updatedAt:
      cached?.value.dataVersion === dataVersion ? cached.value.updatedAt : new Date().toISOString(),
  };
  cached = { value, at: Date.now() };
  return value;
}

/** Called by the cache-flush endpoint so a reload is picked up immediately. */
export function resetDataVersionCache(): void {
  cached = null;
}
