// ============================================================
//  D2D Portal — Add users.user_location column
//  Usage:  node db/migrate_add_users_location.js
//
//  users.user_location mirrors vw_infinity_users.user_location, populated by
//  POST /api/masters/sync/users — used to scope the doctor/chemist directory
//  on the registration page to a TM's own location.
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
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS user_location VARCHAR(150)')
  console.log('users.user_location column ensured')

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
