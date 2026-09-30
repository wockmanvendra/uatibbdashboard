// ============================================================
//  One-time bridge script — adds order_items.material_code on an
//  already-existing dev DB and backfills it from products for
//  historical rows. schema.sql's CREATE TABLE IF NOT EXISTS only
//  applies to fresh databases, so this brings an existing one in
//  line with it.
//  Usage:  node db/migrate-order-items-material-code.js
//  Safe to re-run (IF NOT EXISTS); delete after use.
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
  await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS material_code VARCHAR(50)`)
  const { rowCount } = await pool.query(`
    UPDATE order_items oi
    SET material_code = p.material_code
    FROM products p
    WHERE p.id = oi.product_id AND oi.material_code IS NULL
  `)
  console.log(`order_items table migrated: +material_code (backfilled ${rowCount} row(s))`)
} finally {
  await pool.end()
}
