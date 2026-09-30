// ============================================================
//  D2D Portal — Add customers.sap_customer_code column
//  Usage:  node db/migrate_add_customers_sap_code.js
//
//  Adds the customer's own SAP code as a native column on customers
//  (distinct from customer_outstanding.sap_customer_code, which is a
//  per-division balance-matching key) — see schema.sql.
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
  await pool.query(`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS sap_customer_code VARCHAR(30)
  `)
  console.log('customers.sap_customer_code column ensured')

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
