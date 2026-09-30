import { Router } from 'express'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'

const router = Router()

const STAFF_USERTYPES = ['tm', 'rm', 'zsm', 'nsm', 'mm', 'dm', 'admin', 'cfa', 'bu-head']

// GET /bank-master
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT bank_name FROM bank_master ORDER BY bank_name')
    res.json(rows.map(r => r.bank_name))
  } catch (err) { next(err) }
})

// POST /bank-master  { bank_name }  — added ad hoc during cheque order entry
router.post('/', authorize(...STAFF_USERTYPES), async (req, res, next) => {
  try {
    const bankName = req.body.bank_name?.trim()
    if (!bankName) return res.status(400).json({ error: 'bank_name is required' })
    await pool.query('INSERT INTO bank_master (bank_name) VALUES ($1) ON CONFLICT DO NOTHING', [bankName])
    res.status(201).json({ bankName })
  } catch (err) { next(err) }
})

export default router
