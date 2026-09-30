import { Router } from 'express'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'

const router = Router()

// GET /cfa-locations — any authenticated user (registration, ordering, admin)
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT cfa_code, cfa_name, mobile, email FROM cfa_locations ORDER BY cfa_name'
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// POST /cfa-locations — scm-admin / super-admin only (admin/bu-head are view-only)
router.post('/', authorize('scm-admin', 'super-admin'), async (req, res, next) => {
  try {
    const { cfa_code, cfa_name, mobile, email } = req.body
    if (!cfa_code?.trim() || !cfa_name?.trim()) {
      return res.status(400).json({ error: 'cfa_code and cfa_name are required' })
    }
    const { rows } = await pool.query(
      `INSERT INTO cfa_locations (cfa_code, cfa_name, mobile, email)
       VALUES ($1, $2, $3, $4)
       RETURNING cfa_code, cfa_name, mobile, email`,
      [cfa_code.trim().toUpperCase(), cfa_name.trim(), mobile?.trim() || null, email?.trim() || null]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `CFA code "${req.body.cfa_code}" already exists.` })
    next(err)
  }
})

// PATCH /cfa-locations/:cfa_code — scm-admin / super-admin only (admin/bu-head are view-only)
router.patch('/:cfa_code', authorize('scm-admin', 'super-admin'), async (req, res, next) => {
  try {
    const { cfa_name, mobile, email } = req.body
    if (!cfa_name?.trim()) return res.status(400).json({ error: 'cfa_name is required' })
    const { rows } = await pool.query(
      `UPDATE cfa_locations
       SET cfa_name = $1, mobile = $2, email = $3
       WHERE cfa_code = $4
       RETURNING cfa_code, cfa_name, mobile, email`,
      [cfa_name.trim(), mobile?.trim() || null, email?.trim() || null, req.params.cfa_code]
    )
    if (!rows.length) return res.status(404).json({ error: 'CFA not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// DELETE /cfa-locations/:cfa_code — scm-admin / super-admin only (admin/bu-head are view-only)
router.delete('/:cfa_code', authorize('scm-admin', 'super-admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM cfa_locations WHERE cfa_code = $1 RETURNING cfa_code`,
      [req.params.cfa_code]
    )
    if (!rows.length) return res.status(404).json({ error: 'CFA not found' })
    res.json({ success: true, cfa_code: rows[0].cfa_code })
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'This CFA is referenced by customers, orders, or users and cannot be deleted.' })
    }
    next(err)
  }
})

export default router
