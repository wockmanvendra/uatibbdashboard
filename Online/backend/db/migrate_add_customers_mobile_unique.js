// ============================================================
//  D2D Portal — Make customers.mobile unique
//  Usage:  node db/migrate_add_customers_mobile_unique.js
//
//  Aborts (without altering anything) if duplicate mobile numbers
//  already exist, so they can be resolved manually first.
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

async function main() {
  const { rows: dupes } = await pool.query(
    `SELECT mobile, COUNT(*) FROM customers WHERE mobile IS NOT NULL GROUP BY mobile HAVING COUNT(*) > 1`
  )
  if (dupes.length) {
    console.error('Duplicate customers.mobile values found — resolve these before re-running:')
    for (const row of dupes) console.error(`  ${row.mobile} (${row.count} customers)`)
    await pool.end()
    process.exit(1)
  }

  const { rows: existing } = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'customers_mobile_key'`
  )
  if (existing.length) {
    console.log('customers_mobile_key already exists, skipping')
  } else {
    await pool.query('ALTER TABLE customers ADD CONSTRAINT customers_mobile_key UNIQUE (mobile)')
    console.log('customers.mobile UNIQUE constraint added')
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
