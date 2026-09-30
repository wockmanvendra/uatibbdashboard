// ============================================================
//  One-time bridge script — the division_mapping table on this dev DB
//  predates the PRIMARY KEY constraint declared on it in schema.sql, so
//  ON CONFLICT (division_code) upserts (db/seed.js) fail with "no unique
//  or exclusion constraint matching". Adds the missing PK if absent.
//  Usage:  node db/migrate-division-mapping-pk.js
//  Safe to re-run.
// ============================================================

import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'd2d_portal',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
})

try {
  const { rows } = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conrelid = 'division_mapping'::regclass AND contype = 'p'`
  )
  if (rows.length) {
    console.log('division_mapping already has a primary key — nothing to do')
  } else {
    await pool.query('ALTER TABLE division_mapping ADD PRIMARY KEY (division_code)')
    console.log('Added PRIMARY KEY (division_code) to division_mapping')
  }
} finally {
  await pool.end()
}
