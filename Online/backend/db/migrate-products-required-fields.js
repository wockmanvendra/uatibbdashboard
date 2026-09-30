// ============================================================
//  One-time bridge script — makes products.material_code,
//  products.description and products.unit NOT NULL on an already-
//  existing dev DB. schema.sql's CREATE TABLE IF NOT EXISTS only
//  applies to fresh databases, so this brings an existing one in
//  line with it. Existing rows missing these values are backfilled
//  with a placeholder ('N/A') so the NOT NULL constraint can be
//  applied immediately; admins clean up real values later via Edit.
//  Usage:  node db/migrate-products-required-fields.js
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
  await pool.query(`UPDATE products SET material_code = 'N/A' WHERE material_code IS NULL OR material_code = ''`)
  await pool.query(`UPDATE products SET description   = 'N/A' WHERE description   IS NULL OR description   = ''`)
  await pool.query(`UPDATE products SET unit           = 'N/A' WHERE unit           IS NULL OR unit           = ''`)
  await pool.query(`ALTER TABLE products ALTER COLUMN material_code SET NOT NULL`)
  await pool.query(`ALTER TABLE products ALTER COLUMN description   SET NOT NULL`)
  await pool.query(`ALTER TABLE products ALTER COLUMN unit           SET NOT NULL`)
  console.log('Done — products.material_code, .description and .unit backfilled and set NOT NULL')
} finally {
  await pool.end()
}
