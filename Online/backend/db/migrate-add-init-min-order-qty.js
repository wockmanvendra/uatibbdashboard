// ============================================================
//  One-time bridge script — adds products.init_min_order_qty on an
//  already-existing dev DB. schema.sql's CREATE TABLE IF NOT EXISTS
//  only applies to fresh databases, so this brings an existing one
//  in line with it. Existing rows are backfilled with their own
//  min_order_qty value, so the order-entry stepper's first jump
//  matches today's behavior until an admin sets a different value.
//  Usage:  node db/migrate-add-init-min-order-qty.js
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
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS init_min_order_qty INTEGER`)
  await pool.query(`UPDATE products SET init_min_order_qty = min_order_qty WHERE init_min_order_qty IS NULL`)
  await pool.query(`ALTER TABLE products ALTER COLUMN init_min_order_qty SET NOT NULL`)
  await pool.query(`ALTER TABLE products ALTER COLUMN init_min_order_qty SET DEFAULT 1`)
  console.log('Done — products.init_min_order_qty column added and backfilled from min_order_qty')
} finally {
  await pool.end()
}
