import pool from '../db/pool.js'

export const STEP1_APPROVER_ROLES = ['rm', 'zsm', 'nsm']
export const CUSTOMER_FINAL_CC_ROLES = ['rm', 'zsm', 'nsm', 'dm']
export const ORDER_FINAL_CC_ROLES = ['rm', 'zsm', 'nsm', 'mm']

// Resolves the RM/ZSM/NSM/MM/DM chain for the user who submitted the
// customer/order via vw_tm_hierarchy (keyed by empcode): the submitter's own
// RM/ZSM plus the division-wide NSM/MM/DM. Falls back to any row for the
// division if the submitter has no empcode (legacy/seed users).
export async function getApprovers(userId, divisionCode, roles) {
  if (!divisionCode) return []

  let row = null
  if (userId) {
    const { rows } = await pool.query(
      `SELECT v.* FROM vw_tm_hierarchy v
       JOIN users u ON u.empcode = v.tm_empcode
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    )
    row = rows[0]
  }
  if (!row) {
    const { rows } = await pool.query('SELECT * FROM vw_tm_hierarchy WHERE division_code = $1 LIMIT 1', [divisionCode])
    row = rows[0]
  }
  if (!row) return []
  return roles
    .map(role => ({ role, name: row[`${role}_name`], email: row[`${role}_email_id`], mobile: row[`${role}_mobile_no`] }))
    .filter(a => a.email)
}

// Resolves mm/dm accounts actually permitted to act on a record with this
// division_code + cfa_code, via user_cfa_access — the same scope getScope()
// (backend/src/utils/scope.js) enforces for approve/reject authorization.
// Unlike getApprovers (which guesses one mm/dm per division off the Infinity
// hierarchy view), this reflects that a division can have several mm/dm
// accounts split by CFA assignment, and emails every one of them for this
// specific CFA rather than a single hierarchy-derived guess.
export async function getCfaScopedApprovers(divisionCode, cfaCode, usertype) {
  if (!divisionCode || !cfaCode) return []
  const { rows } = await pool.query(
    `SELECT u.name, u.email
     FROM users u
     JOIN user_cfa_access uca ON uca.user_id = u.id
     WHERE u.usertype = $1 AND u.division_code = $2 AND uca.cfa_code = $3 AND u.is_active = TRUE`,
    [usertype, divisionCode, cfaCode]
  )
  return rows.filter(r => r.email)
}

export async function getUserContact(userId) {
  if (!userId) return null
  const { rows } = await pool.query('SELECT name, email, mobileno AS mobile FROM users WHERE id = $1', [userId])
  return rows[0] ?? null
}

// CFA contact for payment-outcome CCs — null when the order/customer has no
// resolved cfa_code or the code has no matching cfa_locations row.
export async function getCfaEmail(cfaCode) {
  if (!cfaCode) return null
  const { rows } = await pool.query('SELECT email FROM cfa_locations WHERE cfa_code = $1', [cfaCode])
  return rows[0]?.email ?? null
}

// The customer an order was placed for — null when no email is on file.
export async function getCustomerEmail(customerId) {
  if (!customerId) return null
  const { rows } = await pool.query('SELECT email FROM customers WHERE id = $1', [customerId])
  return rows[0]?.email ?? null
}
