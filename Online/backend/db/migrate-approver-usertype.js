// ============================================================
//  D2D Portal — Migration: add approver_usertype to approval logs
//  Usage:  node db/migrate-approver-usertype.js
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

async function run() {
  await pool.query(`ALTER TABLE order_approvals ADD COLUMN IF NOT EXISTS approver_usertype VARCHAR(30)`)
  await pool.query(`ALTER TABLE customer_approvals ADD COLUMN IF NOT EXISTS approver_usertype VARCHAR(30)`)
  console.log('Migration complete: approver_usertype added to order_approvals and customer_approvals.')
}

run()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => pool.end())
