// ============================================================
//  D2D Portal — Add admin_user_details.emp_code, make email/emp_code mandatory
//  Usage:  node db/migrate_add_admin_user_details_empcode.js
//
//  Adds emp_code to admin_user_details (employee code, e.g. SAP/HR code),
//  backfills any existing rows missing email/emp_code with placeholder
//  values, then enforces NOT NULL on both columns.
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
  await pool.query('ALTER TABLE admin_user_details ADD COLUMN IF NOT EXISTS emp_code VARCHAR(20)')
  console.log('admin_user_details.emp_code column ensured')

  const backfillEmpCode = await pool.query(`
    UPDATE admin_user_details SET emp_code = id WHERE emp_code IS NULL
  `)
  console.log(`backfilled emp_code for ${backfillEmpCode.rowCount} row(s) using id`)

  const backfillEmail = await pool.query(`
    UPDATE admin_user_details SET email = mobileno || '@placeholder.d2d' WHERE email IS NULL
  `)
  console.log(`backfilled email for ${backfillEmail.rowCount} row(s) using mobileno placeholder`)

  await pool.query('ALTER TABLE admin_user_details ALTER COLUMN email SET NOT NULL')
  await pool.query('ALTER TABLE admin_user_details ALTER COLUMN emp_code SET NOT NULL')
  console.log('admin_user_details.email and emp_code are now NOT NULL')

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
