// ============================================================
//  D2D Portal — Add users.empcode column, drop tm_hierarchy table
//  Usage:  node db/migrate_add_users_empcode.js
//
//  users.empcode is the join key into vw_tm_hierarchy/vw_infinity_users for
//  approval-hierarchy lookups (replaces the static tm_hierarchy table).
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
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS empcode VARCHAR(20) UNIQUE')
  console.log('users.empcode column ensured')

  await pool.query('DROP TABLE IF EXISTS tm_hierarchy')
  console.log('tm_hierarchy table dropped')

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
