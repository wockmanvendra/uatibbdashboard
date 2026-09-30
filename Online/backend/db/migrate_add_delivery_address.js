// ============================================================
//  D2D Portal — Add delivery address support
//  Usage:  node db/migrate_add_delivery_address.js
//
//  Creates customer_addresses (additional delivery addresses beyond a
//  customer's single registration address) and adds a frozen delivery_*
//  snapshot to orders — see schema.sql.
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
    CREATE TABLE IF NOT EXISTS customer_addresses (
        id           SERIAL       PRIMARY KEY,
        customer_id  VARCHAR(30)  NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        label        VARCHAR(50),
        address      TEXT         NOT NULL,
        pin_code     VARCHAR(10),
        city         VARCHAR(100),
        state        VARCHAR(100),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  console.log('customer_addresses table ensured')

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id ON customer_addresses(customer_id)
  `)
  console.log('idx_customer_addresses_customer_id index ensured')

  await pool.query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_address  TEXT,
      ADD COLUMN IF NOT EXISTS delivery_pin_code VARCHAR(10),
      ADD COLUMN IF NOT EXISTS delivery_city     VARCHAR(100),
      ADD COLUMN IF NOT EXISTS delivery_state    VARCHAR(100)
  `)
  console.log('orders.delivery_* columns ensured')

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
