import { Router } from 'express'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'

const router = Router()

// Division Rules is super-admin only — admin no longer has access.
router.use(authorize('super-admin'))

// GET /division-rules — all configured divisions
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM division_rules ORDER BY division_code`)
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /division-rules/:code
router.get('/:code', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM division_rules WHERE division_code = $1`, [req.params.code])
    if (!rows.length) return res.status(404).json({ error: 'Division rules not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

const ALL_CUSTOMER_TYPES = ['patient', 'doctor', 'doctor-pharmacy', 'hospital']

// POST /division-rules
router.post('/', async (req, res, next) => {
  try {
    const { division_code, order_workflow, customer_workflow, order_entry, documents, allowed_customer_types, allowed_login_customer_types } = req.body
    if (!division_code || !order_workflow || !customer_workflow || !order_entry || !documents) {
      return res.status(400).json({ error: 'division_code, order_workflow, customer_workflow, order_entry, and documents are required' })
    }
    const types = Array.isArray(allowed_customer_types) && allowed_customer_types.length > 0
      ? allowed_customer_types
      : ALL_CUSTOMER_TYPES
    // Unlike allowed_customer_types, an empty array here is a valid,
    // deliberate "block every customer type from logging in" — only missing
    // /non-array input falls back to "allow everyone".
    const loginTypes = Array.isArray(allowed_login_customer_types) ? allowed_login_customer_types : ALL_CUSTOMER_TYPES
    const { rows } = await pool.query(
      `INSERT INTO division_rules (division_code, order_workflow, customer_workflow, order_entry, documents, allowed_customer_types, allowed_login_customer_types)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [division_code, JSON.stringify(order_workflow), JSON.stringify(customer_workflow), JSON.stringify(order_entry), JSON.stringify(documents), types, loginTypes]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Division code ${req.body.division_code} already has rules configured` })
    next(err)
  }
})

// PATCH /division-rules/:code
router.patch('/:code', async (req, res, next) => {
  try {
    const { order_workflow, customer_workflow, order_entry, documents, allowed_customer_types, allowed_login_customer_types } = req.body
    if (!order_workflow || !customer_workflow || !order_entry || !documents) {
      return res.status(400).json({ error: 'order_workflow, customer_workflow, order_entry, and documents are required' })
    }
    const types = Array.isArray(allowed_customer_types) && allowed_customer_types.length > 0
      ? allowed_customer_types
      : ALL_CUSTOMER_TYPES
    const loginTypes = Array.isArray(allowed_login_customer_types) ? allowed_login_customer_types : ALL_CUSTOMER_TYPES
    const { rows } = await pool.query(
      `UPDATE division_rules SET
         order_workflow = $2, customer_workflow = $3, order_entry = $4, documents = $5,
         allowed_customer_types = $6, allowed_login_customer_types = $7, updated_at = NOW()
       WHERE division_code = $1 RETURNING *`,
      [req.params.code, JSON.stringify(order_workflow), JSON.stringify(customer_workflow), JSON.stringify(order_entry), JSON.stringify(documents), types, loginTypes]
    )
    if (!rows.length) return res.status(404).json({ error: 'Division rules not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// DELETE /division-rules/:code
router.delete('/:code', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`DELETE FROM division_rules WHERE division_code = $1 RETURNING division_code`, [req.params.code])
    if (!rows.length) return res.status(404).json({ error: 'Division rules not found' })
    res.json({ success: true, division_code: rows[0].division_code })
  } catch (err) { next(err) }
})

export default router
