// ============================================================
//  One-time bridge script — adds the payment_status column to orders
//  (Pending | Success), defaulting existing rows to 'Pending'.
//  Usage:  node db/migrate-add-order-payment-status.js
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
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'Pending'`
  )
  console.log('Done — orders.payment_status column added (default Pending)')
} finally {
  await pool.end()
}
