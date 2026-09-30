import crypto from 'crypto'
import { notifyOrderPaymentOutcome, notifyCustomerOutstandingPaymentOutcome } from '../services/notifications.js'

const ALGORITHM = 'aes-128-cbc'

// CCAvenue's reference implementations use this fixed IV (bytes 0x00-0x0F),
// not an all-zero IV.
const IV = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
])

// CCAvenue's reference implementations derive the AES-128 key as the raw
// MD5 digest of the working key string, not a hex-decode of it.
function getKey(workingKey) {
  return crypto.createHash('md5').update(workingKey, 'utf8').digest()
}

export function encrypt(plainText, workingKey) {
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(workingKey), IV)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  return encrypted.toString('hex')
}

export function decrypt(encryptedHex, workingKey) {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(workingKey), IV)
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

export const VALID_ORDER_STATUSES = ['Success', 'Failure', 'Aborted']

let warnedMockMode = false

export function isMockMode() {
  const mock = process.env.MOCK_PAYMENT !== 'false'
  if (mock && !warnedMockMode) {
    console.warn('[ccavenue] MOCK_PAYMENT is on — CCAvenue payments are simulated, not real')
    warnedMockMode = true
  }
  return mock
}

export function getActionUrl() {
  return process.env.CCAVENUE_ENV === 'prod'
    ? process.env.CCAVENUE_PROD_URL
    : process.env.CCAVENUE_TEST_URL
}

// Built with plain concatenation, not URLSearchParams — this string is never
// transmitted as a literal URL (it's encrypted into an opaque blob), so it
// must NOT be percent-encoded.
export function parseCcavResponse(decrypted) {
  const result = {}
  decrypted.split('&').forEach((pair) => {
    const idx = pair.indexOf('=')
    if (idx === -1) return
    result[pair.slice(0, idx)] = pair.slice(idx + 1)
  })
  return result
}

// Appends one row per payment event (Initiated/Success/Failure/Aborted) to the
// full history table — orders.extra_data.ccavenue / customer_outstanding's
// equivalent only ever keep the latest outcome, this is the only place every
// attempt survives. Shared by both recordCcavenueOutcome and
// recordCustomerOutstandingOutcome below.
async function recordPaymentLogEntry(client, subjectType, subjectId, outcome) {
  await client.query(
    `INSERT INTO payment_log (subject_type, subject_id, status, payment_mode, tracking_id, bank_ref_no, failure_message, raw_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      subjectType, subjectId, outcome.status,
      outcome.paymentMode ?? null, outcome.trackingId ?? null, outcome.bankRefNo ?? null,
      outcome.failureMessage ?? null, outcome.rawResponse ? JSON.stringify(outcome.rawResponse) : null,
    ]
  )
}

// Single shared JSONB merge used by every place that records a CCAvenue
// outcome onto an order (initiate/link "Initiated" stamp, mock callback,
// live callback) — never clobbers other extra_data keys (e.g. order
// documents, chequeDetails). Also the single place that derives the
// authoritative payment_status column from an outcome.
export async function recordCcavenueOutcome(pool, orderId, outcome) {
  const paymentStatus = outcome.status === 'Success' ? 'Success' : 'Pending'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE orders
       SET extra_data = COALESCE(extra_data, '{}'::jsonb) || jsonb_build_object('ccavenue', $1::jsonb),
           payment_status = $3
       WHERE id = $2
       RETURNING id, extra_data, payment_status`,
      [JSON.stringify(outcome), orderId, paymentStatus]
    )
    if (rows[0]) await recordPaymentLogEntry(client, 'order', orderId, outcome)
    await client.query('COMMIT')
    if (rows[0] && outcome.status !== 'Initiated') {
      const { rows: [fullOrder] } = await pool.query(ORDER_WITH_BILLING_BY_ID_SQL, [orderId])
      if (fullOrder) void notifyOrderPaymentOutcome(fullOrder, outcome)
    }
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function recordPaymentLinkToken(pool, orderId, token) {
  const { rows } = await pool.query(
    `UPDATE orders
     SET extra_data = COALESCE(extra_data, '{}'::jsonb) || jsonb_build_object('paymentLink', $1::jsonb)
     WHERE id = $2
     RETURNING id, extra_data`,
    [JSON.stringify({ token, createdAt: new Date().toISOString() }), orderId]
  )
  return rows[0]
}

// Base SELECT for "an order plus its customer's billing fields" — callers
// append their own WHERE clause (by order id, or by payment-link token).
export const ORDER_WITH_BILLING_SELECT = `
  SELECT o.id, o.order_number, o.division_code, o.cfa_code,
         o.placed_by, o.total_payable, o.payment_method, o.payment_status, o.ordering_for_name, o.extra_data,
         c.email AS customer_email, c.mobile AS customer_mobile, c.address AS customer_address,
         c.city AS customer_city, c.state AS customer_state, c.pin_code AS customer_pin_code
  FROM orders o
  LEFT JOIN customers c ON c.id = o.ordering_for_id
`

export const ORDER_WITH_BILLING_BY_ID_SQL = `${ORDER_WITH_BILLING_SELECT} WHERE o.id = $1`
export const ORDER_WITH_BILLING_BY_LINK_TOKEN_SQL = `${ORDER_WITH_BILLING_SELECT} WHERE o.extra_data->'paymentLink'->>'token' = $1`

function buildMerchantData(order) {
  const fields = [
    `merchant_id=${process.env.CCAVENUE_MERCHANT_ID}`,
    `order_id=order:${order.order_number}`,
    `amount=${Number(order.total_payable).toFixed(2)}`,
    `currency=INR`,
    `redirect_url=${process.env.CCAVENUE_REDIRECT_URL}`,
    `cancel_url=${process.env.CCAVENUE_CANCEL_URL}`,
    `language=EN`,
    `billing_name=${order.ordering_for_name || ''}`,
    `billing_address=${order.customer_address || ''}`,
    `billing_city=${order.customer_city || ''}`,
    `billing_state=${order.customer_state || ''}`,
    `billing_zip=${order.customer_pin_code || ''}`,
    `billing_country=India`,
    `billing_email=${order.customer_email || ''}`,
    `billing_tel=${order.customer_mobile || ''}`,
  ]
  return fields.join('&')
}

// Shared by /initiate and /link/:token — both start a CCAvenue session for
// an order the caller is already authorized to act on.
export async function buildPaymentResponse(pool, order) {
  await recordCcavenueOutcome(pool, order.id, { status: 'Initiated' })

  if (isMockMode()) {
    return { mockMode: true, orderId: `order:${order.order_number}`, amount: order.total_payable }
  }

  const encRequest = encrypt(buildMerchantData(order), process.env.CCAVENUE_WORKING_KEY)
  return {
    actionUrl: getActionUrl(),
    fields: { encRequest, access_code: process.env.CCAVENUE_ACCESS_CODE },
  }
}

// ── Customer outstanding balance — same CCAvenue flow, keyed by customer id ──
// instead of order id. orders.id and customers.id are both opaque UUIDs of
// identical shape, so the shared callback/mock-callback below dispatch on an
// explicit "order:<uuid>" / "customer:<uuid>" composite reference (built here
// and in buildMerchantData/buildCustomerMerchantData below) rather than the
// bare id's shape — see parseSubjectRef in routes/ccavenue-callback.js.

export const CUSTOMER_OUTSTANDING_WITH_BILLING_SELECT = `
  SELECT co.customerid, co.outstanding_amount, co.extra_data, c.registered_by,
         c.customer_code, c.division_code, c.cfa_code,
         c.name AS customer_name, c.email AS customer_email, c.mobile AS customer_mobile,
         c.address AS customer_address, c.city AS customer_city, c.state AS customer_state,
         c.pin_code AS customer_pin_code
  FROM customer_outstanding co
  JOIN customers c ON c.id = co.customerid
`

export const CUSTOMER_OUTSTANDING_BY_ID_SQL = `${CUSTOMER_OUTSTANDING_WITH_BILLING_SELECT} WHERE co.customerid = $1`
export const CUSTOMER_OUTSTANDING_BY_LINK_TOKEN_SQL = `${CUSTOMER_OUTSTANDING_WITH_BILLING_SELECT} WHERE co.extra_data->'paymentLink'->>'token' = $1`

// Mirrors recordCcavenueOutcome, but there's no separate payment_status column
// here — a successful payment always collects the full current balance in one
// shot, so success simply zeroes outstanding_amount.
export async function recordCustomerOutstandingOutcome(pool, customerId, outcome) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Captured before the UPDATE below — success zeroes outstanding_amount, so this
    // is the only place the amount actually paid is still available for the email.
    const { rows: [before] } = await client.query(
      `SELECT outstanding_amount FROM customer_outstanding WHERE customerid = $1`,
      [customerId]
    )
    const { rows } = await client.query(
      `UPDATE customer_outstanding
       SET extra_data = COALESCE(extra_data, '{}'::jsonb) || jsonb_build_object('ccavenue', $1::jsonb),
           outstanding_amount = CASE WHEN $3 THEN 0 ELSE outstanding_amount END,
           outstanding_since = CASE WHEN $3 THEN NULL ELSE outstanding_since END
       WHERE customerid = $2
       RETURNING customerid, extra_data, outstanding_amount`,
      [JSON.stringify(outcome), customerId, outcome.status === 'Success']
    )
    if (rows[0]) await recordPaymentLogEntry(client, 'customer', customerId, outcome)
    await client.query('COMMIT')
    if (rows[0] && outcome.status !== 'Initiated') {
      const amountPaid = before?.outstanding_amount ?? rows[0].outstanding_amount
      const { rows: [fullRow] } = await pool.query(CUSTOMER_OUTSTANDING_BY_ID_SQL, [customerId])
      if (fullRow) void notifyCustomerOutstandingPaymentOutcome(fullRow, outcome, amountPaid)
    }
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function recordCustomerOutstandingPaymentLinkToken(pool, customerId, token) {
  const { rows } = await pool.query(
    `UPDATE customer_outstanding
     SET extra_data = COALESCE(extra_data, '{}'::jsonb) || jsonb_build_object('paymentLink', $1::jsonb)
     WHERE customerid = $2
     RETURNING customerid, extra_data`,
    [JSON.stringify({ token, createdAt: new Date().toISOString() }), customerId]
  )
  return rows[0]
}

function buildCustomerMerchantData(row) {
  const fields = [
    `merchant_id=${process.env.CCAVENUE_MERCHANT_ID}`,
    `order_id=customer:C_${row.customer_code}`,
    `amount=${Number(row.outstanding_amount).toFixed(2)}`,
    `currency=INR`,
    `redirect_url=${process.env.CCAVENUE_REDIRECT_URL}`,
    `cancel_url=${process.env.CCAVENUE_CANCEL_URL}`,
    `language=EN`,
    `billing_name=${row.customer_name || ''}`,
    `billing_address=${row.customer_address || ''}`,
    `billing_city=${row.customer_city || ''}`,
    `billing_state=${row.customer_state || ''}`,
    `billing_zip=${row.customer_pin_code || ''}`,
    `billing_country=India`,
    `billing_email=${row.customer_email || ''}`,
    `billing_tel=${row.customer_mobile || ''}`,
  ]
  return fields.join('&')
}

// Mirrors buildPaymentResponse. The JSON key stays "orderId" (holding the
// customer's id) so PaymentMockPage/PayLinkPage/ccavenueApi can stay generic.
export async function buildCustomerOutstandingPaymentResponse(pool, row) {
  await recordCustomerOutstandingOutcome(pool, row.customerid, { status: 'Initiated' })

  if (isMockMode()) {
    return { mockMode: true, orderId: `customer:C_${row.customer_code}`, amount: row.outstanding_amount }
  }

  const encRequest = encrypt(buildCustomerMerchantData(row), process.env.CCAVENUE_WORKING_KEY)
  return {
    actionUrl: getActionUrl(),
    fields: { encRequest, access_code: process.env.CCAVENUE_ACCESS_CODE },
  }
}
