// ============================================================
//  One-time bridge script — creates division_contacts on an already-existing
//  dev DB. Holds, per division_code, a CC email list and an admin mobile
//  number — every workflow/payment notification email CCs cc_emails, and
//  admin_mobile replaces the single global ADMIN_CONTACT_MOBILE env var as
//  the frontend's error-modal contact number. Starts empty; populate rows
//  via the admin-only GET/POST/PATCH/DELETE /api/division-contacts routes.
//  Usage:  node db/migrate-add-division-contacts.js
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
    CREATE TABLE IF NOT EXISTS division_contacts (
        division_code VARCHAR(20)  PRIMARY KEY,
        cc_emails     TEXT[]       NOT NULL DEFAULT '{}',
        admin_mobile  VARCHAR(20)
    )
  `)
  console.log('division_contacts table ensured')
} finally {
  await pool.end()
}
