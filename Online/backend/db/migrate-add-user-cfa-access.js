// ============================================================
//  One-time bridge script — creates user_cfa_access on an already-existing
//  dev DB. This table scopes which CFAs a dm/mm account can see/approve
//  customers/orders for — a user with zero rows here is blocked from
//  everything (not unrestricted), so existing dm/mm accounts will need CFAs
//  assigned via Admin Dashboard -> Admin User Details after this runs.
//  Usage:  node db/migrate-add-user-cfa-access.js
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_cfa_access (
        user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cfa_code  VARCHAR(20)  NOT NULL REFERENCES cfa_locations(cfa_code),
        PRIMARY KEY (user_id, cfa_code)
    )
  `)
  console.log('user_cfa_access table ensured')

  const { rows } = await pool.query(`
    SELECT u.usertype, COUNT(*) AS unassigned
    FROM users u
    WHERE u.usertype IN ('dm', 'mm')
      AND NOT EXISTS (SELECT 1 FROM user_cfa_access a WHERE a.user_id = u.id)
    GROUP BY u.usertype
  `)
  if (rows.length === 0) {
    console.log('Every existing dm/mm account already has at least one CFA assigned')
  } else {
    for (const r of rows) {
      console.log(`${r.unassigned} existing '${r.usertype}' account(s) have no CFA assigned yet — they will see/approve nothing until assigned via Admin Dashboard -> Admin User Details`)
    }
  }
} finally {
  await pool.end()
}
