import { readFileSync } from 'node:fs';
import pg from 'pg';

const SCHEMA = new URL('../../db/schema.sql', import.meta.url);

/** Applies db/schema.sql. Idempotent. */
export async function applySchema(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(readFileSync(SCHEMA, 'utf8'));
  } finally {
    await client.end();
  }
}
