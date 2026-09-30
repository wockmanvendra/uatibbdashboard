import { Router } from 'express'
import crypto from 'crypto'
import pool from '../db/pool.js'
import {
  buildPaymentResponse,
  recordPaymentLinkToken,
  ORDER_WITH_BILLING_BY_ID_SQL,
  buildCustomerOutstandingPaymentResponse,
  recordCustomerOutstandingPaymentLinkToken,
  CUSTOMER_OUTSTANDING_BY_ID_SQL,
} from '../config/ccavenue.js'
import { ORDER_FINAL_CC_ROLES, CUSTOMER_FINAL_CC_ROLES } from '../services/approvalRecipients.js'
import { getScope } from '../utils/scope.js'

const router = Router()

// Pay Now (from /dashboard) lets the order's placer or any of the order-approval
// roles (rm/zsm/nsm/mm — dm never sees the order queue) trigger payment, not just
// the original placer — but only for orders within that approver's own
// hierarchy/division/cfa scope, not any order in the system.
async function canPayOrder(order, user) {
  if (order.placed_by === user.id) return true
  if (!ORDER_FINAL_CC_ROLES.includes(user.usertype)) return false
  return (await getScope(user, { subjectType: 'order' })).allows(order)
}

// Same idea for a customer's outstanding balance: the TM who registered the
// customer, or any of the customer-approval roles (rm/zsm/nsm/dm) within their
// own hierarchy/division/cfa scope.
async function canPayCustomerOutstanding(row, user) {
  if (row.registered_by === user.id) return true
  if (!CUSTOMER_FINAL_CC_ROLES.includes(user.usertype)) return false
  return (await getScope(user, { subjectType: 'customer' })).allows(row)
}

// POST /payment/initiate  { order_id }  — placer or an order approver redirects to CCAvenue
router.post('/initiate', async (req, res, next) => {
  try {
    const { order_id } = req.body
    const { rows } = await pool.query(ORDER_WITH_BILLING_BY_ID_SQL, [order_id])
    const order = rows[0]
    if (!order) return res.status(404).json({ error: 'Order not found' })
    if (!(await canPayOrder(order, req.user))) return res.status(403).json({ error: 'Not authorized for this order' })
    if (order.payment_status === 'Success') return res.status(400).json({ error: 'Order is already paid' })

    // Pay Now can retarget an order originally placed as pdc-delivery/post-dated-cheque —
    // only update payment_method when it doesn't already say 'online'.
    if (order.payment_method !== 'online') {
      await pool.query(`UPDATE orders SET payment_method = 'online' WHERE id = $1`, [order.id])
      order.payment_method = 'online'
    }

    res.json(await buildPaymentResponse(pool, order))
  } catch (err) { next(err) }
})

// POST /payment/create-link  { order_id }  — placer or an order approver generates a shareable link for the customer
router.post('/create-link', async (req, res, next) => {
  try {
    const { order_id } = req.body
    const { rows } = await pool.query(ORDER_WITH_BILLING_BY_ID_SQL, [order_id])
    const order = rows[0]
    if (!order) return res.status(404).json({ error: 'Order not found' })
    if (!(await canPayOrder(order, req.user))) return res.status(403).json({ error: 'Not authorized for this order' })
    if (order.payment_status === 'Success') return res.status(400).json({ error: 'Order is already paid' })

    if (order.payment_method !== 'payment-link') {
      await pool.query(`UPDATE orders SET payment_method = 'payment-link' WHERE id = $1`, [order.id])
      order.payment_method = 'payment-link'
    }

    let token = order.extra_data?.paymentLink?.token
    if (!token) {
      token = crypto.randomBytes(24).toString('hex')
      await recordPaymentLinkToken(pool, order.id, token)
    }

    res.json({
      orderId: order.id,
      amount: order.total_payable,
      paymentLink: `${process.env.FRONTEND_BASE_URL}/pay/${token}`,
    })
  } catch (err) { next(err) }
})

// POST /payment/initiate-customer  { customer_id }  — registrant or a customer
// approver redirects to CCAvenue to collect the full outstanding balance
router.post('/initiate-customer', async (req, res, next) => {
  try {
    const { customer_id } = req.body
    const { rows } = await pool.query(CUSTOMER_OUTSTANDING_BY_ID_SQL, [customer_id])
    const row = rows[0]
    if (!row) return res.status(404).json({ error: 'No outstanding balance found for this customer' })
    if (!(await canPayCustomerOutstanding(row, req.user))) return res.status(403).json({ error: 'Not authorized for this customer' })
    if (Number(row.outstanding_amount) <= 0) return res.status(400).json({ error: 'No outstanding balance to pay' })

    res.json(await buildCustomerOutstandingPaymentResponse(pool, row))
  } catch (err) { next(err) }
})

// POST /payment/create-link-customer  { customer_id }  — registrant or a customer
// approver generates a shareable link for the customer to settle their balance
router.post('/create-link-customer', async (req, res, next) => {
  try {
    const { customer_id } = req.body
    const { rows } = await pool.query(CUSTOMER_OUTSTANDING_BY_ID_SQL, [customer_id])
    const row = rows[0]
    if (!row) return res.status(404).json({ error: 'No outstanding balance found for this customer' })
    if (!(await canPayCustomerOutstanding(row, req.user))) return res.status(403).json({ error: 'Not authorized for this customer' })
    if (Number(row.outstanding_amount) <= 0) return res.status(400).json({ error: 'No outstanding balance to pay' })

    let token = row.extra_data?.paymentLink?.token
    if (!token) {
      token = crypto.randomBytes(24).toString('hex')
      await recordCustomerOutstandingPaymentLinkToken(pool, row.customerid, token)
    }

    res.json({
      orderId: row.customerid,
      amount: row.outstanding_amount,
      paymentLink: `${process.env.FRONTEND_BASE_URL}/pay/${token}`,
    })
  } catch (err) { next(err) }
})

export default router
