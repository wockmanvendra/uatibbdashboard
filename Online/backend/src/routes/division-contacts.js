import { Router } from 'express'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'

const router = Router()

router.use(authorize('admin', 'bu-head', 'super-admin'))

// GET /division-contacts — all configured divisions (super-admin only; admin/bu-head
// are confined to their own division since they never manage more than one anyway)
router.get('/', async (req, res, next) => {
  try {
    if (req.user.usertype !== 'super-admin') {
      const { rows } = await pool.query(`SELECT * FROM division_contacts WHERE division_code = $1`, [req.user.divisionCode ?? null])
      return res.json(rows)
    }
    const { rows } = await pool.query(`SELECT * FROM division_contacts ORDER BY division_code`)
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /division-contacts/:code
router.get('/:code', async (req, res, next) => {
  try {
    if (req.user.usertype !== 'super-admin' && req.params.code !== req.user.divisionCode) {
      return res.status(403).json({ error: 'This division is outside your assignment.' })
    }
    const { rows } = await pool.query(`SELECT * FROM division_contacts WHERE division_code = $1`, [req.params.code])
    if (!rows.length) return res.status(404).json({ error: 'Division contact not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// POST /division-contacts  { division_code, cc_emails, admin_mobile }
router.post('/', async (req, res, next) => {
  try {
    const { division_code, cc_emails, admin_mobile } = req.body
    if (!division_code) return res.status(400).json({ error: 'division_code is required' })
    const { rows } = await pool.query(
      `INSERT INTO division_contacts (division_code, cc_emails, admin_mobile)
       VALUES ($1, $2, $3) RETURNING *`,
      [division_code, cc_emails ?? [], admin_mobile ?? null]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Division code ${req.body.division_code} already has contacts configured` })
    next(err)
  }
})

// PATCH /division-contacts/:code
router.patch('/:code', async (req, res, next) => {
  try {
    const { cc_emails, admin_mobile } = req.body
    const { rows } = await pool.query(
      `UPDATE division_contacts SET
         cc_emails    = COALESCE($2, cc_emails),
         admin_mobile = COALESCE($3, admin_mobile)
       WHERE division_code = $1 RETURNING *`,
      [req.params.code, cc_emails ?? null, admin_mobile ?? null]
    )
    if (!rows.length) return res.status(404).json({ error: 'Division contact not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// DELETE /division-contacts/:code
router.delete('/:code', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`DELETE FROM division_contacts WHERE division_code = $1 RETURNING division_code`, [req.params.code])
    if (!rows.length) return res.status(404).json({ error: 'Division contact not found' })
    res.json({ success: true, division_code: rows[0].division_code })
  } catch (err) { next(err) }
})

export default router
