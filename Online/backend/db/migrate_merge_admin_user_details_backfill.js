// ============================================================
//  D2D Portal — Backfill users.empcode from admin_user_details (step 1 of 2)
//  Usage:  node db/migrate_merge_admin_user_details_backfill.js
//
//  Part of merging admin_user_details into users (see admin-user-details.js,
//  masters.js /counts). This script is non-destructive and idempotent — safe
//  to re-run. It does NOT drop admin_user_details; that happens separately in
//  migrate_merge_admin_user_details_drop.js once the app code no longer reads
//  or writes admin_user_details.
//
//  Steps:
//   1. Orphan guard — upsert any admin_user_details row with no matching
//      users row (defensive; none expected). Never overwrites an existing
//      users row's password_hash.
//   2. Backfill users.empcode from admin_user_details.emp_code where users.empcode
//      is currently NULL (the old dual-write never copied this field).
//   3. Diagnostic-only: report any remaining drift between the two tables
//      (expected: password_hash differs for every row, because
//      auth.js's change-password flow only ever updated users.password_hash —
//      users is the table logins actually use, so it wins; no write here).
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
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: orphanRows } = await client.query(`
      INSERT INTO users (id, usertype, name, mobileno, email, division_code, cfa_code, infinity_division_id, is_active, empcode)
      SELECT aud.id, aud.usertype, aud.name, aud.mobileno, aud.email, aud.division_code, aud.cfa_code, aud.infinity_division_id, aud.is_active, aud.emp_code
      FROM admin_user_details aud
      WHERE aud.id NOT IN (SELECT id FROM users)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `)
    console.log(`orphan guard: inserted ${orphanRows.length} admin_user_details row(s) with no prior users row`)

    // emp_code values collide *within* admin_user_details itself (e.g. two rows
    // both carrying the placeholder '1') even though none collide against an
    // existing users.empcode — users.empcode is UNIQUE, so backfilling every
    // row naively would violate that constraint. Skip any emp_code value that
    // isn't unique within admin_user_details and report it instead of guessing
    // which row should keep it.
    const { rows: dupeCodes } = await client.query(`
      SELECT emp_code FROM admin_user_details
      WHERE emp_code IS NOT NULL
      GROUP BY emp_code HAVING COUNT(*) > 1
    `)
    const dupeCodeList = dupeCodes.map(r => r.emp_code)
    if (dupeCodeList.length) console.log(`emp_code values duplicated across multiple admin_user_details rows (skipped, left NULL in users):`, dupeCodeList)

    const { rows: backfilledRows } = await client.query(`
      UPDATE users u
      SET empcode = aud.emp_code
      FROM admin_user_details aud
      WHERE u.id = aud.id AND u.empcode IS NULL AND aud.emp_code IS NOT NULL
        AND aud.emp_code <> ALL($1::varchar[])
      RETURNING u.id, u.name, u.empcode
    `, [dupeCodeList])
    console.log(`backfilled empcode on ${backfilledRows.length} users row(s):`, backfilledRows)

    const { rows: skippedRows } = await client.query(`
      SELECT aud.id, aud.name, aud.usertype, aud.emp_code
      FROM admin_user_details aud
      WHERE aud.emp_code = ANY($1::varchar[])
    `, [dupeCodeList])
    if (skippedRows.length) console.log(`rows left with empcode=NULL due to collision (assign real HR codes manually if needed):`, skippedRows)

    const { rows: driftRows } = await client.query(`
      SELECT aud.id, aud.name, aud.usertype,
             (aud.password_hash = u.password_hash) AS password_matches,
             aud.name = u.name AS name_matches,
             aud.mobileno = u.mobileno AS mobileno_matches,
             aud.email IS NOT DISTINCT FROM u.email AS email_matches,
             aud.division_code IS NOT DISTINCT FROM u.division_code AS division_code_matches,
             aud.cfa_code IS NOT DISTINCT FROM u.cfa_code AS cfa_code_matches,
             aud.infinity_division_id IS NOT DISTINCT FROM u.infinity_division_id AS infinity_division_id_matches,
             aud.is_active = u.is_active AS is_active_matches
      FROM admin_user_details aud
      JOIN users u ON u.id = aud.id
    `)
    const passwordDrift = driftRows.filter(r => !r.password_matches)
    const otherDrift = driftRows.filter(r =>
      !r.name_matches || !r.mobileno_matches || !r.email_matches ||
      !r.division_code_matches || !r.cfa_code_matches || !r.infinity_division_id_matches || !r.is_active_matches
    )
    console.log(`password_hash drift (users wins, no action taken): ${passwordDrift.length} row(s)`, passwordDrift.map(r => ({ id: r.id, name: r.name })))
    console.log(`other-field drift (unexpected if non-zero):`, otherDrift)

    await client.query('COMMIT')
    console.log('\nBackfill complete. admin_user_details is untouched otherwise. Next: deploy the users-backed admin-user-details route, verify, then run migrate_merge_admin_user_details_drop.js.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
