/**
 * The data version token and the open month. (§4.9)
 *
 * Both are derived from the source table: the open month is the newest month
 * present, and the version is a fingerprint of the table — row count, newest
 * month, and two running totals — which changes whenever the table is
 * reloaded. The table has no load timestamp, so `updatedAt` is when this
 * process first saw the current version.
 *
 * The frontend polls this every 60 s to decide whether to invalidate open-month
 * queries, so it must be cheap. It is cached in-process for a minute; against
 * Synapse the underlying query costs a second or two and must never run per
 * request.
 */
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../data/db.js';
import { DATE_KEY, SOURCE } from '../data/sqlFragments.js';
import { DATA_VERSION, OPEN_YR_MN } from './mockData.js';

export interface DataVersion {
  dataVersion: string;
  openYrMn: number;
  updatedAt: string;
}

const TTL_MS = 60_000;

let cached: { value: DataVersion; at: number } | null = null;
let inflight: Promise<DataVersion> | null = null;

export async function getDataVersion(): Promise<DataVersion> {
  if (config.USE_MOCK_DATA) {
    return { dataVersion: DATA_VERSION, openYrMn: OPEN_YR_MN, updatedAt: new Date().toISOString() };
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
  const row = await getDb().one<{
    open_yr_mn: number | string | null;
    n_rows: number | string;
    net: number | string | null;
    sec: number | string | null;
  }>(
    `SELECT MAX(${DATE_KEY}) AS open_yr_mn, COUNT_BIG(*) AS n_rows,
            SUM(CAST(NET_SALES AS DECIMAL(38,2))) AS net, SUM(CAST(secondary AS DECIMAL(38,2))) AS sec
       FROM ${SOURCE}`,
  );

  const openYrMn = Number(row?.open_yr_mn ?? 0);
  const fingerprint = createHash('sha256')
    .update(`${openYrMn}|${row?.n_rows}|${row?.net}|${row?.sec}`)
    .digest('hex')
    .slice(0, 10);
  const dataVersion = `${openYrMn}-${fingerprint}`;

  const value: DataVersion = {
    dataVersion,
    openYrMn,
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
