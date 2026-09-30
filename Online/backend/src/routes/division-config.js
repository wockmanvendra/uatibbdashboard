import { Router } from 'express'
import pool from '../db/pool.js'
import { getDivisionRules } from '../config/divisionRules.js'

const router = Router()

// GET /divisions — list of all known divisions (code + display name), for
// the admin/super-admin division selector.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT division_code, division_name FROM division_mapping ORDER BY division_code'
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /divisions/:code/config — effective per-division business rules
// (approval workflows, order-entry rules, document requirements).
router.get('/:code/config', async (req, res, next) => {
  try {
    res.json(await getDivisionRules(req.params.code))
  } catch (err) { next(err) }
})

export default router
