// ============================================================
//  D2D Portal — Add admin_user_details table
//  Usage:  node db/migrate_add_admin_user_details.js
//
//  Creates the admin_user_details table (manually-managed login accounts
//  for admin/cfa/mm/dm — see schema.sql) and backfills it from any existing
//  admin/cfa/mm/dm rows in `users`.
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
  // An earlier admin_user_details table (different schema: emp_code/emp_name/
  // usertype/mobile_no/email_id, used by vw_tm_hierarchy) has been superseded —
  // drop it so the schema below can be created.
  await pool.query(`DROP TABLE IF EXISTS admin_user_details`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_user_details (
        id                   VARCHAR(20)  PRIMARY KEY,
        usertype             VARCHAR(30)  NOT NULL,
        name                 VARCHAR(100) NOT NULL,
        mobileno             VARCHAR(15)  UNIQUE NOT NULL,
        email                VARCHAR(150),
        password_hash        VARCHAR(255) NOT NULL,
        division_code        VARCHAR(20),
        infinity_division_id VARCHAR(20),
        is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  console.log('admin_user_details table ensured')

  const { rows } = await pool.query(`
    INSERT INTO admin_user_details
      (id, usertype, name, mobileno, email, password_hash, division_code, infinity_division_id, is_active)
    SELECT id, usertype, name, mobileno, email, password_hash, division_code, infinity_division_id, is_active
    FROM users
    WHERE usertype IN ('mm','dm','cfa','admin') AND password_hash IS NOT NULL
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `)
  console.log(`backfilled ${rows.length} admin/cfa/mm/dm account(s) from users`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
