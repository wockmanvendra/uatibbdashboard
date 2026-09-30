import { Router } from 'express'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'
import { sendTestEmail } from '../services/emailService.js'
import { sendOtpSms } from '../services/smsService.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const router = Router()

router.use(authorize('admin', 'super-admin', 'bu-head'))

// GET /admin/locked-users — list accounts that have been locked out
router.get('/locked-users', async (req, res, next) => {
  try {
    const { usertype: callerType, divisionCode: callerDivision } = req.user
    const isSuperAdmin = callerType === 'super-admin'

    const params = []
    let divisionFilter = ''
    if (!isSuperAdmin && callerDivision) {
      params.push(callerDivision)
      divisionFilter = `AND division_code = $${params.length}`
    }

    const { rows } = await pool.query(
      `SELECT id, name, mobileno, usertype, division_code, locked_at, failed_attempts
       FROM users
       WHERE locked_at IS NOT NULL AND is_active = TRUE ${divisionFilter}
       ORDER BY locked_at DESC`,
      params
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// POST /admin/unlock-user/:id — clear lockout for a specific user
router.post('/unlock-user/:id', async (req, res, next) => {
  try {
    const { usertype: callerType, divisionCode: callerDivision } = req.user
    const isSuperAdmin = callerType === 'super-admin'

    const { rows: [target] } = await pool.query('SELECT division_code FROM users WHERE id = $1', [req.params.id])
    if (!target) return res.status(404).json({ error: 'User not found' })
    if (!isSuperAdmin && callerDivision && target.division_code !== callerDivision) {
      return res.status(403).json({ error: 'This user belongs to a division outside your assignment.' })
    }

    const { rows } = await pool.query(
      `UPDATE users SET failed_attempts = 0, locked_at = NULL WHERE id = $1 RETURNING id, name`,
      [req.params.id]
    )
    res.json({ success: true, ...rows[0] })
  } catch (err) { next(err) }
})

// GET /admin/overview — summary counts + top-5 products/customers for the admin home page
router.get('/overview', async (req, res, next) => {
  try {
    const { months: monthsParam, month } = req.query
    // admin/bu-head are always confined to their own division regardless of
    // what the client asks for — only super-admin (no division of its own) can
    // choose one via the query param.
    const division_code = req.user.usertype === 'super-admin' ? req.query.division_code : req.user.divisionCode
    if (!division_code) return res.status(400).json({ error: 'division_code is required' })

    // Support 'months' (comma-separated multi-select) and legacy 'month' (single)
    const selectedMonths = monthsParam
      ? monthsParam.split(',').filter(Boolean)
      : month ? [month] : []

    let monthClause = ''
    let params = [division_code]
    if (selectedMonths.length > 0) {
      const placeholders = selectedMonths.map((_, i) => `$${i + 2}::date`).join(', ')
      monthClause = `AND DATE_TRUNC('month', $PLACED_AT$) IN (${placeholders})`
      params = [division_code, ...selectedMonths.map(m => `${m}-01`)]
    }

    const [orderRows, customerRows, productRows, customerTopRows] = await Promise.all([
      // Order counts + values grouped by approval_status
      pool.query(
        `SELECT approval_status, COUNT(*)::int AS count, COALESCE(SUM(total_payable), 0)::numeric AS total_value
         FROM orders
         WHERE division_code = $1 ${monthClause.replace('$PLACED_AT$', 'placed_at')}
         GROUP BY approval_status`,
        params
      ),
      // Customer counts grouped by approval_status
      pool.query(
        `SELECT approval_status, COUNT(*)::int AS count
         FROM customers
         WHERE division_code = $1 ${monthClause.replace('$PLACED_AT$', 'registered_at')}
         GROUP BY approval_status`,
        params
      ),
      // Top 5 products by total order value (exclude rejected orders)
      pool.query(
        `SELECT oi.product_name,
                oi.material_code,
                SUM(oi.line_total)::numeric          AS total_value,
                SUM(oi.quantity + oi.free_qty)::int  AS total_qty,
                COUNT(DISTINCT oi.order_id)::int     AS order_count
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.division_code = $1
           AND o.approval_status != 'rejected'
           ${monthClause.replace('$PLACED_AT$', 'o.placed_at')}
         GROUP BY oi.product_name, oi.material_code
         ORDER BY total_value DESC
         LIMIT 5`,
        params
      ),
      // Top 5 customers by total order value (exclude rejected orders)
      pool.query(
        `SELECT o.ordering_for_name  AS customer_name,
                o.ordering_for_type  AS customer_type,
                SUM(o.total_payable)::numeric AS total_value,
                COUNT(*)::int                 AS order_count
         FROM orders o
         WHERE o.division_code = $1
           AND o.approval_status != 'rejected'
           AND o.ordering_for_name IS NOT NULL
           ${monthClause.replace('$PLACED_AT$', 'o.placed_at')}
         GROUP BY o.ordering_for_name, o.ordering_for_type
         ORDER BY total_value DESC
         LIMIT 5`,
        params
      ),
    ])

    // Aggregate order counts + values into a tidy object
    const orderCounts = { total: 0, pendingL1: 0, approvedL1: 0, approved: 0, rejected: 0,
                          totalValue: 0, pendingL1Value: 0, approvedL1Value: 0, approvedValue: 0, rejectedValue: 0 }
    for (const row of orderRows.rows) {
      const v = Number(row.total_value)
      orderCounts.total      += row.count
      orderCounts.totalValue += v
      if (row.approval_status === 'pending-l1')  { orderCounts.pendingL1  = row.count; orderCounts.pendingL1Value  = v }
      if (row.approval_status === 'approved-l1') { orderCounts.approvedL1 = row.count; orderCounts.approvedL1Value = v }
      if (row.approval_status === 'approved')    { orderCounts.approved   = row.count; orderCounts.approvedValue   = v }
      if (row.approval_status === 'rejected')    { orderCounts.rejected   = row.count; orderCounts.rejectedValue   = v }
    }

    // Aggregate customer counts
    const customerCounts = { total: 0, pendingL1: 0, approvedL1: 0, approved: 0, rejected: 0 }
    for (const row of customerRows.rows) {
      customerCounts.total += row.count
      if (row.approval_status === 'pending-l1')  customerCounts.pendingL1  = row.count
      if (row.approval_status === 'approved-l1') customerCounts.approvedL1 = row.count
      if (row.approval_status === 'approved')    customerCounts.approved   = row.count
      if (row.approval_status === 'rejected')    customerCounts.rejected   = row.count
    }

    res.json({
      orders:       orderCounts,
      customers:    customerCounts,
      topProducts:  productRows.rows.map(r => ({
        productName:  r.product_name,
        materialCode: r.material_code,
        totalValue:   r.total_value,
        totalQty:     r.total_qty,
        orderCount:   r.order_count,
      })),
      topCustomers: customerTopRows.rows.map(r => ({
        customerName: r.customer_name,
        customerType: r.customer_type,
        totalValue:   r.total_value,
        orderCount:   r.order_count,
      })),
    })
  } catch (err) { next(err) }
})

// POST /admin/test-email — send a test email and return the outcome
router.post('/test-email', async (req, res, next) => {
  try {
    const { to } = req.body
    if (!to || !EMAIL_RE.test(to.trim())) {
      return res.status(400).json({ error: 'A valid email address is required.' })
    }
    const sentAt = new Date().toISOString()
    const result = await sendTestEmail({ to: to.trim(), sentBy: req.user.name })
    res.json({
      success:    result.success,
      to:         to.trim(),
      sentAt,
      previewUrl: result.previewUrl ?? null,
      error:      result.error ?? null,
    })
  } catch (err) { next(err) }
})

// POST /admin/test-sms — send a test OTP SMS and return the outcome
router.post('/test-sms', async (req, res, next) => {
  try {
    const { to } = req.body
    if (!to) return res.status(400).json({ error: 'A mobile number is required.' })
    const sentAt = new Date().toISOString()
    const result = await sendOtpSms({ mobile: to.trim(), otp: '123456', expiryMinutes: 10 })
    res.json({
      success:  result.success,
      to:       to.trim(),
      sentAt,
      response: result.response ?? null,
      error:    result.error   ?? result.reason ?? null,
    })
  } catch (err) { next(err) }
})

export default router
