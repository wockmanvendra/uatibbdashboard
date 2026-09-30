// ============================================================
//  One-time bridge script — adds a UNIQUE constraint on
//  products.material_code (global across all divisions) on an
//  already-existing dev DB. schema.sql's CREATE TABLE IF NOT EXISTS
//  only applies to fresh databases, so this brings an existing one
//  in line with it.
//  Usage:  node db/migrate-products-material-code-unique.js
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
  const { rows: dupes } = await pool.query(`
    SELECT material_code FROM products GROUP BY material_code HAVING COUNT(*) > 1
  `)
  if (dupes.length) {
    console.error('Aborting — duplicate material_code values exist, resolve them first:', dupes.map(r => r.material_code))
    process.exitCode = 1
  } else {
    await pool.query(`
      ALTER TABLE products ADD CONSTRAINT products_material_code_key UNIQUE (material_code)
    `)
    console.log('Done — products.material_code is now UNIQUE')
  }
} catch (err) {
  if (err.code === '42710' || err.code === '42P07') {
    console.log('Already applied — products_material_code_key constraint exists')
  } else {
    throw err
  }
} finally {
  await pool.end()
}
