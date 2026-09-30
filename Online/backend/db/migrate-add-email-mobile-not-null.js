// ============================================================
//  One-time bridge script — adds NOT NULL on customers.email and
//  customers.mobile. Both are already required on every registration form
//  (emailRule/mobileRule) and UNIQUE at the DB level, but the NOT NULL
//  itself was never added. Safe to run as long as there are no existing
//  NULL rows (confirmed none at the time this migration was written).
//  Usage:  node db/migrate-add-email-mobile-not-null.js
//  Safe to re-run; delete after use.
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
  await pool.query(`ALTER TABLE customers ALTER COLUMN email SET NOT NULL`)
  await pool.query(`ALTER TABLE customers ALTER COLUMN mobile SET NOT NULL`)
  console.log('Done — customers.email and customers.mobile are now NOT NULL')
} finally {
  await pool.end()
}
