import pg from 'pg';
import { applySchema } from '../users/schema.js';
import { TEST_USER_DATABASE_URL, assertTestDb } from './testDb.js';

/** Creates the test user database if needed and brings its schema up to date. */
export default async function setup(): Promise<void> {
  assertTestDb(TEST_USER_DATABASE_URL);
  const url = new URL(TEST_USER_DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  await applySchema(TEST_USER_DATABASE_URL);
}
