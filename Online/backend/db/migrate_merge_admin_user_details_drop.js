// ============================================================
//  D2D Portal — Drop admin_user_details (step 2 of 2, destructive)
//  Usage:  node db/migrate_merge_admin_user_details_drop.js
//
//  Run this ONLY after:
//   1. migrate_merge_admin_user_details_backfill.js has been run and reviewed.
//   2. src/routes/admin-user-details.js and src/routes/masters.js are deployed
//      (both now read/write `users` directly, not admin_user_details).
//   3. The app has been verified end-to-end against `users` (login, admin
//      panel CRUD, /masters/counts) — see the merge plan for the checklist.
//
//  Aborts with no changes if any admin_user_details row still lacks a
//  matching users row. DROP ... CASCADE removes admin_user_details_cfa_code_fkey
//  along with the table; nothing else references admin_user_details as an FK
//  target (user_cfa_access.user_id already points at users).
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
  const { rows: orphanRows } = await pool.query(`
    SELECT id, name, usertype FROM admin_user_details WHERE id NOT IN (SELECT id FROM users)
  `)
  if (orphanRows.length) {
    console.error(`Abort: ${orphanRows.length} admin_user_details row(s) have no matching users row — run migrate_merge_admin_user_details_backfill.js first.`, orphanRows)
    process.exit(1)
  }

  await pool.query(`DROP TABLE admin_user_details CASCADE`)
  console.log('Dropped admin_user_details (and its cfa_code FK constraint).')

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
