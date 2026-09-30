// ============================================================
//  D2D Portal — Add division_rules.allowed_login_customer_types
//  Usage:  node db/migrate_add_allowed_login_customer_types.js
//
//  New column controlling which customer types (patient/doctor/
//  doctor-pharmacy/hospital) may log in (OTP) to their own account in a
//  division — independent of allowed_customer_types (registration
//  eligibility). NOT NULL with a default so every existing row is
//  automatically backfilled to "all types allowed" (today's behavior),
//  no separate UPDATE needed.
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
    ALTER TABLE division_rules
      ADD COLUMN IF NOT EXISTS allowed_login_customer_types TEXT[] NOT NULL
        DEFAULT ARRAY['patient','doctor','doctor-pharmacy','hospital']
  `)
  console.log('division_rules.allowed_login_customer_types ensured')
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
