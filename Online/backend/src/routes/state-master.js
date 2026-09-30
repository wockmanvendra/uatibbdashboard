import { Router } from 'express'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'

const router = Router()

// GET /state-master
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT state_code, state_name FROM state_master ORDER BY state_name')
    res.json(rows)
  } catch (err) { next(err) }
})

// POST /state-master  { state_code, state_name }
router.post('/', authorize('admin', 'bu-head'), async (req, res, next) => {
  try {
    const stateCode = req.body.state_code?.trim().toUpperCase()
    const stateName = req.body.state_name?.trim()
    if (!stateCode || !stateName) return res.status(400).json({ error: 'state_code and state_name are required' })
    const { rows } = await pool.query(
      `INSERT INTO state_master (state_code, state_name) VALUES ($1, $2) RETURNING *`,
      [stateCode, stateName]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'State code or name already exists' })
    next(err)
  }
})

export default router
