import { Router } from 'express'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'

const router = Router()

// GET /cfa-state-master  — admin: full list of state -> CFA mappings
router.get('/', authorize('admin', 'bu-head', 'scm-admin', 'super-admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT csm.id, csm.state_code, sm.state_name, csm.cfa_code, cl.cfa_name
       FROM cfa_state_master csm
       JOIN state_master sm   ON sm.state_code = csm.state_code
       JOIN cfa_locations cl  ON cl.cfa_code   = csm.cfa_code
       ORDER BY sm.state_name`
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /cfa-state-master/resolve?state=  — the CFA assigned to this state,
// for auto-filling the registration form's CFA field (customers never pick
// a CFA directly). state is matched by name, case-insensitively, against
// state_master.state_name.
router.get('/resolve', async (req, res, next) => {
  try {
    const { state } = req.query
    if (!state) return res.status(404).json({ error: 'No CFA mapping found' })
    const { rows } = await pool.query(
      `SELECT csm.cfa_code, cl.cfa_name
       FROM cfa_state_master csm
       JOIN state_master sm  ON sm.state_code = csm.state_code
       JOIN cfa_locations cl ON cl.cfa_code   = csm.cfa_code
       WHERE LOWER(sm.state_name) = LOWER($1)
       LIMIT 1`,
      [state]
    )
    if (!rows.length) return res.status(404).json({ error: 'No CFA mapping found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// POST /cfa-state-master  { state_code, cfa_code }  — write access is
// scm-admin/super-admin only — admin/bu-head are view-only here
router.post('/', authorize('scm-admin', 'super-admin'), async (req, res, next) => {
  try {
    const { state_code, cfa_code } = req.body
    if (!state_code || !cfa_code) {
      return res.status(400).json({ error: 'state_code and cfa_code are required' })
    }
    const { rows } = await pool.query(
      `INSERT INTO cfa_state_master (state_code, cfa_code) VALUES ($1, $2) RETURNING *`,
      [state_code, cfa_code]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This state already has a CFA mapped' })
    next(err)
  }
})

// PATCH /cfa-state-master/:id  { cfa_code }  — scm-admin/super-admin only
router.patch('/:id', authorize('scm-admin', 'super-admin'), async (req, res, next) => {
  try {
    const { cfa_code } = req.body
    if (!cfa_code) return res.status(400).json({ error: 'cfa_code is required' })
    const { rows } = await pool.query(
      `UPDATE cfa_state_master SET cfa_code = $1 WHERE id = $2 RETURNING *`,
      [cfa_code, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Mapping not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// DELETE /cfa-state-master/:id  — scm-admin/super-admin only
router.delete('/:id', authorize('scm-admin', 'super-admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`DELETE FROM cfa_state_master WHERE id = $1 RETURNING id`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Mapping not found' })
    res.json({ success: true })
  } catch (err) { next(err) }
})

export default router
