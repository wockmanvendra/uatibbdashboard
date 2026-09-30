import pool from '../db/pool.js'

// Records one row per login attempt (success or failure) for the admin-facing
// "Login History" panel. Never throws — a logging failure must not block or
// mask the actual authentication result.
export async function recordLogin({ userId, name, mobileno, usertype, loginMethod, status, failureReason, divisionCode }) {
  try {
    await pool.query(
      `INSERT INTO login_history (user_id, name, mobileno, usertype, login_method, status, failure_reason, division_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId ?? null, name ?? null, mobileno, usertype ?? null, loginMethod, status, failureReason ?? null, divisionCode ?? null]
    )
  } catch (e) {
    console.error('Failed to record login history:', e)
  }
}
