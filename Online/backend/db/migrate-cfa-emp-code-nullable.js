// ============================================================
//  One-time bridge script — drops NOT NULL on admin_user_details.emp_code.
//  emp_code is an employee/HR code (field-rep concept) that doesn't apply
//  to 'cfa' usertype accounts — the app layer already treats it as optional
//  for cfa (see POST /admin-user-details), but the column itself was never
//  relaxed to match, so cfa accounts with no emp_code fail at the DB level.
//  Usage:  node db/migrate-cfa-emp-code-nullable.js
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
  await pool.query(`ALTER TABLE admin_user_details ALTER COLUMN emp_code DROP NOT NULL`)
  console.log('Done — admin_user_details.emp_code is now nullable')
} finally {
  await pool.end()
}
