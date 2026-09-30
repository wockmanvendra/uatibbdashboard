// ============================================================
//  One-time bridge script — adds the outstanding_since column to
//  customer_outstanding (timestamps when a balance last went positive,
//  drives "outstanding days" aging on the frontend).
//  Usage:  node db/migrate-add-customer-outstanding-since.js
//  Safe to re-run — ADD COLUMN IF NOT EXISTS; delete after use.
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
  await pool.query(
    `ALTER TABLE customer_outstanding ADD COLUMN IF NOT EXISTS outstanding_since TIMESTAMPTZ`
  )
  console.log('Done — customer_outstanding.outstanding_since column added')
} finally {
  await pool.end()
}
