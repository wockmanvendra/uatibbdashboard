// ============================================================
//  One-time bridge script — adds partial unique indexes on
//  customers.gst_number and customers.drug_licence_number. Partial (not a
//  plain UNIQUE constraint) because composition-scheme registrations store
//  gst_number as '' (empty string, not NULL — see POST /customers'
//  `gst_number ?? null`), and a plain UNIQUE column would reject a second
//  such row as a duplicate of the first blank one.
//  Usage:  node db/migrate-add-gst-drug-licence-unique.js
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
    CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_gst_number
      ON customers(gst_number)
      WHERE gst_number IS NOT NULL AND gst_number != ''
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_drug_licence_number
      ON customers(drug_licence_number)
      WHERE drug_licence_number IS NOT NULL AND drug_licence_number != ''
  `)
  console.log('Done — ux_customers_gst_number and ux_customers_drug_licence_number ensured')
} finally {
  await pool.end()
}
