import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import pool from '../db/pool.js'
import { sendOTPEmail } from '../services/emailService.js'
import { sendOtpSms } from '../services/smsService.js'
import { OTP_EXPIRY_MINUTES } from '../config/mailConfig.js'
import { JWT_SECRET, signUserToken } from '../config/jwt.js'
import { recordLogin } from '../utils/loginHistory.js'
import { validatePasswordStrength } from '../utils/passwordPolicy.js'
import { getDivisionRules } from '../config/divisionRules.js'

const router = Router()

const SALT_ROUNDS = 10
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// Customer-type accounts (as opposed to tm/rm/zsm/nsm, which also log in via
// OTP) can be individually blocked from logging in per division — see the
// Division Rules "Allow Customer Login" section — independent of whether
// that customer type may be newly registered (allowedCustomerTypes).
const CUSTOMER_LOGIN_TYPES = ['patient', 'doctor', 'doctor-pharmacy', 'hospital']
async function isCustomerLoginAllowed(usertype, divisionCode) {
  if (!CUSTOMER_LOGIN_TYPES.includes(usertype)) return true
  const rules = await getDivisionRules(divisionCode)
  return rules.allowedLoginCustomerTypes.includes(usertype)
}

// POST /auth/otp/request  — generate a random OTP, persist with expiry, email it
router.post('/otp/request', async (req, res, next) => {
  try {
    const { mobileno } = req.body
    if (!mobileno) return res.status(400).json({ error: 'mobileno required' })

    const OTP_TYPES = ['patient','doctor','doctor-pharmacy','hospital','tm','rm','zsm','nsm']
    const { rows } = await pool.query(
      `SELECT id, name, usertype, email, division_code FROM users
       WHERE mobileno = $1 AND usertype = ANY($2) AND is_active = TRUE`,
      [mobileno, OTP_TYPES]
    )
    if (!rows.length) return res.status(404).json({ error: 'User not found' })

    const user = rows[0]

    if (!(await isCustomerLoginAllowed(user.usertype, user.division_code))) {
      void recordLogin({
        userId: user.id, name: user.name, mobileno, usertype: user.usertype, divisionCode: user.division_code,
        loginMethod: 'otp', status: 'failed', failureReason: 'Customer login disabled for this account type',
      })
      return res.status(403).json({ error: 'Login is currently disabled for your account. Please contact your administrator.' })
    }

    const otp = generateOTP()
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    await pool.query(
      `UPDATE users SET otp = $1, otp_expires_at = $2 WHERE id = $3`,
      [otp, expiresAt, user.id]
    )

    void sendOTPEmail({ to: user.email, name: user.name, otp, expiryMinutes: OTP_EXPIRY_MINUTES })
    void sendOtpSms({ mobile: mobileno, otp, expiryMinutes: OTP_EXPIRY_MINUTES })

    res.json({ success: true, message: 'OTP sent', _devOtp: otp })
  } catch (err) { next(err) }
})

// POST /auth/otp/verify  — verify OTP and return session user
router.post('/otp/verify', async (req, res, next) => {
  try {
    const { mobileno, otp } = req.body
    if (!mobileno || !otp) return res.status(400).json({ error: 'mobileno and otp required' })

    const OTP_TYPES = ['patient','doctor','doctor-pharmacy','hospital','tm','rm','zsm','nsm']
    const { rows } = await pool.query(
      `SELECT id, usertype, name, mobileno, otp, otp_expires_at, division_code, sap_code, user_location, empcode FROM users
       WHERE mobileno = $1 AND usertype = ANY($2) AND is_active = TRUE`,
      [mobileno, OTP_TYPES]
    )
    if (!rows.length) {
      void recordLogin({ mobileno, loginMethod: 'otp', status: 'failed', failureReason: 'User not found' })
      return res.status(404).json({ error: 'User not found' })
    }

    const user = rows[0]

    if (!(await isCustomerLoginAllowed(user.usertype, user.division_code))) {
      void recordLogin({
        userId: user.id, name: user.name, mobileno, usertype: user.usertype, divisionCode: user.division_code,
        loginMethod: 'otp', status: 'failed', failureReason: 'Customer login disabled for this account type',
      })
      return res.status(403).json({ error: 'Login is currently disabled for your account. Please contact your administrator.' })
    }

    if (!user.otp || !user.otp_expires_at || new Date() > new Date(user.otp_expires_at)) {
      void recordLogin({
        userId: user.id, name: user.name, mobileno, usertype: user.usertype, divisionCode: user.division_code,
        loginMethod: 'otp', status: 'failed', failureReason: 'OTP expired',
      })
      return res.status(401).json({ error: 'OTP expired. Please request a new one.' })
    }

    if (user.otp !== otp) {
      void recordLogin({
        userId: user.id, name: user.name, mobileno, usertype: user.usertype, divisionCode: user.division_code,
        loginMethod: 'otp', status: 'failed', failureReason: 'Invalid OTP',
      })
      return res.status(401).json({ error: 'Invalid OTP' })
    }

    // Clear OTP after successful use so it cannot be replayed
    await pool.query(
      `UPDATE users SET otp = NULL, otp_expires_at = NULL WHERE id = $1`,
      [user.id]
    )

    // Self-service customer logins (doctor / doctor-pharmacy / hospital / patient) don't
    // carry their own division_code — fall back to their matching customer record's division
    let divisionCode = user.division_code
    if (!divisionCode) {
      const { rows: customerRows } = await pool.query(
        `SELECT division_code FROM customers WHERE mobile = $1 LIMIT 1`,
        [user.mobileno]
      )
      divisionCode = customerRows[0]?.division_code ?? null
    }

    void recordLogin({
      userId: user.id, name: user.name, mobileno, usertype: user.usertype, divisionCode,
      loginMethod: 'otp', status: 'success',
    })

    const userPayload = {
      id: user.id,
      name: user.name,
      usertype: user.usertype,
      mobileno: user.mobileno,
      divisionCode,
      sapCode: user.sap_code,
      userLocation: user.user_location,
      empcode: user.empcode,
    }
    res.json({ token: signUserToken(userPayload), user: userPayload })
  } catch (err) { next(err) }
})

// POST /auth/password  — password login (admin / super-admin / cfa / mm / dm / bu-head)
router.post('/password', async (req, res, next) => {
  try {
    const { mobileno, password } = req.body
    if (!mobileno || !password) return res.status(400).json({ error: 'mobileno and password required' })

    const PASSWORD_TYPES = ['admin','super-admin','scm-admin','cfa','mm','dm','bu-head']
    const { rows } = await pool.query(
      `SELECT id, usertype, name, mobileno, password_hash, division_code, sap_code, user_location, empcode, cfa_code,
              failed_attempts, locked_at, password_changed_at
       FROM users
       WHERE mobileno = $1 AND usertype = ANY($2) AND is_active = TRUE`,
      [mobileno, PASSWORD_TYPES]
    )
    if (!rows.length) {
      void recordLogin({ mobileno, loginMethod: 'password', status: 'failed', failureReason: 'User not found' })
      return res.status(404).json({ error: 'User not found' })
    }

    const user = rows[0]

    // Lockout check — before bcrypt to avoid timing oracle on locked accounts
    if (user.locked_at) {
      void recordLogin({
        userId: user.id, name: user.name, mobileno, usertype: user.usertype, divisionCode: user.division_code,
        loginMethod: 'password', status: 'failed', failureReason: 'Account locked',
      })
      return res.status(403).json({ error: 'Account locked. Contact your administrator to unlock.' })
    }

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) {
      const { rows: updRows } = await pool.query(
        `UPDATE users
         SET failed_attempts = failed_attempts + 1,
             locked_at = CASE WHEN failed_attempts + 1 >= 3 THEN NOW() ELSE NULL END
         WHERE id = $1
         RETURNING failed_attempts`,
        [user.id]
      )
      const newCount = updRows[0].failed_attempts
      void recordLogin({
        userId: user.id, name: user.name, mobileno, usertype: user.usertype, divisionCode: user.division_code,
        loginMethod: 'password', status: 'failed', failureReason: 'Invalid password',
      })
      if (newCount >= 3) {
        return res.status(403).json({ error: 'Account locked after 3 failed attempts. Contact your administrator.' })
      }
      return res.status(401).json({ error: `Invalid password. ${3 - newCount} attempt(s) remaining before lockout.` })
    }

    // admin/bu-head are division-specific — an account with no division assigned is
    // mis-provisioned and must not be allowed to log in.
    if ((user.usertype === 'admin' || user.usertype === 'bu-head') && !user.division_code) {
      void recordLogin({
        userId: user.id, name: user.name, mobileno, usertype: user.usertype,
        loginMethod: 'password', status: 'failed', failureReason: 'No division assigned',
      })
      return res.status(403).json({ error: 'This account has no division assigned — contact your administrator.' })
    }

    // Reset failed-attempt counter on successful password match
    await pool.query(
      `UPDATE users SET failed_attempts = 0, locked_at = NULL WHERE id = $1`,
      [user.id]
    )

    void recordLogin({
      userId: user.id, name: user.name, mobileno, usertype: user.usertype, divisionCode: user.division_code,
      loginMethod: 'password', status: 'success',
    })

    // Password lifecycle — force change if never set by user or older than 3 months
    const mustChangePassword =
      !user.password_changed_at ||
      (Date.now() - new Date(user.password_changed_at).getTime() > THREE_MONTHS_MS)

    if (mustChangePassword) {
      const changeToken = jwt.sign(
        { sub: user.id, scope: 'change-password' },
        JWT_SECRET,
        { expiresIn: '15m' }
      )
      return res.json({ mustChangePassword: true, changeToken })
    }

    // Normal login — build and return JWT
    let cfaCodes = null
    if (user.usertype === 'dm' || user.usertype === 'mm') {
      const { rows: cfaRows } = await pool.query('SELECT cfa_code FROM user_cfa_access WHERE user_id = $1', [user.id])
      cfaCodes = cfaRows.map(r => r.cfa_code)
    }
    const cfaCode = user.usertype === 'cfa' ? user.cfa_code : null

    const userPayload = {
      id: user.id,
      name: user.name,
      usertype: user.usertype,
      mobileno: user.mobileno,
      divisionCode: user.division_code,
      sapCode: user.sap_code,
      userLocation: user.user_location,
      empcode: user.empcode,
      cfaCodes,
      cfaCode,
    }
    res.json({ token: signUserToken(userPayload), user: userPayload })
  } catch (err) { next(err) }
})

// POST /auth/change-password  — complete a forced password change (first login or expiry)
// Authenticated by a short-lived changeToken issued by POST /auth/password, not a full JWT.
router.post('/change-password', async (req, res, next) => {
  try {
    const { changeToken, newPassword } = req.body
    if (!changeToken || !newPassword) {
      return res.status(400).json({ error: 'changeToken and newPassword are required' })
    }

    let decoded
    try {
      decoded = jwt.verify(changeToken, JWT_SECRET)
    } catch {
      return res.status(401).json({ error: 'Session expired. Please log in again.' })
    }
    if (decoded.scope !== 'change-password') {
      return res.status(401).json({ error: 'Invalid token.' })
    }

    const strengthError = validatePasswordStrength(newPassword)
    if (strengthError) return res.status(400).json({ error: strengthError })

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)

    const { rows } = await pool.query(
      `UPDATE users
       SET password_hash = $1, password_changed_at = NOW(), failed_attempts = 0, locked_at = NULL
       WHERE id = $2 AND is_active = TRUE
       RETURNING id, usertype, name, mobileno, division_code, sap_code, user_location, empcode, cfa_code`,
      [passwordHash, decoded.sub]
    )
    if (!rows.length) return res.status(404).json({ error: 'User not found' })

    const user = rows[0]
    let cfaCodes = null
    if (user.usertype === 'dm' || user.usertype === 'mm') {
      const { rows: cfaRows } = await pool.query('SELECT cfa_code FROM user_cfa_access WHERE user_id = $1', [user.id])
      cfaCodes = cfaRows.map(r => r.cfa_code)
    }
    const cfaCode = user.usertype === 'cfa' ? user.cfa_code : null

    const userPayload = {
      id: user.id,
      name: user.name,
      usertype: user.usertype,
      mobileno: user.mobileno,
      divisionCode: user.division_code,
      sapCode: user.sap_code,
      userLocation: user.user_location,
      empcode: user.empcode,
      cfaCodes,
      cfaCode,
    }
    res.json({ token: signUserToken(userPayload), user: userPayload })
  } catch (err) { next(err) }
})

// ── Forgot-password flow (staff password-login users only) ───────────────────

function maskEmail(email) {
  const [local, domain] = email.split('@')
  return `${local[0]}***@${domain}`
}

// POST /auth/forgot-password  — generate OTP and email it to the registered address
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { mobileno } = req.body
    if (!mobileno) return res.status(400).json({ error: 'mobileno required' })

    const PASSWORD_TYPES = ['admin','super-admin','scm-admin','cfa','mm','dm','bu-head']
    const { rows } = await pool.query(
      `SELECT id, name, email FROM users
       WHERE mobileno = $1 AND usertype = ANY($2) AND is_active = TRUE`,
      [mobileno, PASSWORD_TYPES]
    )
    if (!rows.length) {
      return res.status(404).json({ error: 'No account found for this mobile number.' })
    }

    const user = rows[0]
    if (!user.email) {
      return res.status(400).json({ error: 'No email address on file for this account. Contact your administrator.' })
    }

    const otp = generateOTP()
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
    await pool.query(
      `UPDATE users SET otp = $1, otp_expires_at = $2 WHERE id = $3`,
      [otp, expiresAt, user.id]
    )

    void sendOTPEmail({ to: user.email, name: user.name, otp, expiryMinutes: OTP_EXPIRY_MINUTES })

    res.json({ success: true, email: maskEmail(user.email) })
  } catch (err) { next(err) }
})

// POST /auth/forgot-password/verify  — verify OTP and return a changeToken
router.post('/forgot-password/verify', async (req, res, next) => {
  try {
    const { mobileno, otp } = req.body
    if (!mobileno || !otp) return res.status(400).json({ error: 'mobileno and otp required' })

    const PASSWORD_TYPES = ['admin','super-admin','scm-admin','cfa','mm','dm','bu-head']
    const { rows } = await pool.query(
      `SELECT id, otp, otp_expires_at FROM users
       WHERE mobileno = $1 AND usertype = ANY($2) AND is_active = TRUE`,
      [mobileno, PASSWORD_TYPES]
    )
    if (!rows.length) {
      return res.status(404).json({ error: 'No account found for this mobile number.' })
    }

    const user = rows[0]

    if (!user.otp || !user.otp_expires_at || new Date() > new Date(user.otp_expires_at)) {
      return res.status(401).json({ error: 'OTP expired. Please request a new one.' })
    }
    if (user.otp !== otp) {
      return res.status(401).json({ error: 'Invalid OTP.' })
    }

    await pool.query(
      `UPDATE users SET otp = NULL, otp_expires_at = NULL WHERE id = $1`,
      [user.id]
    )

    const changeToken = jwt.sign(
      { sub: user.id, scope: 'change-password' },
      JWT_SECRET,
      { expiresIn: '15m' }
    )
    res.json({ changeToken })
  } catch (err) { next(err) }
})

export default router
