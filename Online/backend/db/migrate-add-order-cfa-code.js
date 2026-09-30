// ============================================================
//  One-time bridge script — replaces orders.delivery_state (a free-text
//  state name) with orders.delivery_state_code (resolved against
//  state_master) and adds orders.cfa_code (resolved against
//  cfa_state_master, same division+state -> CFA lookup customers already
//  use). Existing rows are backfilled before either FK constraint is added,
//  and delivery_state is dropped only after the backfill runs.
//  Usage:  node db/migrate-add-order-cfa-code.js
//  Safe to re-run (IF NOT EXISTS / IS NULL guards); delete after use.
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
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_state_code VARCHAR(10)`)
  await pool.query(`
    UPDATE orders o SET delivery_state_code = sm.state_code
    FROM state_master sm
    WHERE o.delivery_state_code IS NULL AND LOWER(sm.state_name) = LOWER(o.delivery_state)
  `)

  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cfa_code VARCHAR(20)`)
  await pool.query(`
    UPDATE orders o SET cfa_code = csm.cfa_code
    FROM cfa_state_master csm
    WHERE o.cfa_code IS NULL AND o.delivery_state_code IS NOT NULL
      AND csm.division_code = o.division_code AND csm.state_code = o.delivery_state_code
  `)

  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_state_code_fkey') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_delivery_state_code_fkey
          FOREIGN KEY (delivery_state_code) REFERENCES state_master(state_code);
      END IF;
    END $$
  `)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_cfa_code_fkey') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_cfa_code_fkey
          FOREIGN KEY (cfa_code) REFERENCES cfa_locations(cfa_code);
      END IF;
    END $$
  `)

  const { rows: unresolved } = await pool.query(`SELECT COUNT(*) FROM orders WHERE delivery_state_code IS NULL AND delivery_state IS NOT NULL`)
  console.log(`delivery_state_code backfilled — ${unresolved[0].count} row(s) had a delivery_state that didn't match state_master and stayed null`)

  await pool.query(`ALTER TABLE orders DROP COLUMN IF EXISTS delivery_state`)
  console.log('Done — orders.delivery_state dropped, delivery_state_code and cfa_code in place')
} finally {
  await pool.end()
}
