/**
 * The database connection.
 *
 * ---------------------------------------------------------------------------
 * DEVIATION FROM INVARIANT I9 — deliberate, decided by the user 2026-08-11.
 * ---------------------------------------------------------------------------
 * ARCHITECTURE.md I9 says the API never connects to Synapse, and §4.0 explains
 * why: a Synapse dedicated pool has a per-query floor of roughly 1–2 seconds
 * (measured on this pool: 1657 ms cold / 986 ms warm for a one-row aggregate),
 * and it meters concurrency slots rather than connections.
 *
 * The serving database that invariant assumes does not exist yet, and the user
 * chose to query Synapse directly rather than stand up an interim serving tier.
 * The consequence is accepted: tab loads and filter changes run in seconds, not
 * milliseconds, and concurrent users contend for pool slots.
 *
 * The panel SQL is generated from `sqlFragments.ts`, which names the one source
 * table (DASHBOARD_TABLE, Infinity.Infinity_Reports) in one place, so moving to
 * a serving database is a config change plus that file.
 *
 * Because every query is now expensive, the cache is no longer an optimisation
 * — it is what makes the dashboard usable at all. See §7.4.
 */
import mssql from 'mssql';
import { config } from '../config.js';

export type SqlParams = Record<string, string | number | null>;

export interface Db {
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  one<T>(sql: string, params?: SqlParams): Promise<T | null>;
  close(): Promise<void>;
}

class MssqlDb implements Db {
  private pool: mssql.ConnectionPool | null = null;
  private connecting: Promise<mssql.ConnectionPool> | null = null;

  constructor(
    private readonly cfg: {
      server: string;
      database: string;
      user: string;
      password: string;
      encrypt: boolean;
      poolMax: number;
      requestTimeoutMs: number;
    },
  ) {}

  private async pooled(): Promise<mssql.ConnectionPool> {
    if (this.pool) return this.pool;
    // Guard against a burst of first requests each opening its own pool.
    this.connecting ??= new mssql.ConnectionPool({
      server: this.cfg.server,
      database: this.cfg.database,
      user: this.cfg.user,
      password: this.cfg.password,
      port: 1433,
      options: {
        encrypt: this.cfg.encrypt,
        trustServerCertificate: false,
        enableArithAbort: true,
      },
      // Never a connection per request. (§7.6)
      //
      // Against Synapse `max` is also a throttle: the pool meters concurrency
      // slots, and a DW100c allows only four concurrent queries. Opening more
      // connections than that does not make anything faster — it just moves the
      // queue from our process into the warehouse, where we cannot see it.
      pool: { min: 2, max: this.cfg.poolMax, idleTimeoutMillis: 60_000 },
      requestTimeout: this.cfg.requestTimeoutMs,
      connectionTimeout: 30_000,
    }).connect();
    this.pool = await this.connecting;
    return this.pool;
  }

  async all<T>(sql: string, params: SqlParams = {}): Promise<T[]> {
    const pool = await this.pooled();
    const req = pool.request();
    // Parameterised, always. String-concatenated SQL fails review. (§7.6)
    for (const [k, v] of Object.entries(params)) req.input(k, v);
    const res = await req.query<T>(sql);
    return res.recordset;
  }

  async one<T>(sql: string, params: SqlParams = {}): Promise<T | null> {
    const rows = await this.all<T>(sql, params);
    return rows[0] ?? null;
  }

  async close(): Promise<void> {
    await this.pool?.close();
    this.pool = null;
    this.connecting = null;
  }
}

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) return instance;
  instance = new MssqlDb({
    server: config.SQL_SERVER!,
    database: config.SQL_DATABASE!,
    user: config.SQL_USER!,
    password: config.SQL_PASSWORD!,
    encrypt: config.SQL_ENCRYPT,
    poolMax: config.SQL_POOL_MAX,
    // Synapse needs a far longer ceiling than a serving database would.
    requestTimeoutMs: config.DATA_SOURCE === 'synapse-direct' ? 120_000 : 15_000,
  });
  return instance;
}

export async function closeDb(): Promise<void> {
  await instance?.close();
  instance = null;
}
