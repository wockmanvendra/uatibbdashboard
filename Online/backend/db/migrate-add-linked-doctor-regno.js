// ============================================================
//  One-time bridge script — adds customers.linked_doctor_registration_number,
//  the manually-entered registration number of the doctor a doctor-pharmacy
//  registration links to (Infinity's doctor_master_infinity has no such
//  field, so it can't be auto-filled like linked_doctor_name/speciality).
//  Usage:  node db/migrate-add-linked-doctor-regno.js
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
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS linked_doctor_registration_number VARCHAR(100)`)
  console.log('Done — customers.linked_doctor_registration_number ensured')
} finally {
  await pool.end()
}
