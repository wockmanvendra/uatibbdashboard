import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'
import { validatePasswordStrength } from '../utils/passwordPolicy.js'
import { ADMIN_MANAGED_USERTYPES } from '../config/adminUsertypes.js'

const router = Router()

router.use(authorize('admin', 'bu-head', 'scm-admin', 'super-admin'))

const SALT_ROUNDS = 10
// super-admin is intentionally excluded — those accounts are provisioned
// directly in the database, not through this panel.
const ALLOWED_USERTYPES = ['mm', 'dm', 'cfa', 'admin', 'bu-head']
// cfa-type accounts are managed only by scm-admin/super-admin (CFA Records is
// scm-admin's whole reason for existing); admin/bu-head keep full write access
// to every other usertype here, and scm-admin is restricted to cfa only.
const CFA_ACCOUNT_MANAGERS = ['scm-admin', 'super-admin']

// Explicit column list for every SELECT below — `users` also carries
// otp/otp_expires_at/failed_attempts/locked_at/sap_code/user_location/
// created_at/password_hash, none of which this panel should ever return.
// empcode is aliased to emp_code to match the field name the frontend expects
// (transformAdminUserDetail in frontend/src/lib/api.js).
const SELECT_COLUMNS = `id, usertype, name, mobileno, email, empcode AS emp_code, division_code, cfa_code, infinity_division_id, is_active`

// GET /admin-user-details — list admin/cfa/mm/dm accounts; optional ?usertype=&division_code=&cfa_code=
router.get('/', async (req, res, next) => {
  try {
    const { usertype, division_code, cfa_code } = req.query
    const conditions = [`usertype = ANY($1)`]
    const params = [ADMIN_MANAGED_USERTYPES]
    if (usertype) { conditions.push(`usertype = $${params.length + 1}`); params.push(usertype) }
    if (division_code) { conditions.push(`division_code = $${params.length + 1}`); params.push(division_code) }
    if (cfa_code) { conditions.push(`cfa_code = $${params.length + 1}`); params.push(cfa_code) }

    // admin/bu-head are confined to their own division — cfa accounts are the
    // one exception, since they have no division_code of their own and are
    // legitimately browsed cross-division (e.g. the CFA records panel).
    if (req.user.usertype !== 'super-admin') {
      params.push(req.user.divisionCode ?? null)
      conditions.push(`(division_code = $${params.length} OR usertype = 'cfa')`)
    }

    const where = `WHERE ${conditions.join(' AND ')}`
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLUMNS},
              (SELECT COALESCE(ARRAY_AGG(cfa_code ORDER BY cfa_code), ARRAY[]::VARCHAR[])
               FROM user_cfa_access WHERE user_id = users.id) AS cfa_codes
       FROM users ${where} ORDER BY name`,
      params
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// POST /admin-user-details — create an admin/cfa/mm/dm login account
router.post('/', async (req, res, next) => {
  const { usertype, name, mobileno, email, emp_code, password, division_code, cfa_code, infinity_division_id, is_active, cfa_codes } = req.body
  if (!usertype || !name || !mobileno || !email || !password) {
    return res.status(400).json({ error: 'usertype, name, mobileno, email and password are required' })
  }
  // emp_code is a field-rep concept (links to vw_tm_hierarchy) — doesn't apply to cfa accounts.
  if (usertype !== 'cfa' && !emp_code) {
    return res.status(400).json({ error: 'emp_code is required for this usertype' })
  }
  if (!ALLOWED_USERTYPES.includes(usertype)) {
    return res.status(400).json({ error: `usertype must be one of ${ALLOWED_USERTYPES.join(', ')}` })
  }
  if (usertype === 'cfa' && !CFA_ACCOUNT_MANAGERS.includes(req.user.usertype)) {
    return res.status(403).json({ error: 'Only SCM Admin or Super Admin can manage CFA accounts.' })
  }
  if (req.user.usertype === 'scm-admin' && usertype !== 'cfa') {
    return res.status(403).json({ error: 'SCM Admin can only manage CFA accounts here.' })
  }
  // admin/bu-head are division-specific — an account with no division can't log in (see auth.js).
  if ((usertype === 'admin' || usertype === 'bu-head') && !division_code) {
    return res.status(400).json({ error: 'division_code is required for this usertype' })
  }
  // cfa accounts are scoped to exactly one CFA location (see auth.js / orders.js / customers.js).
  if (usertype === 'cfa' && !cfa_code) {
    return res.status(400).json({ error: 'cfa_code is required for this usertype' })
  }

  const strengthError = validatePasswordStrength(password)
  if (strengthError) return res.status(400).json({ error: strengthError })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const id = crypto.randomUUID()
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
    const active = is_active ?? true

    const { rows } = await client.query(
      `INSERT INTO users (id, usertype, name, mobileno, password_hash, division_code, cfa_code, email, infinity_division_id, is_active, empcode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${SELECT_COLUMNS}`,
      [id, usertype, name, mobileno, passwordHash, division_code ?? null, cfa_code ?? null, email ?? null, infinity_division_id ?? null, active, emp_code ?? null]
    )

    // CFA scoping only applies to dm/mm — silently ignored for other roles.
    const assignedCfaCodes = (usertype === 'dm' || usertype === 'mm') ? (cfa_codes ?? []) : []
    for (const cfaCode of assignedCfaCodes) {
      await client.query(
        `INSERT INTO user_cfa_access (user_id, cfa_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, cfaCode]
      )
    }

    await client.query('COMMIT')
    res.status(201).json({ ...rows[0], cfa_codes: assignedCfaCodes })
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return res.status(409).json({ error: `Mobile number ${mobileno} is already in use` })
    next(err)
  } finally {
    client.release()
  }
})

// PATCH /admin-user-details/:id — update an admin/cfa/mm/dm login account
router.patch('/:id', async (req, res, next) => {
  const { usertype, name, mobileno, email, emp_code, password, division_code, cfa_code, infinity_division_id, is_active, cfa_codes } = req.body
  if (usertype && !ALLOWED_USERTYPES.includes(usertype)) {
    return res.status(400).json({ error: `usertype must be one of ${ALLOWED_USERTYPES.join(', ')}` })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // admin is division-specific, cfa is location-specific — check the *effective*
    // post-update state (these fields use COALESCE below, so a partial PATCH must
    // not result in an admin account with no division, or a cfa account with no location).
    const { rows: existingRows } = await client.query(
      'SELECT usertype, division_code, cfa_code FROM users WHERE id = $1 AND usertype = ANY($2)',
      [req.params.id, ADMIN_MANAGED_USERTYPES]
    )
    if (!existingRows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Admin user not found' })
    }
    const effectiveUsertype = usertype ?? existingRows[0].usertype
    // Block admin/bu-head from touching a cfa account either side of a usertype
    // change (editing one in place, or converting a row into/out of cfa), and
    // block scm-admin from touching anything that isn't a cfa account.
    const touchesCfaAccount = existingRows[0].usertype === 'cfa' || effectiveUsertype === 'cfa'
    if (touchesCfaAccount && !CFA_ACCOUNT_MANAGERS.includes(req.user.usertype)) {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'Only SCM Admin or Super Admin can manage CFA accounts.' })
    }
    if (req.user.usertype === 'scm-admin' && effectiveUsertype !== 'cfa') {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'SCM Admin can only manage CFA accounts here.' })
    }
    const effectiveDivisionCode = division_code !== undefined ? division_code : existingRows[0].division_code
    if ((effectiveUsertype === 'admin' || effectiveUsertype === 'bu-head') && !effectiveDivisionCode) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'division_code is required for this usertype' })
    }
    const effectiveCfaCode = cfa_code !== undefined ? cfa_code : existingRows[0].cfa_code
    if (effectiveUsertype === 'cfa' && !effectiveCfaCode) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'cfa_code is required for this usertype' })
    }

    if (password) {
      const strengthError = validatePasswordStrength(password)
      if (strengthError) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: strengthError })
      }
    }
    const passwordHash = password ? await bcrypt.hash(password, SALT_ROUNDS) : null

    const { rows } = await client.query(
      `UPDATE users SET
         usertype             = COALESCE($2, usertype),
         name                 = COALESCE($3, name),
         mobileno             = COALESCE($4, mobileno),
         email                = COALESCE($5, email),
         password_hash        = COALESCE($6, password_hash),
         division_code        = COALESCE($7, division_code),
         cfa_code             = COALESCE($11, cfa_code),
         infinity_division_id = COALESCE($8, infinity_division_id),
         is_active            = COALESCE($9, is_active),
         empcode               = COALESCE($10, empcode),
         password_changed_at  = CASE WHEN $12 THEN NULL ELSE password_changed_at END
       WHERE id = $1 AND usertype = ANY($13)
       RETURNING ${SELECT_COLUMNS}`,
      [req.params.id, usertype, name, mobileno, email, passwordHash, division_code, infinity_division_id, is_active, emp_code, cfa_code, !!passwordHash, ADMIN_MANAGED_USERTYPES]
    )
    if (!rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Admin user not found' })
    }

    const merged = rows[0]

    // CFA scoping only applies to dm/mm. If the role changed away from those,
    // drop any assignments; otherwise replace the set only when cfa_codes was
    // actually sent (omitting it leaves existing assignments untouched).
    if (merged.usertype !== 'dm' && merged.usertype !== 'mm') {
      await client.query(`DELETE FROM user_cfa_access WHERE user_id = $1`, [req.params.id])
    } else if (cfa_codes !== undefined) {
      await client.query(`DELETE FROM user_cfa_access WHERE user_id = $1`, [req.params.id])
      for (const cfaCode of cfa_codes ?? []) {
        await client.query(
          `INSERT INTO user_cfa_access (user_id, cfa_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [req.params.id, cfaCode]
        )
      }
    }
    const { rows: cfaRows } = await client.query(`SELECT cfa_code FROM user_cfa_access WHERE user_id = $1 ORDER BY cfa_code`, [req.params.id])

    await client.query('COMMIT')
    res.json({ ...merged, cfa_codes: cfaRows.map(r => r.cfa_code) })
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return res.status(409).json({ error: `Mobile number ${mobileno} is already in use` })
    next(err)
  } finally {
    client.release()
  }
})

// DELETE /admin-user-details/:id — remove an admin/cfa/mm/dm login account
router.delete('/:id', async (req, res, next) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: existingRows } = await client.query(
      'SELECT usertype FROM users WHERE id = $1 AND usertype = ANY($2)',
      [req.params.id, ADMIN_MANAGED_USERTYPES]
    )
    if (!existingRows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Admin user not found' })
    }
    if (existingRows[0].usertype === 'cfa' && !CFA_ACCOUNT_MANAGERS.includes(req.user.usertype)) {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'Only SCM Admin or Super Admin can manage CFA accounts.' })
    }
    if (req.user.usertype === 'scm-admin' && existingRows[0].usertype !== 'cfa') {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'SCM Admin can only manage CFA accounts here.' })
    }

    const { rows } = await client.query(
      `DELETE FROM users WHERE id = $1 AND usertype = ANY($2) RETURNING id`,
      [req.params.id, ADMIN_MANAGED_USERTYPES]
    )
    if (!rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Admin user not found' })
    }

    await client.query('COMMIT')
    res.json({ success: true, id: rows[0].id })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

export default router
