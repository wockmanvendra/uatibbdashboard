// One-shot migration: adds account lockout + password lifecycle columns to users.
// Usage: node backend/db/migrations/add_account_lockout.js
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

async function migrate() {
  console.log('Running account lockout migration...')
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS failed_attempts      INT         NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_at            TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ
  `)
  console.log('Done — columns added (or already existed).')
  await pool.end()
}

migrate().catch(err => { console.error(err); process.exit(1) })
