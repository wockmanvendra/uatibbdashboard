// ============================================================
//  One-time bridge script — adds products.unit / unit_description
//  on an already-existing dev DB. schema.sql's CREATE TABLE IF NOT
//  EXISTS only applies to fresh databases, so this brings an
//  existing one in line with it.
//  Usage:  node db/migrate-add-product-unit.js
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
  await pool.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS unit VARCHAR(100),
      ADD COLUMN IF NOT EXISTS unit_description TEXT
  `)
  console.log('products table migrated: +unit, +unit_description')
} finally {
  await pool.end()
}
