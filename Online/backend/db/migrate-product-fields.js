// ============================================================
//  One-time bridge script — drops products.category/stock and
//  adds products.material_code on an already-existing dev DB.
//  schema.sql's CREATE TABLE IF NOT EXISTS only applies to fresh
//  databases, so this brings an existing one in line with it.
//  Usage:  node db/migrate-product-fields.js
//  Safe to re-run (IF EXISTS / IF NOT EXISTS); delete after use.
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
      ADD COLUMN IF NOT EXISTS material_code VARCHAR(50),
      ADD COLUMN IF NOT EXISTS image_url TEXT,
      DROP COLUMN IF EXISTS category,
      DROP COLUMN IF EXISTS stock
  `)
  console.log('products table migrated: +material_code, +image_url, -category, -stock')
} finally {
  await pool.end()
}
