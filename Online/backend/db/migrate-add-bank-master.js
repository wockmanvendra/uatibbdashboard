// ============================================================
//  One-time bridge script — creates the bank_master table on an
//  already-existing dev DB and seeds it with common bank names, so the
//  "Select bank" dropdown for post-dated-cheque payments isn't empty.
//  Usage:  node db/migrate-add-bank-master.js
//  Safe to re-run (IF NOT EXISTS / ON CONFLICT); delete after use.
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

const BANK_NAMES = [
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Punjab National Bank',
  'Bank of Baroda',
  'Kotak Mahindra Bank',
  'Yes Bank',
  'IndusInd Bank',
  'Canara Bank',
]

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bank_master (
        bank_name  VARCHAR(120)  PRIMARY KEY
    )
  `)
  console.log('bank_master table created (or already existed)')

  for (const bankName of BANK_NAMES) {
    await pool.query('INSERT INTO bank_master (bank_name) VALUES ($1) ON CONFLICT DO NOTHING', [bankName])
  }
  console.log(`  seeded ${BANK_NAMES.length} bank names`)
} finally {
  await pool.end()
}
