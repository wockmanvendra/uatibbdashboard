// ── Per-division CC email(s) + admin contact mobile ──────────────────────────
//
// Single source of truth, mirroring divisionRules.js: a division with no row
// in division_contacts falls back to {ccEmails: [], adminMobile: the global
// ADMIN_CONTACT_MOBILE env var}. Admins manage per-division overrides through
// the Division Contacts admin panel (backend/src/routes/division-contacts.js).
// Consumed by notifications.js (CC on every workflow/payment email) and
// app-config.js (the frontend's "contact administrator" mobile number).

import pool from '../db/pool.js'

const FALLBACK = { ccEmails: [], adminMobile: process.env.ADMIN_CONTACT_MOBILE || null }

export async function getDivisionContact(divisionCode) {
  if (!divisionCode) return FALLBACK
  const { rows } = await pool.query(
    `SELECT cc_emails, admin_mobile FROM division_contacts WHERE division_code = $1`,
    [divisionCode]
  )
  if (!rows.length) return FALLBACK
  return {
    ccEmails:    rows[0].cc_emails ?? [],
    adminMobile: rows[0].admin_mobile ?? FALLBACK.adminMobile,
  }
}
