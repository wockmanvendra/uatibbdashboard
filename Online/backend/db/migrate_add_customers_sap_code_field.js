// ============================================================
//  D2D Portal — Add customers.sap_code column
//  Usage:  node db/migrate_add_customers_sap_code_field.js
//
//  Adds the SAP code sourced from the doctor/chemist infinity
//  master directory into the customers table as a native column.
//  Distinct from sap_customer_code (outstanding-balance key).
//
//  The column is added nullable so existing rows are not broken;
//  a CHECK constraint blocks empty-string values on all writes.
//  New rows are enforced non-null at the application layer.
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
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS sap_code VARCHAR(30)
  `)
  console.log('customers.sap_code column ensured')

  // Add check constraint idempotently — ignore if it already exists
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customers_sap_code_not_blank'
          AND conrelid = 'customers'::regclass
      ) THEN
        ALTER TABLE customers
          ADD CONSTRAINT customers_sap_code_not_blank CHECK (sap_code <> '');
      END IF;
    END
    $$
  `)
  console.log('customers.sap_code not-blank constraint ensured')

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
