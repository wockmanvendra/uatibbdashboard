import pg from 'pg';
import { config } from '../config.js';

let pool: pg.Pool | null = null;

export function userDb(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: config.USER_DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

export async function closeUserDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
