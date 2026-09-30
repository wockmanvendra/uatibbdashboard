// ============================================================
//  One-time migration — adds otp_expires_at column to users so
//  the OTP login flow can store a generated OTP with an expiry.
//  Usage:  node db/migrate-add-otp-expires-at.js
//  Safe to re-run (IF NOT EXISTS).
// ============================================================

import 'dotenv/config'
import pool from '../src/db/pool.js'

await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
`)

console.log('Migration complete: otp_expires_at added to users table')
await pool.end()
