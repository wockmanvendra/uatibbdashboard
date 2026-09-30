import { Router } from 'express'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'

const router = Router()

// GET /overview/territories — RM sees each territory (TM) under them + their own row
router.get('/territories', authorize('rm'), async (req, res, next) => {
  try {
    const { empcode } = req.user
    if (!empcode) return res.json([])

    const { rows } = await pool.query(
      `WITH scope AS (
         SELECT DISTINCT tm_empcode, tm_name, tm_location, rm_empcode, rm_name, rm_location
         FROM vw_tm_hierarchy
         WHERE rm_empcode = $1
       ),
       tm_users AS (
         SELECT u.id AS user_id, s.tm_location AS emp_location, s.tm_name AS emp_name, false AS is_self
         FROM scope s
         JOIN users u ON u.empcode = s.tm_empcode
       ),
       rm_self AS (
         SELECT u.id AS user_id, s.rm_location AS emp_location, s.rm_name AS emp_name, true AS is_self
         FROM (SELECT DISTINCT rm_empcode, rm_name, rm_location FROM scope) s
         JOIN users u ON u.empcode = s.rm_empcode
       ),
       all_users AS (
         SELECT * FROM tm_users
         UNION ALL
         SELECT * FROM rm_self
       ),
       cust_agg AS (
         SELECT registered_by AS user_id, COUNT(*) AS customer_count
         FROM customers WHERE approval_status != 'rejected'
         GROUP BY registered_by
       ),
       order_agg AS (
         SELECT placed_by AS user_id, COUNT(*) AS order_count,
                COALESCE(SUM(total_payable), 0) AS order_value
         FROM orders WHERE approval_status != 'rejected'
         GROUP BY placed_by
       )
       SELECT
         au.emp_location                                    AS territory_name,
         au.emp_name                                        AS tm_name,
         au.is_self,
         COALESCE(SUM(ca.customer_count), 0)::int           AS customer_count,
         COALESCE(SUM(oa.order_count),    0)::int           AS order_count,
         COALESCE(SUM(oa.order_value),    0)::numeric       AS order_value
       FROM all_users au
       LEFT JOIN cust_agg  ca ON ca.user_id = au.user_id
       LEFT JOIN order_agg oa ON oa.user_id = au.user_id
       GROUP BY au.emp_location, au.emp_name, au.is_self
       ORDER BY order_value DESC`,
      [empcode]
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /overview/regions — ZSM sees each region (RM) under them
router.get('/regions', authorize('zsm'), async (req, res, next) => {
  try {
    const { empcode } = req.user
    if (!empcode) return res.json([])

    const { rows } = await pool.query(
      `WITH scope AS (
         SELECT DISTINCT tm_empcode, rm_empcode, rm_name, rm_location
         FROM vw_tm_hierarchy
         WHERE zsm_empcode = $1
       ),
       tm_users AS (
         SELECT u.id AS user_id, s.rm_empcode, s.rm_name, s.rm_location
         FROM scope s
         JOIN users u ON u.empcode = s.tm_empcode
       ),
       rm_users AS (
         SELECT u.id AS user_id, s.rm_empcode, s.rm_name, s.rm_location
         FROM (SELECT DISTINCT rm_empcode, rm_name, rm_location FROM scope) s
         JOIN users u ON u.empcode = s.rm_empcode
       ),
       all_users AS (
         SELECT * FROM tm_users
         UNION ALL
         SELECT * FROM rm_users
       ),
       cust_agg AS (
         SELECT registered_by AS user_id, COUNT(*) AS customer_count
         FROM customers WHERE approval_status != 'rejected'
         GROUP BY registered_by
       ),
       order_agg AS (
         SELECT placed_by AS user_id, COUNT(*) AS order_count,
                COALESCE(SUM(total_payable), 0) AS order_value
         FROM orders WHERE approval_status != 'rejected'
         GROUP BY placed_by
       )
       SELECT
         au.rm_location                                     AS region_name,
         au.rm_name,
         COALESCE(SUM(ca.customer_count), 0)::int           AS customer_count,
         COALESCE(SUM(oa.order_count),    0)::int           AS order_count,
         COALESCE(SUM(oa.order_value),    0)::numeric       AS order_value
       FROM all_users au
       LEFT JOIN cust_agg  ca ON ca.user_id = au.user_id
       LEFT JOIN order_agg oa ON oa.user_id = au.user_id
       GROUP BY au.rm_location, au.rm_name, au.rm_empcode
       ORDER BY order_value DESC`,
      [empcode]
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /overview/zones — admin/nsm/mm/dm see each zone (ZSM)
// NSM: filtered by nsm_empcode from JWT; admin/mm/dm: filtered by division_code query param (D2D format)
router.get('/zones', authorize('admin', 'super-admin', 'bu-head', 'nsm', 'mm', 'dm'), async (req, res, next) => {
  try {
    let rows
    // Only nsm's empcode links into vw_tm_hierarchy's nsm_empcode column —
    // admin/mm/dm also carry an empcode (their HR/SAP code, required at account
    // creation) that has no hierarchy meaning, so this must key off usertype,
    // not merely whether empcode is present.
    if (req.user.usertype === 'nsm') {
      const { empcode } = req.user
      // NSM path: use empcode to filter by nsm_empcode in the view
      ;({ rows } = await pool.query(
        `WITH scope AS (
           SELECT DISTINCT tm_empcode, rm_empcode, zsm_empcode, zsm_name, zsm_location
           FROM vw_tm_hierarchy
           WHERE nsm_empcode = $1
         ),
         tm_users AS (
           SELECT u.id AS user_id, s.zsm_empcode, s.zsm_name, s.zsm_location
           FROM scope s
           JOIN users u ON u.empcode = s.tm_empcode
         ),
         rm_users AS (
           SELECT u.id AS user_id, s.zsm_empcode, s.zsm_name, s.zsm_location
           FROM (SELECT DISTINCT rm_empcode, zsm_empcode, zsm_name, zsm_location FROM scope) s
           JOIN users u ON u.empcode = s.rm_empcode
         ),
         zsm_users AS (
           SELECT u.id AS user_id, s.zsm_empcode, s.zsm_name, s.zsm_location
           FROM (SELECT DISTINCT zsm_empcode, zsm_name, zsm_location FROM scope) s
           JOIN users u ON u.empcode = s.zsm_empcode
         ),
         all_users AS (
           SELECT * FROM tm_users
           UNION ALL
           SELECT * FROM rm_users
           UNION ALL
           SELECT * FROM zsm_users
         ),
         cust_agg AS (
           SELECT registered_by AS user_id, COUNT(*) AS customer_count
           FROM customers WHERE approval_status != 'rejected'
           GROUP BY registered_by
         ),
         order_agg AS (
           SELECT placed_by AS user_id, COUNT(*) AS order_count,
                  COALESCE(SUM(total_payable), 0) AS order_value
           FROM orders WHERE approval_status != 'rejected'
           GROUP BY placed_by
         )
         SELECT
           au.zsm_location                                      AS zone_name,
           au.zsm_name,
           COALESCE(SUM(ca.customer_count), 0)::int             AS customer_count,
           COALESCE(SUM(oa.order_count),    0)::int             AS order_count,
           COALESCE(SUM(oa.order_value),    0)::numeric         AS order_value
         FROM all_users au
         LEFT JOIN cust_agg  ca ON ca.user_id = au.user_id
         LEFT JOIN order_agg oa ON oa.user_id = au.user_id
         GROUP BY au.zsm_location, au.zsm_name, au.zsm_empcode
         ORDER BY order_value DESC`,
        [empcode]
      ))
    } else {
      // admin / mm / dm / bu-head path: resolve Infinity division_code via users.infinity_division_id,
      // falling back to the raw D2D division_code if not set. admin/bu-head/mm
      // are always confined to their own division; super-admin (no division of
      // its own) and dm (cross-division access) both choose one via the query
      // param instead.
      const division_code = ['super-admin', 'dm'].includes(req.user.usertype) ? req.query.division_code : req.user.divisionCode
      if (!division_code) return res.status(400).json({ error: 'division_code is required' })

      ;({ rows } = await pool.query(
        `WITH target_div AS (
           SELECT COALESCE(
             (SELECT infinity_division_id FROM users WHERE id = $2 LIMIT 1),
             $1
           ) AS division_code
         ),
         scope AS (
           SELECT DISTINCT h.tm_empcode, h.rm_empcode, h.zsm_empcode, h.zsm_name, h.zsm_location
           FROM vw_tm_hierarchy h, target_div
           WHERE h.division_code = target_div.division_code
         ),
         tm_users AS (
           SELECT u.id AS user_id, s.zsm_empcode, s.zsm_name, s.zsm_location
           FROM scope s
           JOIN users u ON u.empcode = s.tm_empcode
         ),
         rm_users AS (
           SELECT u.id AS user_id, s.zsm_empcode, s.zsm_name, s.zsm_location
           FROM (SELECT DISTINCT rm_empcode, zsm_empcode, zsm_name, zsm_location FROM scope) s
           JOIN users u ON u.empcode = s.rm_empcode
         ),
         zsm_users AS (
           SELECT u.id AS user_id, s.zsm_empcode, s.zsm_name, s.zsm_location
           FROM (SELECT DISTINCT zsm_empcode, zsm_name, zsm_location FROM scope) s
           JOIN users u ON u.empcode = s.zsm_empcode
         ),
         all_users AS (
           SELECT * FROM tm_users
           UNION ALL
           SELECT * FROM rm_users
           UNION ALL
           SELECT * FROM zsm_users
         ),
         cust_agg AS (
           SELECT registered_by AS user_id, COUNT(*) AS customer_count
           FROM customers WHERE approval_status != 'rejected'
           GROUP BY registered_by
         ),
         order_agg AS (
           SELECT placed_by AS user_id, COUNT(*) AS order_count,
                  COALESCE(SUM(total_payable), 0) AS order_value
           FROM orders WHERE approval_status != 'rejected'
           GROUP BY placed_by
         )
         SELECT
           au.zsm_location                                      AS zone_name,
           au.zsm_name,
           COALESCE(SUM(ca.customer_count), 0)::int             AS customer_count,
           COALESCE(SUM(oa.order_count),    0)::int             AS order_count,
           COALESCE(SUM(oa.order_value),    0)::numeric         AS order_value
         FROM all_users au
         LEFT JOIN cust_agg  ca ON ca.user_id = au.user_id
         LEFT JOIN order_agg oa ON oa.user_id = au.user_id
         GROUP BY au.zsm_location, au.zsm_name, au.zsm_empcode
         ORDER BY order_value DESC`,
        [division_code, req.user.id]
      ))
    }

    res.json(rows)
  } catch (err) { next(err) }
})

export default router
