// ============================================================
//  One-time bridge script — adds orders.payment_received_date and
//  orders.payment_received_amount, set when a CFA manually confirms payment
//  was received (PATCH /api/orders/:id/payment, or in bulk via
//  POST /api/orders/payment/upload) on a non-online order.
//  Usage:  node db/migrate-add-cfa-payment.js
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
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_received_date DATE`)
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_received_amount NUMERIC(10,2)`)
  console.log('Done — orders.payment_received_date and orders.payment_received_amount ensured')
} finally {
  await pool.end()
}
