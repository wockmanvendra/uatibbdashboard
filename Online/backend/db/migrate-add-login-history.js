// ============================================================
//  One-time bridge script — adds the login_history table on an
//  already-existing dev DB. schema.sql's CREATE TABLE IF NOT EXISTS
//  only applies to fresh databases, so this brings an existing one
//  in line with it.
//  Usage:  node db/migrate-add-login-history.js
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
    CREATE TABLE IF NOT EXISTS login_history (
      id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID,
      name           VARCHAR(100),
      mobileno       VARCHAR(15)  NOT NULL,
      usertype       VARCHAR(30),
      login_method   VARCHAR(10)  NOT NULL,
      status         VARCHAR(20)  NOT NULL,
      failure_reason TEXT,
      division_code  VARCHAR(20),
      logged_in_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  console.log('Done — login_history table created')
} finally {
  await pool.end()
}
