// ============================================================
//  OBSOLETE — DO NOT RUN.
//  admin_user_details was merged into `users` (see
//  migrate_merge_admin_user_details_backfill.js /
//  migrate_merge_admin_user_details_drop.js) and no longer exists.
//  `users.password_hash` is the table logins actually use and has been
//  correct since before the merge; this script's unconditional
//  `password_hash = EXCLUDED.password_hash` would overwrite it with the
//  stale admin_user_details value it was never re-synced with. Kept only
//  as historical record.
// ============================================================
//
//  D2D Portal — Sync admin_user_details -> users (one-time backfill)
//  Usage:  node db/migrate_sync_admin_user_details_users.js
//
//  POST/PATCH on /api/admin-user-details keep `users` in sync going forward
//  (see src/routes/admin-user-details.js), but earlier rows may have been
//  created without a matching `users` row (e.g. manual DB edits) or may have
//  drifted out of sync (e.g. a PATCH whose old plain UPDATE silently affected
//  0 rows). This script upserts every admin_user_details row into `users` so
//  all admin/cfa/mm/dm accounts can log in via /api/auth/password. Idempotent
//  — safe to re-run.
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
  const { rows } = await pool.query(`
    INSERT INTO users (id, usertype, name, mobileno, email, password_hash, division_code, infinity_division_id, is_active)
    SELECT id, usertype, name, mobileno, email, password_hash, division_code, infinity_division_id, is_active
    FROM admin_user_details
    ON CONFLICT (id) DO UPDATE SET
      usertype             = EXCLUDED.usertype,
      name                 = EXCLUDED.name,
      mobileno             = EXCLUDED.mobileno,
      email                = EXCLUDED.email,
      password_hash        = EXCLUDED.password_hash,
      division_code        = EXCLUDED.division_code,
      infinity_division_id = EXCLUDED.infinity_division_id,
      is_active            = EXCLUDED.is_active
    RETURNING id
  `)
  console.log(`synced ${rows.length} admin_user_details row(s) into users`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
