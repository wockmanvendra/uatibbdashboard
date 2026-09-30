import { Router } from 'express'
import pool from '../db/pool.js'
import {
  decrypt,
  parseCcavResponse,
  isMockMode,
  buildPaymentResponse,
  recordCcavenueOutcome,
  VALID_ORDER_STATUSES,
  ORDER_WITH_BILLING_BY_LINK_TOKEN_SQL,
  buildCustomerOutstandingPaymentResponse,
  recordCustomerOutstandingOutcome,
  CUSTOMER_OUTSTANDING_BY_LINK_TOKEN_SQL,
} from '../config/ccavenue.js'

const router = Router()

// orders.order_number and customers.customer_code are both human-readable
// codes (not UUIDs — CCAvenue doesn't accept our UUIDs as order_id, see
// buildMerchantData/buildCustomerMerchantData in config/ccavenue.js), so the
// type can't be inferred from the bare code alone — buildMerchantData/
// buildCustomerMerchantData/buildPaymentResponse/
// buildCustomerOutstandingPaymentResponse (config/ccavenue.js) all build the
// "order_id" value sent to/echoed by CCAvenue as this composite reference.
function parseSubjectRef(subjectRef) {
  const idx = subjectRef.indexOf(':')
  if (idx === -1) throw new Error(`Malformed subject reference: ${subjectRef}`)
  return { type: subjectRef.slice(0, idx), id: subjectRef.slice(idx + 1) }
}

// Resolves the human-readable code (order_number / customer_code) back to
// the real UUID that recordCcavenueOutcome/recordCustomerOutstandingOutcome
// actually key their updates on (those are also called directly with real
// UUIDs elsewhere — the "Initiated" stamp in buildPaymentResponse/
// buildCustomerOutstandingPaymentResponse — so they stay UUID-keyed and this
// resolution happens only here, on the way back in from CCAvenue).
async function resolveSubjectId(pool, type, code) {
  const { rows } = type === 'order'
    ? await pool.query(`SELECT id FROM orders WHERE order_number = $1`, [code])
    // "C_" prefix (added in buildCustomerMerchantData/buildCustomerOutstandingPaymentResponse)
    // makes the code visually distinguishable from an order_number at a glance — strip it
    // back off before looking up the real customer_code.
    : await pool.query(`SELECT id FROM customers WHERE customer_code = $1`, [code.replace(/^C_/, '')])
  return rows[0]?.id ?? null
}

async function recordOutcomeForSubject(pool, subjectRef, outcome) {
  const { type, id: code } = parseSubjectRef(subjectRef)
  const id = await resolveSubjectId(pool, type, code)
  if (!id) return null
  return type === 'order'
    ? recordCcavenueOutcome(pool, id, outcome)
    : recordCustomerOutstandingOutcome(pool, id, outcome)
}

// GET /ccavenue/link/:token  — customer opens a shared payment link (no account in this app)
router.get('/link/:token', async (req, res, next) => {
  try {
    const { rows: orderRows } = await pool.query(ORDER_WITH_BILLING_BY_LINK_TOKEN_SQL, [req.params.token])
    const order = orderRows[0]
    if (order) {
      if (order.payment_status === 'Success') {
        return res.json({ alreadyPaid: true, orderId: order.id, amount: order.total_payable })
      }
      return res.json(await buildPaymentResponse(pool, order))
    }

    const { rows: outstandingRows } = await pool.query(CUSTOMER_OUTSTANDING_BY_LINK_TOKEN_SQL, [req.params.token])
    const row = outstandingRows[0]
    if (!row) return res.status(404).json({ error: 'This payment link is invalid or has expired.' })

    if (Number(row.outstanding_amount) <= 0) {
      return res.json({ alreadyPaid: true, orderId: row.customerid, amount: 0 })
    }

    res.json(await buildCustomerOutstandingPaymentResponse(pool, row))
  } catch (err) { next(err) }
})

// POST /ccavenue/mock-callback  { order_id, status }  — dev/test only, used by both the
// TM's online-payment mock path and the customer's payment-link mock path. No req.user is
// available in the customer case, so this is gated purely by isMockMode(), not ownership.
router.post('/mock-callback', async (req, res, next) => {
  try {
    if (!isMockMode()) return res.status(403).json({ error: 'Mock payments are disabled' })

    const { order_id, status } = req.body
    if (!VALID_ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'status must be Success, Failure, or Aborted' })
    }

    const { type } = parseSubjectRef(order_id)
    const updated = await recordOutcomeForSubject(pool, order_id, {
      status,
      trackingId: null,
      paymentMode: 'MOCK',
      bankRefNo: null,
      failureMessage: status === 'Success' ? null : 'Simulated failure',
      rawResponse: { mock: true, status },
    })
    if (!updated) return res.status(404).json({ error: 'Order not found' })

    // updated is the real UUID row (recordCcavenueOutcome/recordCustomerOutstandingOutcome
    // RETURNING id / customerid) — the frontend needs the real UUID here, not the
    // order_number/customer_code carried in order_id, since PaymentResultPage.jsx
    // feeds this straight into ordersApi.get(orderId).
    const id = type === 'order' ? updated.id : updated.customerid
    res.json({ orderId: id, type, status })
  } catch (err) { next(err) }
})

export async function handleLiveCallback(req, res, next) {
  const encResp = req.body?.encResp || req.query.encResp
  const frontendBase = process.env.FRONTEND_BASE_URL

  if (!encResp) {
    return res.redirect(302, `${frontendBase}/payment-result?status=failure&reason=missing_response`)
  }

  let decrypted
  try {
    decrypted = decrypt(encResp, process.env.CCAVENUE_WORKING_KEY)
  } catch {
    return res.redirect(302, `${frontendBase}/payment-result?status=failure&reason=decrypt_error`)
  }

  const parsed = parseCcavResponse(decrypted)
  const {
    order_id: orderId,
    tracking_id: trackingId,
    payment_mode: paymentMode,
    bank_ref_no: bankRefNo,
    failure_message: failureMessage,
  } = parsed
  const orderStatus = VALID_ORDER_STATUSES.includes(parsed.order_status) ? parsed.order_status : 'Failure'

  let type
  try {
    ({ type } = parseSubjectRef(orderId))
  } catch {
    return res.redirect(302, `${frontendBase}/payment-result?status=failure&reason=invalid_order_reference`)
  }

  let updated
  try {
    updated = await recordOutcomeForSubject(pool, orderId, {
      status: orderStatus,
      trackingId: trackingId || null,
      paymentMode: paymentMode || null,
      bankRefNo: bankRefNo || null,
      failureMessage: failureMessage || null,
      rawResponse: parsed,
    })
    if (!updated) {
      return res.redirect(302, `${frontendBase}/payment-result?status=failure&reason=order_not_found`)
    }
  } catch (err) {
    return next(err)
  }

  // updated is the real UUID row — the redirect target (PaymentResultPage.jsx)
  // needs the real UUID, not the order_number/customer_code carried in orderId,
  // since it feeds this straight into ordersApi.get(orderId).
  const bareId = type === 'order' ? updated.id : updated.customerid
  res.redirect(302, `${frontendBase}/payment-result?orderId=${bareId}&type=${type}&status=${orderStatus === 'Success' ? 'success' : 'failure'}`)
}

export default router
