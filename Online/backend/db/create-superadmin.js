// One-time script to insert a super-admin user into the production DB.
// Usage:  node db/create-superadmin.js
// Safe to re-run — uses ON CONFLICT DO NOTHING on mobileno.

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import pool from '../src/db/pool.js'

// ── Edit these values before running ────────────────────────────────────────
const NAME     = 'Super Admin'
const MOBILENO = '9000000030'          // must be unique in users table
const EMAIL    = 'superadmin@example.com'
const PASSWORD = 'Change@Me123'        // change this before running!
// ────────────────────────────────────────────────────────────────────────────

const hash = await bcrypt.hash(PASSWORD, 10)

const result = await pool.query(
  `INSERT INTO users (usertype, name, mobileno, password_hash, email, division_code, is_active)
   VALUES ('super-admin', $1, $2, $3, $4, NULL, TRUE)
   ON CONFLICT (mobileno) DO NOTHING
   RETURNING id, name, mobileno, usertype`,
  [NAME, MOBILENO, hash, EMAIL]
)

if (result.rowCount === 0) {
  console.log(`⚠  Mobile ${MOBILENO} already exists — no changes made.`)
} else {
  const u = result.rows[0]
  console.log('Super-admin created successfully:')
  console.log(`  ID:       ${u.id}`)
  console.log(`  Name:     ${u.name}`)
  console.log(`  Mobile:   ${u.mobileno}`)
  console.log(`  Usertype: ${u.usertype}`)
  console.log(`  Password: ${PASSWORD}`)
}

await pool.end()
