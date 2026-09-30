// ============================================================
//  One-time bridge script — adds:
//   - orders.lr_number / lr_date / sap_order_number / pod_url / pod_original_name
//     (CFA-recorded dispatch details, set via PATCH /api/orders/:id/dispatch
//     or the bulk Excel upload at POST /api/orders/dispatch/upload)
//   - users.cfa_code and admin_user_details.cfa_code (FK -> cfa_locations) —
//     the one CFA location a 'cfa' usertype account is scoped to. NULL until
//     an admin assigns one via Admin Dashboard -> Admin User Details; a cfa
//     account with no cfa_code sees zero orders/customers, same "zero
//     assigned = zero access" precedent as dm/mm's user_cfa_access.
//  Usage:  node db/migrate-add-cfa-dispatch.js
//  Safe to re-run (IF NOT EXISTS / pg_constraint guards); delete after use.
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
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS lr_number VARCHAR(50)`)
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS lr_date DATE`)
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS sap_order_number VARCHAR(40)`)
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pod_url TEXT`)
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pod_original_name VARCHAR(255)`)
  console.log('orders dispatch columns ensured (lr_number, lr_date, sap_order_number, pod_url, pod_original_name)')

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cfa_code VARCHAR(20)`)
  await pool.query(`ALTER TABLE admin_user_details ADD COLUMN IF NOT EXISTS cfa_code VARCHAR(20)`)
  console.log('users.cfa_code and admin_user_details.cfa_code ensured')

  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_cfa_code_fkey') THEN
        ALTER TABLE users ADD CONSTRAINT users_cfa_code_fkey
          FOREIGN KEY (cfa_code) REFERENCES cfa_locations(cfa_code);
      END IF;
    END $$
  `)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_user_details_cfa_code_fkey') THEN
        ALTER TABLE admin_user_details ADD CONSTRAINT admin_user_details_cfa_code_fkey
          FOREIGN KEY (cfa_code) REFERENCES cfa_locations(cfa_code);
      END IF;
    END $$
  `)
  console.log('Done — cfa_code FK constraints in place')

  const { rows } = await pool.query(`SELECT COUNT(*) FROM users WHERE usertype = 'cfa' AND cfa_code IS NULL`)
  console.log(`${rows[0].count} existing 'cfa' account(s) have no cfa_code yet — they will see/access nothing until assigned via Admin Dashboard -> Admin User Details`)
} finally {
  await pool.end()
}
