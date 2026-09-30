// ============================================================
//  One-time bridge script — adds customers.customer_code and the
//  customer_code_sequences counter table on an already-existing dev DB,
//  then backfills every existing customer with a code of the form
//  <type initials><year><6-digit seq>, e.g. DR2026000001 — numbered per
//  (customer_type, registered_at year), in registered_at order. The
//  per-(customer_type, year) sequence counters are then primed so new
//  customers registered after this script continue the same numbering
//  instead of colliding with backfilled codes.
//  Usage:  node db/migrate-add-customer-code.js
//  Safe to re-run — only customers still missing a code are touched.
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

const CUSTOMER_TYPE_INITIALS = {
  patient: 'PT',
  doctor: 'DR',
  'doctor-pharmacy': 'DP',
  hospital: 'HS',
}

try {
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_code VARCHAR(20)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_code_sequences (
      customer_type VARCHAR(30) NOT NULL,
      year          SMALLINT    NOT NULL,
      next_seq      INTEGER     NOT NULL DEFAULT 1,
      PRIMARY KEY (customer_type, year)
    )
  `)

  const { rows: customers } = await pool.query(
    `SELECT id, customer_type, registered_at FROM customers WHERE customer_code IS NULL ORDER BY customer_type, registered_at ASC`
  )

  // seq counters keyed by "type|year", seeded from whatever next_seq already exists
  const counters = new Map()
  const { rows: existingSeqs } = await pool.query(`SELECT customer_type, year, next_seq FROM customer_code_sequences`)
  for (const s of existingSeqs) counters.set(`${s.customer_type}|${s.year}`, s.next_seq)

  let updated = 0
  for (const c of customers) {
    const year = new Date(c.registered_at).getFullYear()
    const key = `${c.customer_type}|${year}`
    const seq = counters.get(key) ?? 1
    counters.set(key, seq + 1)

    const initials = CUSTOMER_TYPE_INITIALS[c.customer_type] ?? 'CU'
    const customerCode = `${initials}${year}${String(seq).padStart(6, '0')}`
    await pool.query(`UPDATE customers SET customer_code = $1 WHERE id = $2`, [customerCode, c.id])
    updated++
  }

  for (const [key, nextSeq] of counters) {
    const [customerType, year] = key.split('|')
    await pool.query(
      `INSERT INTO customer_code_sequences (customer_type, year, next_seq) VALUES ($1, $2, $3)
       ON CONFLICT (customer_type, year) DO UPDATE SET next_seq = $3`,
      [customerType, Number(year), nextSeq]
    )
  }

  const { rows: stillNull } = await pool.query(`SELECT COUNT(*) FROM customers WHERE customer_code IS NULL`)
  if (Number(stillNull[0].count) === 0) {
    await pool.query(`ALTER TABLE customers ALTER COLUMN customer_code SET NOT NULL`)
  }
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_customer_code_key') THEN
        ALTER TABLE customers ADD CONSTRAINT customers_customer_code_key UNIQUE (customer_code);
      END IF;
    END $$
  `)

  console.log(`Done — backfilled ${updated} customer(s), ${stillNull[0].count} still null, sequence counters primed for ${counters.size} (type, year) group(s)`)
} finally {
  await pool.end()
}
