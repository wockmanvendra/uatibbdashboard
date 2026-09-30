import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

// GET /users/:id/hierarchy — resolve a TM's approval chain (RM/ZSM/NSM/MM/DM) with names
router.get('/:id/hierarchy', async (req, res, next) => {
  try {
    if (!['admin', 'super-admin'].includes(req.user.usertype) && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Not authorized to view this hierarchy' })
    }

    const { rows: u } = await pool.query('SELECT empcode FROM users WHERE id = $1', [req.params.id])
    if (!u.length || !u[0].empcode) return res.status(404).json({ error: 'Hierarchy not found' })

    const { rows } = await pool.query(
      `SELECT
         rm.id  AS rm_id,  v.rm_name  AS rm_name,  rm.usertype  AS rm_usertype,
         zsm.id AS zsm_id, v.zsm_name AS zsm_name, zsm.usertype AS zsm_usertype,
         nsm.id AS nsm_id, nsm.name   AS nsm_name, nsm.usertype AS nsm_usertype,
         mm.id  AS mm_id,  mm.name    AS mm_name,  mm.usertype  AS mm_usertype,
         dm.id  AS dm_id,  dm.name    AS dm_name,  dm.usertype  AS dm_usertype
       FROM vw_tm_hierarchy v
       LEFT JOIN users rm  ON rm.empcode  = v.rm_empcode
       LEFT JOIN users zsm ON zsm.empcode = v.zsm_empcode
       LEFT JOIN users nsm ON nsm.usertype = 'nsm' AND nsm.division_code = v.division_code
       LEFT JOIN users mm  ON mm.usertype  = 'mm'  AND mm.division_code  = v.division_code
       LEFT JOIN users dm  ON dm.usertype  = 'dm'  AND dm.division_code  = v.division_code
       WHERE v.tm_empcode = $1`,
      [u[0].empcode]
    )
    if (!rows.length) return res.status(404).json({ error: 'Hierarchy not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

export default router
