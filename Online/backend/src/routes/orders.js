import { Router } from 'express'
import ExcelJS from 'exceljs'
import { randomUUID } from 'crypto'
import pool from '../db/pool.js'
import { notifyOrderSubmitted, notifyOrderAwaitingFinalApproval, notifyOrderApproved, notifyOrderRejected } from '../services/notifications.js'
import { getDivisionRules } from '../config/divisionRules.js'
import { exportOrderCsv, buildOrderCsvContent } from '../utils/csvExport.js'
import { generateOrderNumber } from '../utils/orderNumber.js'
import { authorize } from '../middleware/auth.js'
import { uploadLimiter } from '../middleware/rateLimit.js'
import { excelUpload, cellToString, mapHeaderColumns, normalizeHeader } from '../utils/excelUpload.js'
import { resolveOrderRow, resolveOrderRows } from '../utils/resolveFileUrls.js'
import { isUuid } from '../utils/uuid.js'
import { getScope } from '../utils/scope.js'

const router = Router()

// Shared by PATCH /:id/dispatch and POST /dispatch/upload — true if dateStr (a plain
// "YYYY-MM-DD" value, from the <input type="date"> or normalized by cellToString) falls
// after today. A bare "YYYY-MM-DD" string always parses as UTC midnight (ISO 8601 rule),
// so "today" must be computed as UTC midnight too — comparing it against *local* midnight
// (setHours) would wrongly flag today's own date as "future" in any timezone ahead of UTC
// (e.g. IST, UTC+5:30).
function isFutureDate(dateStr) {
  const date = new Date(dateStr)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  return date > today
}

// True for any finite number > 0 — shared by the payment-confirmation routes below.
function isPositiveAmount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

// True if a plain "YYYY-MM-DD" cheque date falls within [today, today+30] in the
// server's local timezone — shared by validateOrderPayload (post-dated-cheque, at
// order placement) and PATCH /:id/cheque (pdc-delivery, captured by the CFA later).
function isChequeDateInRange(dateStr) {
  const localDateStr = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const today = new Date()
  const minDateStr = localDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate()))
  const maxDateStr = localDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30))
  return dateStr >= minDateStr && dateStr <= maxDateStr
}

// Builds a descriptive order_approvals.reason for a 'dispatch' action — embeds the
// actual values recorded in that call (not just free-text remarks) so the "View Log"
// shows what changed, not only that something changed. Shared by PATCH /:id/dispatch
// and POST /dispatch/upload, each of which only has a subset of these fields to offer.
function buildDispatchReason({ lr_number, lr_date, sap_order_number, pod_url, remarks }) {
  const parts = []
  if (lr_number) parts.push(`LR Number: ${lr_number}`)
  if (lr_date) parts.push(`LR Date: ${lr_date}`)
  if (sap_order_number) parts.push(`SAP Order Number: ${sap_order_number}`)
  if (pod_url) parts.push('POD uploaded')
  if (remarks) parts.push(remarks)
  return parts.join('; ') || null
}

// Shared by POST / and PUT /:id/resubmit — returns an error message, or null if valid.
function validateOrderPayload(rules, { total_payable, extra_data, payment_method, delivery_address, delivery_pin_code, delivery_city, delivery_state, customer_type }) {
  const { minOrderValue, minOrderValueByType, paymentOptions } = rules.orderEntry
  const effectiveMinOrderValue = (minOrderValueByType?.[customer_type] || 0) || (minOrderValue || 0)
  if (effectiveMinOrderValue > 0 && Number(total_payable) < effectiveMinOrderValue) {
    return `Order value must be at least ₹${effectiveMinOrderValue}`
  }
  if (!delivery_address || !delivery_pin_code || !delivery_city || !delivery_state) {
    return 'A delivery address is required'
  }
  const missingDoc = rules.documents.order.find(doc => doc.required && !extra_data?.[doc.key])
  if (missingDoc) return `${missingDoc.label} is required`
  if (paymentOptions.length > 0 && !paymentOptions.includes(payment_method)) {
    return 'A valid payment method is required'
  }
  if (payment_method === 'post-dated-cheque') {
    const cheque = extra_data?.chequeDetails
    if (!cheque?.bankName || !cheque?.chequeNumber || !cheque?.chequeDate) {
      return 'Bank name, cheque number, and cheque date are required for post-dated cheque payments'
    }
    if (!isChequeDateInRange(cheque.chequeDate)) {
      return 'Cheque date must be between today and 30 days from today'
    }
  }
  return null
}

// Shared by POST / and PUT /:id/resubmit — resolves the state NAME the client
// sends (the address form's <select> is sourced from state_master, so it's
// always an exact state_name) into a state_code, then the CFA that serves
// that state via cfa_state_master — same lookup customers.js uses.
async function resolveDeliveryStateAndCfa(stateName) {
  const { rows } = await pool.query('SELECT state_code FROM state_master WHERE LOWER(state_name) = LOWER($1)', [stateName])
  const stateCode = rows[0]?.state_code ?? null
  if (!stateCode) return { stateCode: null, cfaCode: null }
  const { rows: cfaRows } = await pool.query(
    'SELECT cfa_code FROM cfa_state_master WHERE state_code = $1',
    [stateCode]
  )
  return { stateCode, cfaCode: cfaRows[0]?.cfa_code ?? null }
}

// GET /orders  — list orders (optionally filter by placed_by, approval_status, division_code)
router.get('/', async (req, res, next) => {
  try {
    const { placed_by, approval_status, division_code } = req.query
    const conditions = []
    const params = []

    if (placed_by)        { conditions.push(`o.placed_by = $${params.length + 1}`); params.push(placed_by) }
    if (approval_status)  { conditions.push(`o.approval_status = $${params.length + 1}`); params.push(approval_status) }
    if (division_code)    { conditions.push(`o.division_code = $${params.length + 1}`); params.push(division_code) }

    // Hard, server-enforced access scope — hierarchy for tm/rm/zsm/nsm, division
    // (+cfa) for admin/bu-head/mm/dm, cfa_code for cfa, self-record for customer-
    // facing logins, global for super-admin. The filters above are additional
    // narrowing on top of this, never a substitute for it.
    const scope = await getScope(req.user, { subjectType: 'order' })
    const scopeSql = scope.whereSql('o', params)
    if (scopeSql) conditions.push(scopeSql)

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const { rows } = await pool.query(
      `SELECT o.*, cl.cfa_name, cust.customer_code AS ordering_for_code,
              COALESCE(JSON_AGG(oi ORDER BY oi.seq) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items,
              (SELECT reason FROM order_approvals oa WHERE oa.order_id = o.id AND oa.action = 'reject' ORDER BY oa.approved_at DESC LIMIT 1) AS rejection_reason,
              -- Final "approve" event's timestamp — the order's most recent
              -- approve action, which is when it flipped to approval_status
              -- 'approved' (there's an earlier L1 approve too; DESC LIMIT 1
              -- lands on the later one). Drives per-order outstanding aging
              -- on the frontend, not orders.placed_at.
              (SELECT approved_at FROM order_approvals oa WHERE oa.order_id = o.id AND oa.action = 'approve' ORDER BY oa.approved_at DESC LIMIT 1) AS approved_at
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN cfa_locations cl ON cl.cfa_code = o.cfa_code
       LEFT JOIN customers cust ON cust.id = o.ordering_for_id
       ${where}
       GROUP BY o.id, cl.cfa_name, cust.customer_code
       ORDER BY o.placed_at DESC`,
      params
    )
    res.json(await resolveOrderRows(rows))
  } catch (err) { next(err) }
})

// GET /orders/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, cl.cfa_name, cust.customer_code AS ordering_for_code,
              COALESCE(JSON_AGG(oi ORDER BY oi.seq) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items,
              (SELECT reason FROM order_approvals oa WHERE oa.order_id = o.id AND oa.action = 'reject' ORDER BY oa.approved_at DESC LIMIT 1) AS rejection_reason,
              -- Final "approve" event's timestamp — the order's most recent
              -- approve action, which is when it flipped to approval_status
              -- 'approved' (there's an earlier L1 approve too; DESC LIMIT 1
              -- lands on the later one). Drives per-order outstanding aging
              -- on the frontend, not orders.placed_at.
              (SELECT approved_at FROM order_approvals oa WHERE oa.order_id = o.id AND oa.action = 'approve' ORDER BY oa.approved_at DESC LIMIT 1) AS approved_at
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN cfa_locations cl ON cl.cfa_code = o.cfa_code
       LEFT JOIN customers cust ON cust.id = o.ordering_for_id
       WHERE o.id = $1
       GROUP BY o.id, cl.cfa_name, cust.customer_code`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Order not found' })
    const scope = await getScope(req.user, { subjectType: 'order' })
    if (!scope.allows(rows[0])) {
      return res.status(403).json({ error: 'Not authorized for this record.' })
    }
    res.json(await resolveOrderRow(rows[0]))
  } catch (err) { next(err) }
})

// GET /orders/:id/csv — admin/super-admin CSV download for a single order
router.get('/:id/csv', authorize('admin', 'super-admin'), async (req, res, next) => {
  try {
    const { rows: [order] } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id])
    if (!order) return res.status(404).json({ error: 'Order not found' })
    const { rows: items } = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY seq', [order.id])
    const filename = `Order_${order.division_code || 'NA'}_${order.order_number}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buildOrderCsvContent(order, items))
  } catch (err) { next(err) }
})

// GET /orders/:id/approvals — full approve/reject/resubmit history, oldest first
router.get('/:id/approvals', async (req, res, next) => {
  try {
    const { rows: [order] } = await pool.query(
      'SELECT division_code, placed_by, cfa_code, ordering_for_id, id FROM orders WHERE id = $1',
      [req.params.id]
    )
    if (!order) return res.status(404).json({ error: 'Order not found' })
    const scope = await getScope(req.user, { subjectType: 'order' })
    if (!scope.allows(order)) {
      return res.status(403).json({ error: 'Not authorized for this record.' })
    }

    const { rows } = await pool.query(
      `SELECT * FROM order_approvals WHERE order_id = $1 ORDER BY approved_at ASC`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /orders/:id/payment-log — full history of CCAvenue payment attempts, oldest first
router.get('/:id/payment-log', async (req, res, next) => {
  try {
    const { rows: [order] } = await pool.query(
      'SELECT division_code, placed_by, cfa_code, ordering_for_id, id FROM orders WHERE id = $1',
      [req.params.id]
    )
    if (!order) return res.status(404).json({ error: 'Order not found' })
    const scope = await getScope(req.user, { subjectType: 'order' })
    if (!scope.allows(order)) {
      return res.status(403).json({ error: 'Not authorized for this record.' })
    }

    const { rows } = await pool.query(
      `SELECT * FROM payment_log WHERE subject_type = 'order' AND subject_id = $1 ORDER BY recorded_at ASC`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /orders/dispatch/upload/template  — downloadable .xlsx with the expected
// headers + one example row, for the bulk LR-details upload below.
router.get('/dispatch/upload/template', authorize('cfa'), async (_req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('dispatch')
    sheet.addRow(['order_number', 'sap_order_number', 'lr_number', 'lr_date', 'remarks'])
    sheet.addRow(['DIV-GRO2026000123', 'SAP-998877', 'LR-456789', '2026-06-20', 'Dispatched via XYZ Transport'])
    sheet.getRow(1).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="cfa_dispatch_upload_template.xlsx"')
    res.send(Buffer.from(buffer))
  } catch (err) { next(err) }
})

// POST /orders/dispatch/upload  — Excel upload (multipart, field "file"), cfa-only.
// Expects columns order_number, sap_order_number, lr_number, lr_date, remarks (header
// matching is case/space-insensitive, first worksheet only). order_number is the ONLY
// lookup key — sap_order_number is stored as additional reference data, never used to
// find the order. lr_number and lr_date are mandatory per row (sap_order_number/remarks
// stay optional), and lr_date can't be in the future — rows failing any of those, or
// matching an order outside the uploading CFA's assignment, or not yet approved, are
// skipped with a reason, not silently dropped. Each successfully updated order's
// fulfillment `status` is marked 'Delivered'.
router.post('/dispatch/upload', authorize('cfa'), uploadLimiter, excelUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No valid Excel file received' })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(req.file.buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return res.status(400).json({ error: 'Excel file has no worksheet' })

    const columns = mapHeaderColumns(worksheet)
    const orderNumberCol = columns[normalizeHeader('order_number')]
    if (!orderNumberCol) {
      return res.status(400).json({ error: 'Excel must have an order_number column' })
    }
    const cellFor = (row, headerKey) => {
      const col = columns[normalizeHeader(headerKey)]
      return col ? cellToString(row.getCell(col).value) : ''
    }

    const dataRows = []
    worksheet.eachRow((row, rowNumber) => { if (rowNumber > 1) dataRows.push({ row, rowNumber }) })

    let count = 0
    const skippedRows = []
    for (const { row, rowNumber } of dataRows) {
      const order_number = cellFor(row, 'order_number')
      const sap_order_number = cellFor(row, 'sap_order_number') || null
      const lr_number = cellFor(row, 'lr_number') || null
      const lr_date_text = cellFor(row, 'lr_date')
      const remarks = cellFor(row, 'remarks') || null

      if (!order_number) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Missing order_number' })
        continue
      }
      if (!lr_number) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Missing lr_number' })
        continue
      }
      if (!lr_date_text) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Missing lr_date' })
        continue
      }
      const parsedLrDate = new Date(lr_date_text)
      if (Number.isNaN(parsedLrDate.getTime())) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Invalid lr_date' })
        continue
      }
      if (isFutureDate(lr_date_text)) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'lr_date cannot be in the future' })
        continue
      }
      const lr_date = lr_date_text

      const { rows: [order] } = await pool.query(
        `SELECT id, cfa_code, approval_status FROM orders WHERE order_number = $1`,
        [order_number]
      )
      if (!order) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Order not found' })
        continue
      }
      if (order.cfa_code !== req.user.cfaCode) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Not your CFA assignment' })
        continue
      }
      if (order.approval_status !== 'approved') {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Order is not approved yet' })
        continue
      }

      try {
        await pool.query('BEGIN')
        await pool.query(
          `UPDATE orders SET
             lr_number = $1, lr_date = $2,
             sap_order_number = COALESCE($3, sap_order_number),
             status = 'Delivered'
           WHERE id = $4`,
          [lr_number, lr_date, sap_order_number, order.id]
        )
        await pool.query(
          `INSERT INTO order_approvals (order_id, action, approved_by, approved_by_name, approver_usertype, reason)
           VALUES ($1, 'dispatch', $2, $3, $4, $5)`,
          [order.id, req.user.id, req.user.name, req.user.usertype,
           buildDispatchReason({ lr_number, lr_date, sap_order_number, remarks })]
        )
        await pool.query('COMMIT')
        count++
      } catch (err) {
        await pool.query('ROLLBACK')
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: err.message })
      }
    }

    res.json({ success: true, count, skipped: skippedRows.length, skippedRows })
  } catch (err) { next(err) }
})

// GET /orders/payment/upload/template  — downloadable .xlsx with the expected
// headers + one example row, for the bulk payment-confirmation upload below.
router.get('/payment/upload/template', authorize('cfa'), async (_req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('payment')
    sheet.addRow(['order_number', 'payment_received_date', 'payment_value'])
    sheet.addRow(['DIV-GRO2026000123', '2026-06-20', 35000])
    sheet.getRow(1).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="cfa_payment_upload_template.xlsx"')
    res.send(Buffer.from(buffer))
  } catch (err) { next(err) }
})

// POST /orders/payment/upload  — Excel upload (multipart, field "file"), cfa-only.
// Expects columns order_number, payment_received_date, payment_value (header matching
// is case/space-insensitive, first worksheet only). order_number is the sole lookup
// key; cfa_code/approval_status/payment_method are still checked below. Not available
// for payment_method = 'online' orders. Each successfully updated order's
// `payment_status` is marked 'Success'.
router.post('/payment/upload', authorize('cfa'), uploadLimiter, excelUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No valid Excel file received' })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(req.file.buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return res.status(400).json({ error: 'Excel file has no worksheet' })

    const columns = mapHeaderColumns(worksheet)
    const orderNumberCol = columns[normalizeHeader('order_number')]
    if (!orderNumberCol) {
      return res.status(400).json({ error: 'Excel must have an order_number column' })
    }
    const cellFor = (row, headerKey) => {
      const col = columns[normalizeHeader(headerKey)]
      return col ? cellToString(row.getCell(col).value) : ''
    }

    const dataRows = []
    worksheet.eachRow((row, rowNumber) => { if (rowNumber > 1) dataRows.push({ row, rowNumber }) })

    let count = 0
    const skippedRows = []
    for (const { row, rowNumber } of dataRows) {
      const order_number = cellFor(row, 'order_number')
      const payment_received_date = cellFor(row, 'payment_received_date')
      const payment_value_text = cellFor(row, 'payment_value')

      if (!order_number) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Missing order_number' })
        continue
      }
      if (!payment_received_date) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Missing payment_received_date' })
        continue
      }
      const parsedDate = new Date(payment_received_date)
      if (Number.isNaN(parsedDate.getTime())) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Invalid payment_received_date' })
        continue
      }
      if (isFutureDate(payment_received_date)) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'payment_received_date cannot be in the future' })
        continue
      }
      if (!isPositiveAmount(payment_value_text)) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Missing or invalid payment_value' })
        continue
      }
      const payment_value = Number(payment_value_text)

      const { rows: [order] } = await pool.query(
        `SELECT o.id, o.cfa_code, o.approval_status, o.payment_method
         FROM orders o
         WHERE o.order_number = $1`,
        [order_number]
      )
      if (!order) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Order not found' })
        continue
      }
      if (order.cfa_code !== req.user.cfaCode) {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Not your CFA assignment' })
        continue
      }
      if (order.approval_status !== 'approved') {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: 'Order is not approved yet' })
        continue
      }
      if (order.payment_method === 'online') {
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: "Online payments can't be confirmed here" })
        continue
      }

      try {
        await pool.query('BEGIN')
        await pool.query(
          `UPDATE orders SET
             payment_status = 'Success', payment_received_date = $1, payment_received_amount = $2
           WHERE id = $3`,
          [payment_received_date, payment_value, order.id]
        )
        await pool.query(
          `INSERT INTO order_approvals (order_id, action, approved_by, approved_by_name, approver_usertype, reason)
           VALUES ($1, 'payment-update', $2, $3, $4, $5)`,
          [order.id, req.user.id, req.user.name, req.user.usertype,
           `₹${payment_value.toFixed(2)} received on ${payment_received_date}`]
        )
        await pool.query('COMMIT')
        count++
      } catch (err) {
        await pool.query('ROLLBACK')
        skippedRows.push({ row: rowNumber, orderNumber: order_number, reason: err.message })
      }
    }

    res.json({ success: true, count, skipped: skippedRows.length, skippedRows })
  } catch (err) { next(err) }
})

// POST /orders  — place a new order
router.post('/', async (req, res, next) => {
  try {
    const {
      id: bodyId,
      ordering_for_id, ordering_for_name, ordering_for_type,
      division_code: bodyDivisionCode, items, total_units, total_payable, total_discount, extra_data, payment_method, remarks,
      delivery_address, delivery_pin_code, delivery_city, delivery_state,
    } = req.body

    // Client generates this ahead of the request when it already uploaded
    // documents for this not-yet-created order (see uploads.js entityId) —
    // falls back to a server-generated id for any caller that doesn't send one.
    const orderId = isUuid(bodyId) ? bodyId : randomUUID()

    const placed_by = req.user.id
    const placed_by_name = req.user.name
    const placed_by_usertype = req.user.usertype
    const division_code = req.user.divisionCode ?? bodyDivisionCode

    const rules = await getDivisionRules(division_code)
    const { paymentOptions } = rules.orderEntry
    const validationError = validateOrderPayload(rules, { total_payable, extra_data, payment_method, delivery_address, delivery_pin_code, delivery_city, delivery_state, customer_type: ordering_for_type })
    if (validationError) return res.status(400).json({ error: validationError })

    // Outstanding limit check — block if customer's unpaid balance exceeds the per-type limit
    const outstandingLimit = rules.orderEntry.outstandingLimitByType?.[ordering_for_type] || 0
    if (outstandingLimit > 0) {
      const { rows: [custBalance] } = await pool.query(
        `SELECT COALESCE(co.outstanding_amount, 0) AS sap_balance,
                COALESCE((
                  SELECT SUM(o2.total_payable) FROM orders o2
                  WHERE o2.ordering_for_id = $1
                    AND o2.payment_status = 'Pending'
                    AND o2.approval_status != 'rejected'
                ), 0) AS pending_orders_total
         FROM customers c
         LEFT JOIN customer_outstanding co ON co.customerid = c.id
         WHERE c.id = $1`,
        [ordering_for_id]
      )
      if (custBalance) {
        const totalOutstanding = Number(custBalance.sap_balance) + Number(custBalance.pending_orders_total)
        if (totalOutstanding > outstandingLimit) {
          return res.status(400).json({
            error: `Order blocked: this customer's outstanding balance (₹${totalOutstanding.toFixed(2)}) exceeds the allowed limit of ₹${outstandingLimit}.`,
          })
        }
      }
    }

    const { stateCode: delivery_state_code, cfaCode: cfa_code } = await resolveDeliveryStateAndCfa(delivery_state)
    if (!delivery_state_code) return res.status(400).json({ error: 'Unrecognized delivery state — please reselect the delivery address.' })

    await pool.query('BEGIN')
    const order_number = await generateOrderNumber(pool, division_code || 'NA')

    const { rows: [order] } = await pool.query(
      `INSERT INTO orders
         (id, order_number, placed_by, placed_by_name, placed_by_usertype,
          ordering_for_id, ordering_for_name, ordering_for_type, division_code,
          item_count, total_units, total_payable, total_discount, extra_data, payment_method,
          delivery_address, delivery_pin_code, delivery_city, delivery_state_code, cfa_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [orderId, order_number, placed_by, placed_by_name, placed_by_usertype,
       ordering_for_id, ordering_for_name, ordering_for_type, division_code || null,
       items.length, total_units, total_payable, total_discount,
       extra_data ? JSON.stringify(extra_data) : null,
       paymentOptions.length > 0 ? payment_method : null,
       delivery_address, delivery_pin_code, delivery_city, delivery_state_code, cfa_code]
    )
    const id = order.id

    for (const item of items) {
      await pool.query(
        `INSERT INTO order_items
           (order_id, product_id, product_name, material_code, quantity, free_qty, unit_price, scheme_label, discount_value, line_total)
         VALUES ($1,$2,$3,(SELECT material_code FROM products WHERE id = $10),$4,$5,$6,$7,$8,$9)`,
        [id, item.product_id, item.product_name, item.quantity,
         item.free_qty || 0, item.unit_price, item.scheme_label || null, item.discount_value || 0, item.line_total,
         item.product_id]
      )
    }

    await pool.query(
      `INSERT INTO order_approvals (order_id, action, approved_by, approved_by_name, approver_usertype, reason)
       VALUES ($1, 'place', $2, $3, $4, $5)`,
      [id, placed_by, placed_by_name, placed_by_usertype, remarks || null]
    )

    if (order.payment_method) {
      await pool.query(
        `INSERT INTO payment_log (subject_type, subject_id, status, payment_method) VALUES ('order', $1, 'Selected', $2)`,
        [id, order.payment_method]
      )
    }

    await pool.query('COMMIT')

    const { rows: [orderWithItems] } = await pool.query(
      `SELECT o.*,
              COALESCE(JSON_AGG(oi ORDER BY oi.seq) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1
       GROUP BY o.id`,
      [order.id]
    )
    void notifyOrderSubmitted(orderWithItems)
    res.status(201).json(await resolveOrderRow(orderWithItems))
  } catch (err) { await pool.query('ROLLBACK'); next(err) }
})

// PATCH /orders/:id/approve
router.patch('/:id/approve', async (req, res, next) => {
  try {
    const approved_by = req.user.id
    const approved_by_name = req.user.name

    const { rows: [order] } = await pool.query(
      `SELECT division_code, approval_status, placed_by, cfa_code FROM orders WHERE id = $1`,
      [req.params.id]
    )
    if (!order) return res.status(404).json({ error: 'Order not found' })

    const rules = await getDivisionRules(order.division_code)
    const step = rules.orderWorkflow.steps.find(s => s.fromStatus === order.approval_status)
    if (!step) return res.status(409).json({ error: 'Order is not awaiting approval' })
    if (!step.approverRoles.includes(req.user.usertype)) {
      return res.status(403).json({ error: 'Not authorized to approve this step' })
    }
    if (order.placed_by === req.user.id) {
      return res.status(403).json({ error: 'You cannot act on an order you placed yourself.' })
    }
    const scope = await getScope(req.user, { subjectType: 'order' })
    if (!scope.allows(order)) {
      return res.status(403).json({ error: 'This order is outside your assignment.' })
    }
    const next_status = step.toStatus

    await pool.query('BEGIN')
    const { rows } = await pool.query(
      `UPDATE orders SET approval_status = $1 WHERE id = $2 RETURNING *`,
      [next_status, req.params.id]
    )
    const { rows: [approval] } = await pool.query(
      `INSERT INTO order_approvals (order_id, action, approved_by, approved_by_name, approver_usertype)
       VALUES ($1, 'approve', $2, $3, $4)
       RETURNING approved_at`,
      [req.params.id, approved_by, approved_by_name, req.user.usertype]
    )
    await pool.query('COMMIT')
    if (next_status === 'approved') {
      void notifyOrderApproved(rows[0], approved_by_name, approval.approved_at)
      void exportOrderCsv(rows[0])
    } else if (next_status === 'approved-l1') {
      void notifyOrderAwaitingFinalApproval(rows[0], approved_by_name, approval.approved_at)
    }
    res.json(await resolveOrderRow(rows[0]))
  } catch (err) { await pool.query('ROLLBACK'); next(err) }
})

// PATCH /orders/:id/reject
router.patch('/:id/reject', async (req, res, next) => {
  try {
    const { reason } = req.body
    const approved_by = req.user.id
    const approved_by_name = req.user.name

    const { rows: [order] } = await pool.query(
      `SELECT division_code, approval_status, placed_by, cfa_code FROM orders WHERE id = $1`,
      [req.params.id]
    )
    if (!order) return res.status(404).json({ error: 'Order not found' })

    const rules = await getDivisionRules(order.division_code)
    const step = rules.orderWorkflow.steps.find(s => s.fromStatus === order.approval_status)
    if (!step) return res.status(409).json({ error: 'Order is not awaiting approval' })
    if (!step.approverRoles.includes(req.user.usertype)) {
      return res.status(403).json({ error: 'Not authorized to act on this step' })
    }
    if (order.placed_by === req.user.id) {
      return res.status(403).json({ error: 'You cannot act on an order you placed yourself.' })
    }
    const scope = await getScope(req.user, { subjectType: 'order' })
    if (!scope.allows(order)) {
      return res.status(403).json({ error: 'This order is outside your assignment.' })
    }

    await pool.query('BEGIN')
    const { rows } = await pool.query(
      `UPDATE orders SET approval_status = 'rejected' WHERE id = $1 RETURNING *`,
      [req.params.id]
    )
    const { rows: [rejection] } = await pool.query(
      `INSERT INTO order_approvals (order_id, action, approved_by, approved_by_name, reason, approver_usertype)
       VALUES ($1, 'reject', $2, $3, $4, $5)
       RETURNING approved_at`,
      [req.params.id, approved_by, approved_by_name, reason || null, req.user.usertype]
    )
    await pool.query('COMMIT')
    void notifyOrderRejected(rows[0], approved_by_name, rejection.approved_at, reason)
    res.json({ ...(await resolveOrderRow(rows[0])), rejection_reason: reason || null })
  } catch (err) { await pool.query('ROLLBACK'); next(err) }
})

// PATCH /orders/:id/dispatch — CFA records LR Number/LR Date/SAP order number/POD/
// remarks for a single order, once it has cleared both approval steps. lr_number and
// lr_date are required on every call (lr_date also can't be in the future);
// sap_order_number/pod/remarks stay optional. Any successful call here marks the
// order's fulfillment `status` as 'Delivered'.
router.patch('/:id/dispatch', authorize('cfa'), async (req, res, next) => {
  try {
    const { lr_number, lr_date, sap_order_number, pod_url, pod_original_name, remarks } = req.body
    if (!lr_number || !lr_date) {
      return res.status(400).json({ error: 'lr_number and lr_date are required' })
    }
    if (isFutureDate(lr_date)) {
      return res.status(400).json({ error: 'lr_date cannot be in the future' })
    }

    const { rows: [order] } = await pool.query(
      `SELECT cfa_code, approval_status FROM orders WHERE id = $1`,
      [req.params.id]
    )
    if (!order) return res.status(404).json({ error: 'Order not found' })
    if (order.cfa_code !== req.user.cfaCode) {
      return res.status(403).json({ error: 'This order belongs to a CFA outside your assignment.' })
    }
    if (order.approval_status !== 'approved') {
      return res.status(409).json({ error: 'Dispatch details can only be set on approved orders.' })
    }

    await pool.query('BEGIN')
    const { rows } = await pool.query(
      `UPDATE orders SET
         lr_number = $1, lr_date = $2,
         sap_order_number = COALESCE($3, sap_order_number),
         pod_url = COALESCE($4, pod_url), pod_original_name = COALESCE($5, pod_original_name),
         status = 'Delivered'
       WHERE id = $6
       RETURNING *`,
      [lr_number, lr_date, sap_order_number ?? null, pod_url ?? null, pod_original_name ?? null, req.params.id]
    )
    await pool.query(
      `INSERT INTO order_approvals (order_id, action, approved_by, approved_by_name, approver_usertype, reason)
       VALUES ($1, 'dispatch', $2, $3, $4, $5)`,
      [req.params.id, req.user.id, req.user.name, req.user.usertype,
       buildDispatchReason({ lr_number, lr_date, sap_order_number, pod_url, remarks })]
    )
    await pool.query('COMMIT')
    res.json(await resolveOrderRow(rows[0]))
  } catch (err) { await pool.query('ROLLBACK'); next(err) }
})

// PATCH /orders/:id/payment — CFA manually confirms payment was received on a single
// order, once it has cleared both approval steps. payment_received_date and
// payment_received_amount are both required (date also can't be in the future, amount
// must be positive) — editable repeatedly, each call logs its own 'payment-update' entry.
// Not available for payment_method = 'online' — those orders are settled automatically
// via the CCAvenue callback (see ccavenue-callback.js).
router.patch('/:id/payment', authorize('cfa'), async (req, res, next) => {
  try {
    const { payment_received_date, payment_received_amount } = req.body
    if (!payment_received_date || payment_received_amount == null) {
      return res.status(400).json({ error: 'payment_received_date and payment_received_amount are required' })
    }
    if (isFutureDate(payment_received_date)) {
      return res.status(400).json({ error: 'payment_received_date cannot be in the future' })
    }
    if (!isPositiveAmount(payment_received_amount)) {
      return res.status(400).json({ error: 'payment_received_amount must be a positive number' })
    }

    const { rows: [order] } = await pool.query(
      `SELECT cfa_code, approval_status, payment_method FROM orders WHERE id = $1`,
      [req.params.id]
    )
    if (!order) return res.status(404).json({ error: 'Order not found' })
    if (order.cfa_code !== req.user.cfaCode) {
      return res.status(403).json({ error: 'This order belongs to a CFA outside your assignment.' })
    }
    if (order.approval_status !== 'approved') {
      return res.status(409).json({ error: 'Payment can only be confirmed on approved orders.' })
    }
    if (order.payment_method === 'online') {
      return res.status(409).json({ error: 'Online payments are confirmed automatically and cannot be overridden here.' })
    }

    await pool.query('BEGIN')
    const { rows } = await pool.query(
      `UPDATE orders SET
         payment_status = 'Success', payment_received_date = $1, payment_received_amount = $2
       WHERE id = $3
       RETURNING *`,
      [payment_received_date, payment_received_amount, req.params.id]
    )
    await pool.query(
      `INSERT INTO order_approvals (order_id, action, approved_by, approved_by_name, approver_usertype, reason)
       VALUES ($1, 'payment-update', $2, $3, $4, $5)`,
      [req.params.id, req.user.id, req.user.name, req.user.usertype,
       `₹${Number(payment_received_amount).toFixed(2)} received on ${payment_received_date}`]
    )
    await pool.query('COMMIT')
    res.json(await resolveOrderRow(rows[0]))
  } catch (err) { await pool.query('ROLLBACK'); next(err) }
})

// PATCH /orders/:id/cheque — CFA records the bank/cheque-number/date/photo for a
// 'pdc-delivery' order once the customer hands over the physical cheque at delivery
// (unlike 'post-dated-cheque', where these are captured by the placer up front).
// bank_name/cheque_number/cheque_date are required on every call (cheque_date must
// be within [today, today+30]); cheque_photo_url/original_name are optional and, when
// omitted, keep whatever photo was already recorded — editable repeatedly, each call
// logs its own 'cheque-update' entry.
router.patch('/:id/cheque', authorize('cfa'), async (req, res, next) => {
  try {
    const { bank_name, cheque_number, cheque_date, cheque_photo_url, cheque_photo_original_name } = req.body
    if (!bank_name || !cheque_number || !cheque_date) {
      return res.status(400).json({ error: 'bank_name, cheque_number, and cheque_date are required' })
    }
    if (!isChequeDateInRange(cheque_date)) {
      return res.status(400).json({ error: 'cheque_date must be between today and 30 days from today' })
    }

    const { rows: [order] } = await pool.query(
      `SELECT cfa_code, approval_status, payment_method, extra_data FROM orders WHERE id = $1`,
      [req.params.id]
    )
    if (!order) return res.status(404).json({ error: 'Order not found' })
    if (order.cfa_code !== req.user.cfaCode) {
      return res.status(403).json({ error: 'This order belongs to a CFA outside your assignment.' })
    }
    if (order.approval_status !== 'approved') {
      return res.status(409).json({ error: 'Cheque details can only be captured on approved orders.' })
    }
    if (order.payment_method !== 'pdc-delivery') {
      return res.status(409).json({ error: 'Cheque details can only be captured for PDC on Delivery orders.' })
    }

    const existingPhoto = order.extra_data?.chequeDetails?.chequePhoto ?? null
    const chequeDetails = {
      bankName: bank_name,
      chequeNumber: cheque_number,
      chequeDate: cheque_date,
      chequePhoto: cheque_photo_url
        ? { url: cheque_photo_url, originalName: cheque_photo_original_name ?? null }
        : existingPhoto,
    }

    await pool.query('BEGIN')
    const { rows } = await pool.query(
      `UPDATE orders SET extra_data = COALESCE(extra_data, '{}'::jsonb) || jsonb_build_object('chequeDetails', $1::jsonb)
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(chequeDetails), req.params.id]
    )
    await pool.query(
      `INSERT INTO order_approvals (order_id, action, approved_by, approved_by_name, approver_usertype, reason)
       VALUES ($1, 'cheque-update', $2, $3, $4, $5)`,
      [req.params.id, req.user.id, req.user.name, req.user.usertype,
       `Cheque ${cheque_number} recorded (${bank_name}, dated ${cheque_date})`]
    )
    await pool.query('COMMIT')
    res.json(await resolveOrderRow(rows[0]))
  } catch (err) { await pool.query('ROLLBACK'); next(err) }
})

// PUT /orders/:id/resubmit — original placer edits a rejected order and resubmits it
router.put('/:id/resubmit', async (req, res, next) => {
  try {
    const { rows: [order] } = await pool.query(
      `SELECT placed_by, division_code, approval_status, payment_method, ordering_for_type, ordering_for_id FROM orders WHERE id = $1`,
      [req.params.id]
    )
    if (!order) return res.status(404).json({ error: 'Order not found' })
    if (order.placed_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the original placer can resubmit this order' })
    }
    if (order.approval_status !== 'rejected') {
      return res.status(409).json({ error: 'Only rejected orders can be resubmitted' })
    }

    // ordering_for_* is intentionally not accepted here — locked on resubmit.
    // delivery_* is accepted — the TM can pick a different saved/new address on resubmit.
    const { items, total_units, total_payable, total_discount, extra_data, payment_method, remarks,
            delivery_address, delivery_pin_code, delivery_city, delivery_state } = req.body

    const rules = await getDivisionRules(order.division_code)
    const { paymentOptions } = rules.orderEntry
    const validationError = validateOrderPayload(rules, { total_payable, extra_data, payment_method, delivery_address, delivery_pin_code, delivery_city, delivery_state, customer_type: order.ordering_for_type })
    if (validationError) return res.status(400).json({ error: validationError })

    // Outstanding limit check on resubmit
    const outstandingLimit = rules.orderEntry.outstandingLimitByType?.[order.ordering_for_type] || 0
    if (outstandingLimit > 0) {
      const { rows: [custBalance] } = await pool.query(
        `SELECT COALESCE(co.outstanding_amount, 0) AS sap_balance,
                COALESCE((
                  SELECT SUM(o2.total_payable) FROM orders o2
                  WHERE o2.ordering_for_id = $1
                    AND o2.payment_status = 'Pending'
                    AND o2.approval_status != 'rejected'
                ), 0) AS pending_orders_total
         FROM customers c
         LEFT JOIN customer_outstanding co ON co.customerid = c.id
         WHERE c.id = $1`,
        [order.ordering_for_id]
      )
      if (custBalance) {
        const totalOutstanding = Number(custBalance.sap_balance) + Number(custBalance.pending_orders_total)
        if (totalOutstanding > outstandingLimit) {
          return res.status(400).json({
            error: `Order blocked: this customer's outstanding balance (₹${totalOutstanding.toFixed(2)}) exceeds the allowed limit of ₹${outstandingLimit}.`,
          })
        }
      }
    }

    const { stateCode: delivery_state_code, cfaCode: cfa_code } = await resolveDeliveryStateAndCfa(delivery_state)
    if (!delivery_state_code) return res.status(400).json({ error: 'Unrecognized delivery state — please reselect the delivery address.' })

    await pool.query('BEGIN')

    await pool.query(
      `UPDATE orders SET
         approval_status = $1, placed_at = NOW(),
         item_count = $2, total_units = $3, total_payable = $4, total_discount = $5,
         extra_data = $6, payment_method = $7, payment_status = 'Pending',
         delivery_address = $9, delivery_pin_code = $10, delivery_city = $11, delivery_state_code = $12, cfa_code = $13
       WHERE id = $8`,
      [rules.orderWorkflow.initialStatus, items.length, total_units, total_payable, total_discount,
       extra_data ? JSON.stringify(extra_data) : null,
       paymentOptions.length > 0 ? payment_method : null,
       req.params.id,
       delivery_address, delivery_pin_code, delivery_city, delivery_state_code, cfa_code]
    )

    await pool.query(`DELETE FROM order_items WHERE order_id = $1`, [req.params.id])
    for (const item of items) {
      await pool.query(
        `INSERT INTO order_items
           (order_id, product_id, product_name, material_code, quantity, free_qty, unit_price, scheme_label, discount_value, line_total)
         VALUES ($1,$2,$3,(SELECT material_code FROM products WHERE id = $10),$4,$5,$6,$7,$8,$9)`,
        [req.params.id, item.product_id, item.product_name, item.quantity,
         item.free_qty || 0, item.unit_price, item.scheme_label || null, item.discount_value || 0, item.line_total,
         item.product_id]
      )
    }

    await pool.query(
      `INSERT INTO order_approvals (order_id, action, approved_by, approved_by_name, approver_usertype, reason)
       VALUES ($1, 'resubmit', $2, $3, $4, $5)`,
      [req.params.id, req.user.id, req.user.name, req.user.usertype, remarks || null]
    )

    const newPaymentMethod = paymentOptions.length > 0 ? payment_method : null
    if (newPaymentMethod && newPaymentMethod !== order.payment_method) {
      await pool.query(
        `INSERT INTO payment_log (subject_type, subject_id, status, payment_method) VALUES ('order', $1, 'Changed', $2)`,
        [req.params.id, newPaymentMethod]
      )
    }

    await pool.query('COMMIT')

    const { rows: [orderWithItems] } = await pool.query(
      `SELECT o.*,
              COALESCE(JSON_AGG(oi ORDER BY oi.seq) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1
       GROUP BY o.id`,
      [req.params.id]
    )
    void notifyOrderSubmitted(orderWithItems)
    res.json(await resolveOrderRow(orderWithItems))
  } catch (err) { await pool.query('ROLLBACK'); next(err) }
})

export default router
