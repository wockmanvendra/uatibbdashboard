import { Router } from 'express'
import ExcelJS from 'exceljs'
import { randomUUID } from 'crypto'
import pool from '../db/pool.js'
import { notifyCustomerSubmitted, notifyCustomerAwaitingFinalApproval, notifyCustomerApproved, notifyCustomerWelcome, notifyCustomerRejected } from '../services/notifications.js'
import { getDivisionRules } from '../config/divisionRules.js'
import { exportCustomerCsv, buildCustomerCsvContent } from '../utils/csvExport.js'
import { generateCustomerCode } from '../utils/customerCode.js'
import { authorize } from '../middleware/auth.js'
import { uploadLimiter } from '../middleware/rateLimit.js'
import { excelUpload, cellToString, mapHeaderColumns } from '../utils/excelUpload.js'
import { resolveUrlsDeep } from '../utils/resolveFileUrls.js'
import { isUuid } from '../utils/uuid.js'
import { getScope } from '../utils/scope.js'

const router = Router()

const CUSTOMER_TYPES = ['patient', 'doctor', 'doctor-pharmacy', 'hospital']
const MOBILE_PATTERN = /^[6-9]\d{9}$/

// Maps a UNIQUE-constraint violation on customers to a message a registrant/admin can
// act on — used by POST /, PUT /:id/resubmit, and POST /upload instead of leaking the
// raw Postgres constraint name.
const UNIQUE_CONSTRAINT_MESSAGES = {
  customers_mobile_key:               'A customer with this mobile number is already registered.',
  customers_email_key:                'A customer with this email is already registered.',
  customers_registration_number_key:  'A customer with this registration number is already registered.',
  customers_pan_number_key:           'A customer with this PAN number is already registered.',
  customers_aadhaar_number_key:       'A customer with this Aadhaar number is already registered.',
  ux_customers_gst_number:            'A customer with this GST number is already registered.',
  ux_customers_drug_licence_number:   'A customer with this drug licence number is already registered.',
}
function friendlyConstraintError(err) {
  return err.code === '23505' ? (UNIQUE_CONSTRAINT_MESSAGES[err.constraint] ?? null) : null
}

// Used by the approver-only PATCH /:id endpoint — cfa_code may arrive as a
// display name ('CFA Pune') instead of a code; resolve it via cfa_locations
// when so. This is the one place a CFA can still be hand-picked, as a
// correction after registration. Checks by code first (real cfa_code values
// in this DB are plain numbers like '1626', not a 'CFA-' prefixed format —
// a prefix check would always miss and wrongly fall through to the name
// lookup), falling back to a name lookup only if no code matches.
async function resolveCfaCode(client, cfaCode) {
  if (!cfaCode) return null
  const { rows: byCode } = await client.query('SELECT cfa_code FROM cfa_locations WHERE cfa_code = $1', [cfaCode])
  if (byCode[0]) return byCode[0].cfa_code
  const { rows: byName } = await client.query('SELECT cfa_code FROM cfa_locations WHERE cfa_name = $1', [cfaCode])
  return byName[0]?.cfa_code ?? null
}

// Used by POST /, PUT /:id/resubmit, and POST /upload — the CFA is always derived
// from the customer's state via cfa_state_master; any cfa_code submitted by
// the registration form itself is ignored.
async function resolveCfaCodeForState(client, state) {
  if (!state) return null
  const { rows } = await client.query(
    `SELECT csm.cfa_code FROM cfa_state_master csm
     JOIN state_master sm ON sm.state_code = csm.state_code
     WHERE LOWER(sm.state_name) = LOWER($1)
     LIMIT 1`,
    [state]
  )
  return rows[0]?.cfa_code ?? null
}

// Aggregates a customer's uploaded documents into a JSON array; '[]' when none.
// blob_name duplicates the raw stored value (an Azure blob key) under a key
// resolveUrlsDeep won't touch — url gets swapped for a short-lived SAS link
// for display, but the frontend needs blob_name to round-trip an unchanged
// document (one the TM didn't re-upload) back into a later resubmit/edit.
const DOCUMENTS_SUBQUERY = `
  COALESCE(
    (SELECT json_agg(json_build_object('doc_type', d.doc_type, 'url', d.url, 'blob_name', d.url, 'original_name', d.original_name) ORDER BY d.uploaded_at)
     FROM customer_documents d WHERE d.customer_id = c.id),
    '[]'::json
  )`

// Aggregates a customer's additional saved delivery addresses into a JSON array;
// '[]' when none. The customer's primary address stays on customers.address/
// pin_code/city/state, untouched — these are just the extra ones added at order time.
const ADDRESSES_SUBQUERY = `
  COALESCE(
    (SELECT json_agg(json_build_object('id', a.id, 'label', a.label, 'address', a.address, 'pin_code', a.pin_code, 'city', a.city, 'state', a.state) ORDER BY a.created_at)
     FROM customer_addresses a WHERE a.customer_id = c.id),
    '[]'::json
  )`

// GET /customers  — list customers; supports status, registered_by, customer_type, division_code, q (name search)
router.get('/', async (req, res, next) => {
  try {
    const { status, registered_by, customer_type, division_code, q } = req.query
    const conditions = []
    const params = []

    if (status)        { conditions.push(`c.approval_status = $${params.length + 1}`); params.push(status) }
    if (registered_by) { conditions.push(`c.registered_by = $${params.length + 1}`);   params.push(registered_by) }
    if (customer_type) { conditions.push(`c.customer_type = $${params.length + 1}`);   params.push(customer_type) }
    if (division_code) { conditions.push(`c.division_code = $${params.length + 1}`);   params.push(division_code) }
    if (q)             { conditions.push(`c.name ILIKE $${params.length + 1}`);         params.push(`%${q}%`) }

    // Hard, server-enforced access scope — hierarchy for tm/rm/zsm/nsm, division
    // (+cfa) for admin/bu-head/mm/dm, cfa_code for cfa, self-record for customer-
    // facing logins, global for super-admin. The filters above are additional
    // narrowing on top of this, never a substitute for it.
    const scope = await getScope(req.user, { subjectType: 'customer' })
    const scopeSql = scope.whereSql('c', params)
    if (scopeSql) conditions.push(scopeSql)

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const { rows } = await pool.query(
      `SELECT c.*, u.name AS registered_by_name, u.usertype AS registered_by_usertype,
              cl.cfa_name, dm.division_name,
              co.outstanding_amount, co.outstanding_since,
              -- "Outstanding" per the business formula: approved orders not yet
              -- paid, plus the SAP ledger above. Aging comes only from these
              -- orders' final approval date (order_approvals), falling back to
              -- placed_at for the rare order approved outside the normal
              -- approve flow with no logged approval event — never from
              -- outstanding_since — see memory "outstanding-balance-definition".
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ), 0) AS outstanding_orders_total,
              (
                SELECT MIN(COALESCE(fa.approved_at, o.placed_at))
                FROM orders o
                LEFT JOIN LATERAL (
                  SELECT oa.approved_at FROM order_approvals oa
                  WHERE oa.order_id = o.id AND oa.action = 'approve'
                  ORDER BY oa.approved_at DESC LIMIT 1
                ) fa ON true
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ) AS outstanding_orders_oldest_approved_at,
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.payment_status = 'Pending'
                  AND o.approval_status != 'rejected'
              ), 0) AS pending_orders_total,
              (SELECT reason FROM customer_approvals ca WHERE ca.customer_id = c.id AND ca.action = 'reject' ORDER BY ca.approved_at DESC LIMIT 1) AS rejection_reason,
              ${DOCUMENTS_SUBQUERY} AS documents,
              ${ADDRESSES_SUBQUERY} AS addresses
       FROM customers c
       LEFT JOIN users u ON u.id = c.registered_by
       LEFT JOIN cfa_locations cl ON cl.cfa_code = c.cfa_code
       LEFT JOIN division_mapping dm ON dm.division_code = c.division_code
       LEFT JOIN customer_outstanding co ON co.customerid = c.id
       ${where}
       ORDER BY c.registered_at DESC`,
      params
    )
    res.json(await resolveUrlsDeep(rows))
  } catch (err) { next(err) }
})

// Shared by the check-*-number endpoints below — true if no OTHER customer
// row already has this value for the given column. `column` is always a
// fixed literal from the call sites below, never derived from request input.
async function isColumnValueAvailable(column, value, excludeCustomerId) {
  const params = [value]
  let sql = `SELECT 1 FROM customers WHERE ${column} = $1`
  if (excludeCustomerId) {
    sql += ` AND id != $2`
    params.push(excludeCustomerId)
  }
  const { rows } = await pool.query(sql, params)
  return rows.length === 0
}

// GET /customers/check-registration-number?value=<v>&exclude_customer_id=<uuid?>
// A doctor <-> pharmacy link is one-to-one, so a given doctor registration
// number may be claimed by at most one customers row total — whether that
// row is a doctor's own registration_number or a pharmacy's link to that
// doctor (linked_doctor_registration_number). Checked against both columns;
// used by both DoctorForm.jsx and PharmacyForm.jsx.
router.get('/check-registration-number', async (req, res, next) => {
  try {
    const value = req.query.value?.trim()
    if (!value) return res.json({ available: false })
    const { exclude_customer_id } = req.query
    const params = [value]
    let sql = `SELECT 1 FROM customers WHERE (registration_number = $1 OR linked_doctor_registration_number = $1)`
    if (exclude_customer_id) {
      sql += ` AND id != $2`
      params.push(exclude_customer_id)
    }
    const { rows } = await pool.query(sql, params)
    res.json({ available: rows.length === 0 })
  } catch (err) { next(err) }
})

// GET /customers/check-gst-number?value=<v>&exclude_customer_id=<uuid?>
router.get('/check-gst-number', async (req, res, next) => {
  try {
    const value = req.query.value?.trim()
    if (!value) return res.json({ available: false })
    res.json({ available: await isColumnValueAvailable('gst_number', value, req.query.exclude_customer_id) })
  } catch (err) { next(err) }
})

// GET /customers/check-drug-licence-number?value=<v>&exclude_customer_id=<uuid?>
router.get('/check-drug-licence-number', async (req, res, next) => {
  try {
    const value = req.query.value?.trim()
    if (!value) return res.json({ available: false })
    res.json({ available: await isColumnValueAvailable('drug_licence_number', value, req.query.exclude_customer_id) })
  } catch (err) { next(err) }
})

// GET /customers/check-pan-number?value=<v>&exclude_customer_id=<uuid?>
router.get('/check-pan-number', async (req, res, next) => {
  try {
    const value = req.query.value?.trim()
    if (!value) return res.json({ available: false })
    res.json({ available: await isColumnValueAvailable('pan_number', value, req.query.exclude_customer_id) })
  } catch (err) { next(err) }
})

// GET /customers/check-aadhaar-number?value=<v>&exclude_customer_id=<uuid?>
router.get('/check-aadhaar-number', async (req, res, next) => {
  try {
    const value = req.query.value?.trim()
    if (!value) return res.json({ available: false })
    res.json({ available: await isColumnValueAvailable('aadhaar_number', value, req.query.exclude_customer_id) })
  } catch (err) { next(err) }
})

// GET /customers/check-email?value=<v>&exclude_customer_id=<uuid?>
router.get('/check-email', async (req, res, next) => {
  try {
    const value = req.query.value?.trim()
    if (!value) return res.json({ available: false })
    res.json({ available: await isColumnValueAvailable('email', value, req.query.exclude_customer_id) })
  } catch (err) { next(err) }
})

// GET /customers/check-mobile?value=<v>&exclude_customer_id=<uuid?>
router.get('/check-mobile', async (req, res, next) => {
  try {
    const value = req.query.value?.trim()
    if (!value) return res.json({ available: false })
    res.json({ available: await isColumnValueAvailable('mobile', value, req.query.exclude_customer_id) })
  } catch (err) { next(err) }
})

// GET /customers/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.name AS registered_by_name, u.usertype AS registered_by_usertype,
              cl.cfa_name, dm.division_name,
              co.outstanding_amount, co.outstanding_since,
              -- "Outstanding" per the business formula: approved orders not yet
              -- paid, plus the SAP ledger above. Aging comes only from these
              -- orders' final approval date (order_approvals), falling back to
              -- placed_at for the rare order approved outside the normal
              -- approve flow with no logged approval event — never from
              -- outstanding_since — see memory "outstanding-balance-definition".
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ), 0) AS outstanding_orders_total,
              (
                SELECT MIN(COALESCE(fa.approved_at, o.placed_at))
                FROM orders o
                LEFT JOIN LATERAL (
                  SELECT oa.approved_at FROM order_approvals oa
                  WHERE oa.order_id = o.id AND oa.action = 'approve'
                  ORDER BY oa.approved_at DESC LIMIT 1
                ) fa ON true
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ) AS outstanding_orders_oldest_approved_at,
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.payment_status = 'Pending'
                  AND o.approval_status != 'rejected'
              ), 0) AS pending_orders_total,
              (SELECT reason FROM customer_approvals ca WHERE ca.customer_id = c.id AND ca.action = 'reject' ORDER BY ca.approved_at DESC LIMIT 1) AS rejection_reason,
              ${DOCUMENTS_SUBQUERY} AS documents,
              ${ADDRESSES_SUBQUERY} AS addresses
       FROM customers c
       LEFT JOIN users u ON u.id = c.registered_by
       LEFT JOIN cfa_locations cl ON cl.cfa_code = c.cfa_code
       LEFT JOIN division_mapping dm ON dm.division_code = c.division_code
       LEFT JOIN customer_outstanding co ON co.customerid = c.id
       WHERE c.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Customer not found' })
    const scope = await getScope(req.user, { subjectType: 'customer' })
    if (!scope.allows(rows[0])) {
      return res.status(403).json({ error: 'Not authorized for this record.' })
    }
    res.json(await resolveUrlsDeep(rows[0]))
  } catch (err) { next(err) }
})

// GET /customers/:id/csv — admin/super-admin CSV download for a single customer
router.get('/:id/csv', authorize('admin', 'super-admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Customer not found' })
    const customer = rows[0]
    const filename = `Customer_${customer.division_code || 'NA'}_${customer.id}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(await buildCustomerCsvContent(customer))
  } catch (err) { next(err) }
})

// GET /customers/:id/approvals — full approve/reject/resubmit history, oldest first
router.get('/:id/approvals', async (req, res, next) => {
  try {
    const { rows: [customer] } = await pool.query(
      'SELECT division_code, registered_by, cfa_code, id FROM customers WHERE id = $1',
      [req.params.id]
    )
    if (!customer) return res.status(404).json({ error: 'Customer not found' })
    const scope = await getScope(req.user, { subjectType: 'customer' })
    if (!scope.allows(customer)) {
      return res.status(403).json({ error: 'Not authorized for this record.' })
    }

    const { rows } = await pool.query(
      `SELECT * FROM customer_approvals WHERE customer_id = $1 ORDER BY approved_at ASC`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// POST /customers/:id/addresses — add a saved delivery address for this customer,
// in addition to their single registration address. Used by order placement's
// "add new address" picker — the new row is reusable for future orders, distinct
// from the order-level delivery_* snapshot in orders.js.
router.post('/:id/addresses', async (req, res, next) => {
  try {
    const { label, address, pin_code, city, state } = req.body
    if (!address || !pin_code || !city || !state) {
      return res.status(400).json({ error: 'address, pin_code, city and state are required' })
    }

    const { rows: [customer] } = await pool.query(
      'SELECT id, division_code, registered_by, cfa_code FROM customers WHERE id = $1',
      [req.params.id]
    )
    if (!customer) return res.status(404).json({ error: 'Customer not found' })
    const scope = await getScope(req.user, { subjectType: 'customer' })
    if (!scope.allows(customer)) {
      return res.status(403).json({ error: 'Not authorized for this record.' })
    }

    const { rows } = await pool.query(
      `INSERT INTO customer_addresses (customer_id, label, address, pin_code, city, state)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.params.id, label || null, address, pin_code, city, state]
    )
    res.status(201).json(rows[0])
  } catch (err) { next(err) }
})

// GET /customers/:id/payment-log — full history of CCAvenue payment attempts, oldest first
router.get('/:id/payment-log', async (req, res, next) => {
  try {
    const { rows: [customer] } = await pool.query(
      'SELECT division_code, registered_by, cfa_code, id FROM customers WHERE id = $1',
      [req.params.id]
    )
    if (!customer) return res.status(404).json({ error: 'Customer not found' })
    const scope = await getScope(req.user, { subjectType: 'customer' })
    if (!scope.allows(customer)) {
      return res.status(403).json({ error: 'Not authorized for this record.' })
    }

    const { rows } = await pool.query(
      `SELECT * FROM payment_log WHERE subject_type = 'customer' AND subject_id = $1 ORDER BY recorded_at ASC`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /customers/upload/template — downloadable .xlsx with the expected headers
// + example rows, so admins know exactly what the bulk-upload below accepts.
router.get('/upload/template', authorize('scm-admin', 'super-admin'), async (_req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('customers')
    sheet.addRow([
      'customer_type', 'name', 'mobile', 'email', 'address', 'pin_code', 'city', 'state',
      'division_code', 'sap_customer_code', 'age', 'gender', 'registration_number',
      'gst_number', 'composition_scheme', 'drug_licence_number', 'drug_licence_valid_till',
      'pan_number', 'aadhaar_number', 'hospital_registration_number',
    ])
    sheet.addRow([
      'doctor', 'Dr. Asha Rao', '9876543210', 'asha.rao@example.com', '12 MG Road', '560001', 'Bengaluru', 'Karnataka',
      'DIV-GRO', 'SAP-0001', '', '', 'REG-12345', '', '', '', '', '', '', '',
    ])
    sheet.addRow([
      'hospital', 'City Care Hospital', '9876500000', 'admin@citycare.example', '45 Ring Road', '560002', 'Bengaluru', 'Karnataka',
      'DIV-GRO', 'SAP-0002', '', '', '', '27ABCDE1234F1Z5', 'FALSE', 'DL-998877', '2027-12-31', 'ABCDE1234F', '123456789012', 'HRC-5566',
    ])
    sheet.getRow(1).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="customers_upload_template.xlsx"')
    res.send(Buffer.from(buffer))
  } catch (err) { next(err) }
})

// POST /customers/upload — bulk-create customers from an Excel file (multipart,
// field "file"); write access is scm-admin/super-admin only — admin/bu-head are
// view-only here. Rows land at the division's step-1 toStatus (normally
// approved-l1 / "Awaiting Final Approval") instead of pending-l1, since the uploader is
// vouching for the data directly and it skips the RM/ZSM/NSM step. Per-row problems
// (missing mandatory fields, bad customer_type, invalid/duplicate mobile, unparseable
// age/date, or a DB constraint violation on insert) skip just that row rather than
// aborting the file — every skip is reported back with a reason to download as a log.
router.post('/upload', authorize('scm-admin', 'super-admin'), uploadLimiter, excelUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No valid Excel file received' })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(req.file.buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return res.status(400).json({ error: 'Excel file has no worksheet' })

    const columns = mapHeaderColumns(worksheet)
    const REQUIRED_COLUMNS = { customertype: 'customer_type', name: 'name', mobile: 'mobile', divisioncode: 'division_code' }
    const missingCols = Object.entries(REQUIRED_COLUMNS).filter(([key]) => !columns[key]).map(([, label]) => label)
    if (missingCols.length) {
      return res.status(400).json({ error: `Excel must have columns: ${Object.values(REQUIRED_COLUMNS).join(', ')} (missing: ${missingCols.join(', ')})` })
    }

    const cell = (row, key) => (columns[key] ? cellToString(row.getCell(columns[key]).value) : '')

    const dataRows = []
    worksheet.eachRow((row, rowNumber) => { if (rowNumber > 1) dataRows.push({ row, rowNumber }) })

    // Parse + validate every row up front so the existing-mobile lookup below can run
    // once for the whole batch instead of once per row.
    const parsed = dataRows.map(({ row, rowNumber }) => {
      const customer_type = cell(row, 'customertype')
      const name = cell(row, 'name')
      const mobile = cell(row, 'mobile')
      const division_code = cell(row, 'divisioncode')

      if (!customer_type || !name || !mobile || !division_code) {
        const missingField = !customer_type ? 'customer_type' : !name ? 'name' : !mobile ? 'mobile' : 'division_code'
        return { rowNumber, mobile, name, reason: `Missing required field: ${missingField}` }
      }
      if (!CUSTOMER_TYPES.includes(customer_type)) {
        return { rowNumber, mobile, name, reason: 'Invalid customer_type' }
      }
      if (!MOBILE_PATTERN.test(mobile)) {
        return { rowNumber, mobile, name, reason: 'Invalid mobile number' }
      }

      const ageText = cell(row, 'age')
      let age = null
      if (ageText) {
        age = Number(ageText)
        if (Number.isNaN(age)) return { rowNumber, mobile, name, reason: 'Invalid age' }
      }

      const drugLicenceValidTillText = cell(row, 'druglicencevalidtill')
      let drug_licence_valid_till = null
      if (drugLicenceValidTillText) {
        const parsedDate = new Date(drugLicenceValidTillText)
        if (Number.isNaN(parsedDate.getTime())) return { rowNumber, mobile, name, reason: 'Invalid drug_licence_valid_till date' }
        drug_licence_valid_till = drugLicenceValidTillText
      }

      const compositionText = cell(row, 'compositionscheme').toLowerCase()
      const composition_scheme = compositionText === '' ? null : ['true', '1', 'yes'].includes(compositionText)

      return {
        rowNumber, customer_type, name, mobile, division_code,
        email: cell(row, 'email') || null,
        address: cell(row, 'address') || null,
        pin_code: cell(row, 'pincode') || null,
        city: cell(row, 'city') || null,
        state: cell(row, 'state') || null,
        sap_customer_code: cell(row, 'sapcustomercode') || null,
        age,
        gender: cell(row, 'gender') || null,
        registration_number: cell(row, 'registrationnumber') || null,
        gst_number: cell(row, 'gstnumber') || null,
        composition_scheme,
        drug_licence_number: cell(row, 'druglicencenumber') || null,
        drug_licence_valid_till,
        pan_number: cell(row, 'pannumber') || null,
        aadhaar_number: cell(row, 'aadhaarnumber') || null,
        hospital_registration_number: cell(row, 'hospitalregistrationnumber') || null,
      }
    })

    const candidateMobiles = [...new Set(parsed.filter(r => !r.reason).map(r => r.mobile))]
    const { rows: existing } = candidateMobiles.length
      ? await pool.query('SELECT mobile FROM customers WHERE mobile = ANY($1::text[])', [candidateMobiles])
      : { rows: [] }
    const existingMobiles = new Set(existing.map(r => r.mobile))
    const seenInFile = new Set()
    const rulesByDivision = new Map()

    const skippedRows = []
    let count = 0

    for (const r of parsed) {
      if (r.reason) {
        skippedRows.push({ row: r.rowNumber, mobile: r.mobile, name: r.name, reason: r.reason })
        continue
      }
      if (existingMobiles.has(r.mobile) || seenInFile.has(r.mobile)) {
        skippedRows.push({ row: r.rowNumber, mobile: r.mobile, name: r.name, reason: 'Mobile number already exists' })
        continue
      }
      seenInFile.add(r.mobile)

      const client = await pool.connect()
      try {
        if (!rulesByDivision.has(r.division_code)) {
          rulesByDivision.set(r.division_code, await getDivisionRules(r.division_code))
        }
        const rules = rulesByDivision.get(r.division_code)
        const step1 = rules.customerWorkflow.steps.find(s => s.step === 1)
        const approval_status = step1?.toStatus ?? 'approved-l1'

        const resolvedCfaCode = await resolveCfaCodeForState(client, r.state)

        await client.query('BEGIN')
        const customer_code = await generateCustomerCode(client, r.customer_type)
        const { rows: [{ id }] } = await client.query(
          `INSERT INTO customers
             (customer_type, customer_code, name, email, mobile, address, pin_code, city, state,
              cfa_code, division_code, sap_customer_code, approval_status, registered_by,
              age, gender, registration_number,
              gst_number, composition_scheme, drug_licence_number, drug_licence_valid_till,
              pan_number, aadhaar_number, hospital_registration_number)
           VALUES
             ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           RETURNING id`,
          [
            r.customer_type, customer_code, r.name, r.email, r.mobile, r.address, r.pin_code, r.city, r.state,
            resolvedCfaCode, r.division_code, r.sap_customer_code, approval_status, req.user.id,
            r.age, r.gender, r.registration_number,
            r.gst_number, r.composition_scheme, r.drug_licence_number, r.drug_licence_valid_till,
            r.pan_number, r.aadhaar_number, r.hospital_registration_number,
          ]
        )
        await client.query(
          `INSERT INTO customer_approvals (customer_id, step, action, approved_by, approved_by_name, approver_usertype, reason)
           VALUES ($1, 1, 'approve', $2, $3, $4, 'Bulk Excel upload')`,
          [id, req.user.id, req.user.name, req.user.usertype]
        )
        await client.query('COMMIT')
        count++
      } catch (err) {
        await client.query('ROLLBACK')
        seenInFile.delete(r.mobile)
        skippedRows.push({ row: r.rowNumber, mobile: r.mobile, name: r.name, reason: friendlyConstraintError(err) ?? err.message })
      } finally {
        client.release()
      }
    }

    res.json({ success: true, count, skipped: skippedRows.length, skippedRows })
  } catch (err) { next(err) }
})

// POST /customers  — register a new customer
router.post('/', async (req, res, next) => {
  const client = await pool.connect()
  try {
    const {
      id: bodyId,
      customer_type, name, email, mobile, address, pin_code, city, state,
      division_code: bodyDivisionCode,
      age, gender, registration_number,
      selected_doctor_dml_code, selected_doctor_name, selected_doctor_speciality, selected_doctor_classification,
      gst_number, composition_scheme, drug_licence_number, drug_licence_valid_till,
      pan_number, aadhaar_number,
      linked_doctor_dml_code, linked_doctor_name, linked_doctor_speciality, linked_doctor_registration_number,
      selected_pharmacy_cml_code, selected_pharmacy_name,
      hospital_registration_number,
      documents,  // [{ doc_type, url, original_name }]
    } = req.body

    // Client generates this ahead of the request when it already uploaded
    // documents for this not-yet-created customer (see uploads.js entityId) —
    // falls back to a server-generated id for any caller that doesn't send one.
    const id = isUuid(bodyId) ? bodyId : randomUUID()

    const registered_by = req.user.id
    const division_code = req.user.divisionCode ?? bodyDivisionCode

    const divisionRules = await getDivisionRules(division_code)
    if (!divisionRules.allowedCustomerTypes.includes(customer_type)) {
      return res.status(400).json({ error: `Customer type '${customer_type}' is not available for registration in this division.` })
    }

    // sap_code is never client-supplied — it's the registering field rep's own
    // SAP territory code (users.sap_code, synced from vw_tm_hierarchy via
    // vw_infinity_users), not the customer's. Stamping it here instead of
    // trusting the request body is what actually ties the customer to the
    // TM/RM who registered them.
    const sap_code = req.user.sapCode
    if (!sap_code) {
      return res.status(400).json({ error: 'Your account has no SAP territory code configured — contact your administrator before registering customers.' })
    }

    const resolvedCfaCode = await resolveCfaCodeForState(client, state)

    await client.query('BEGIN')
    const customer_code = await generateCustomerCode(client, customer_type)
    const { rows } = await client.query(
      `INSERT INTO customers
         (id, customer_type, customer_code, name, email, mobile, address, pin_code, city, state,
          cfa_code, division_code, registered_by,
          age, gender, registration_number,
          selected_doctor_dml_code, selected_doctor_name, selected_doctor_speciality, selected_doctor_classification,
          gst_number, composition_scheme, drug_licence_number, drug_licence_valid_till,
          pan_number, aadhaar_number,
          linked_doctor_dml_code, linked_doctor_name, linked_doctor_speciality, linked_doctor_registration_number,
          selected_pharmacy_cml_code, selected_pharmacy_name,
          hospital_registration_number, sap_code)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
          $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
          $26,$27,$28,$29,$30,$31,$32,$33,$34)
       RETURNING *`,
      [
        id, customer_type, customer_code, name, email || null, mobile, address, pin_code, city, state,
        resolvedCfaCode, division_code, registered_by,
        age ?? null, gender ?? null, registration_number || null,
        selected_doctor_dml_code ?? null, selected_doctor_name ?? null,
        selected_doctor_speciality ?? null, selected_doctor_classification ?? null,
        gst_number ?? null, composition_scheme ?? null, drug_licence_number ?? null,
        drug_licence_valid_till ?? null, pan_number || null, aadhaar_number || null,
        linked_doctor_dml_code ?? null, linked_doctor_name ?? null, linked_doctor_speciality ?? null,
        linked_doctor_registration_number ?? null,
        selected_pharmacy_cml_code ?? null, selected_pharmacy_name ?? null,
        hospital_registration_number ?? null, sap_code ?? null,
      ]
    )

    const docs = (Array.isArray(documents) ? documents : []).filter(d => d?.doc_type && d?.url)
    for (const d of docs) {
      await client.query(
        `INSERT INTO customer_documents (customer_id, doc_type, url, original_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (customer_id, doc_type) DO UPDATE
           SET url = EXCLUDED.url, original_name = EXCLUDED.original_name, uploaded_at = NOW()`,
        [rows[0].id, d.doc_type, d.url, d.original_name ?? null]
      )
    }

    await client.query('COMMIT')
    const { rows: [customer] } = await pool.query(
      `SELECT c.*, u.name AS registered_by_name, u.usertype AS registered_by_usertype,
              cl.cfa_name, dm.division_name,
              co.outstanding_amount, co.outstanding_since,
              -- "Outstanding" per the business formula: approved orders not yet
              -- paid, plus the SAP ledger above. Aging comes only from these
              -- orders' final approval date (order_approvals), falling back to
              -- placed_at for the rare order approved outside the normal
              -- approve flow with no logged approval event — never from
              -- outstanding_since — see memory "outstanding-balance-definition".
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ), 0) AS outstanding_orders_total,
              (
                SELECT MIN(COALESCE(fa.approved_at, o.placed_at))
                FROM orders o
                LEFT JOIN LATERAL (
                  SELECT oa.approved_at FROM order_approvals oa
                  WHERE oa.order_id = o.id AND oa.action = 'approve'
                  ORDER BY oa.approved_at DESC LIMIT 1
                ) fa ON true
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ) AS outstanding_orders_oldest_approved_at,
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.payment_status = 'Pending'
                  AND o.approval_status != 'rejected'
              ), 0) AS pending_orders_total,
              ${DOCUMENTS_SUBQUERY} AS documents,
              ${ADDRESSES_SUBQUERY} AS addresses
       FROM customers c
       LEFT JOIN users u ON u.id = c.registered_by
       LEFT JOIN cfa_locations cl ON cl.cfa_code = c.cfa_code
       LEFT JOIN division_mapping dm ON dm.division_code = c.division_code
       LEFT JOIN customer_outstanding co ON co.customerid = c.id
       WHERE c.id = $1`,
      [rows[0].id]
    )
    void notifyCustomerSubmitted(customer)
    res.status(201).json(await resolveUrlsDeep(customer))
  } catch (err) {
    await client.query('ROLLBACK')
    const friendly = friendlyConstraintError(err)
    if (friendly) return res.status(409).json({ error: friendly })
    next(err)
  } finally {
    client.release()
  }
})

// PATCH /customers/:id  — approver-only edit of address fields
router.patch('/:id', authorize('rm', 'zsm', 'nsm', 'mm', 'dm', 'admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const ALLOWED = ['address', 'pin_code', 'city', 'state', 'sap_customer_code', 'sap_code']
    const sets = []
    const params = []

    for (const key of ALLOWED) {
      if (!(key in req.body)) continue
      const val = req.body[key] ?? null
      sets.push(`${key} = $${params.length + 1}`)
      params.push(val)
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' })

    params.push(req.params.id)
    const { rowCount } = await pool.query(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    )
    if (!rowCount) return res.status(404).json({ error: 'Customer not found' })

    const { rows } = await pool.query(
      `SELECT c.*, u.name AS registered_by_name, u.usertype AS registered_by_usertype,
              cl.cfa_name, dm.division_name,
              co.outstanding_amount, co.outstanding_since,
              -- "Outstanding" per the business formula: approved orders not yet
              -- paid, plus the SAP ledger above. Aging comes only from these
              -- orders' final approval date (order_approvals), falling back to
              -- placed_at for the rare order approved outside the normal
              -- approve flow with no logged approval event — never from
              -- outstanding_since — see memory "outstanding-balance-definition".
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ), 0) AS outstanding_orders_total,
              (
                SELECT MIN(COALESCE(fa.approved_at, o.placed_at))
                FROM orders o
                LEFT JOIN LATERAL (
                  SELECT oa.approved_at FROM order_approvals oa
                  WHERE oa.order_id = o.id AND oa.action = 'approve'
                  ORDER BY oa.approved_at DESC LIMIT 1
                ) fa ON true
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ) AS outstanding_orders_oldest_approved_at,
              (SELECT reason FROM customer_approvals ca WHERE ca.customer_id = c.id AND ca.action = 'reject' ORDER BY ca.approved_at DESC LIMIT 1) AS rejection_reason,
              ${DOCUMENTS_SUBQUERY} AS documents,
              ${ADDRESSES_SUBQUERY} AS addresses
       FROM customers c
       LEFT JOIN users u ON u.id = c.registered_by
       LEFT JOIN cfa_locations cl ON cl.cfa_code = c.cfa_code
       LEFT JOIN division_mapping dm ON dm.division_code = c.division_code
       LEFT JOIN customer_outstanding co ON co.customerid = c.id
       WHERE c.id = $1`,
      [req.params.id]
    )
    res.json(await resolveUrlsDeep(rows[0]))
  } catch (err) { next(err) }
})

// PUT /customers/:id/admin-edit — admin/super-admin full-field edit of an approved customer
// Locks name, mobile, customer_code. Does not reset approval_status.
router.put('/:id/admin-edit', authorize('admin', 'super-admin'), async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { rows: [customer] } = await client.query(
      `SELECT id, approval_status FROM customers WHERE id = $1`,
      [req.params.id]
    )
    if (!customer) return res.status(404).json({ error: 'Customer not found' })
    if (customer.approval_status !== 'approved') {
      return res.status(409).json({ error: 'Only approved customers can be edited via this route' })
    }

    const {
      email, address, pin_code, city, state, cfa_code,
      age, gender, registration_number,
      selected_doctor_dml_code, selected_doctor_name, selected_doctor_speciality, selected_doctor_classification,
      gst_number, composition_scheme, drug_licence_number, drug_licence_valid_till,
      pan_number, aadhaar_number,
      linked_doctor_dml_code, linked_doctor_name, linked_doctor_speciality, linked_doctor_registration_number,
      selected_pharmacy_cml_code, selected_pharmacy_name,
      hospital_registration_number,
      documents,
    } = req.body
    // sap_code intentionally not accepted here — it's the registering TM/RM's
    // own SAP territory code, stamped at create time; admin-edit doesn't touch
    // it. Use PATCH /:id (rm/zsm/nsm/mm/dm/admin/bu-head/super-admin) to
    // correct a bad value after the fact.

    const resolvedCfaCode = await resolveCfaCode(client, cfa_code)

    await client.query('BEGIN')
    const { rows: [updated] } = await client.query(
      `UPDATE customers SET
         email = $1, address = $2, pin_code = $3, city = $4, state = $5, cfa_code = $6,
         age = $7, gender = $8, registration_number = $9,
         selected_doctor_dml_code = $10, selected_doctor_name = $11, selected_doctor_speciality = $12, selected_doctor_classification = $13,
         gst_number = $14, composition_scheme = $15, drug_licence_number = $16, drug_licence_valid_till = $17,
         pan_number = $18, aadhaar_number = $19,
         linked_doctor_dml_code = $20, linked_doctor_name = $21, linked_doctor_speciality = $22, linked_doctor_registration_number = $23,
         selected_pharmacy_cml_code = $24, selected_pharmacy_name = $25,
         hospital_registration_number = $26
       WHERE id = $27
       RETURNING *`,
      [
        email || null, address || null, pin_code || null, city || null, state || null, resolvedCfaCode,
        age ?? null, gender ?? null, registration_number || null,
        selected_doctor_dml_code ?? null, selected_doctor_name ?? null, selected_doctor_speciality ?? null, selected_doctor_classification ?? null,
        gst_number ?? null, composition_scheme ?? null, drug_licence_number ?? null, drug_licence_valid_till ?? null,
        pan_number || null, aadhaar_number || null,
        linked_doctor_dml_code ?? null, linked_doctor_name ?? null, linked_doctor_speciality ?? null, linked_doctor_registration_number ?? null,
        selected_pharmacy_cml_code ?? null, selected_pharmacy_name ?? null,
        hospital_registration_number ?? null,
        req.params.id,
      ]
    )

    const docs = (Array.isArray(documents) ? documents : []).filter(d => d?.doc_type && d?.url)
    for (const d of docs) {
      await client.query(
        `INSERT INTO customer_documents (customer_id, doc_type, url, original_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (customer_id, doc_type) DO UPDATE SET url = EXCLUDED.url, original_name = EXCLUDED.original_name, uploaded_at = NOW()`,
        [req.params.id, d.doc_type, d.url, d.original_name ?? null]
      )
    }

    await client.query(
      `INSERT INTO customer_approvals (customer_id, action, approved_by, approved_by_name, approver_usertype)
       VALUES ($1, 'admin-edit', $2, $3, $4)`,
      [req.params.id, req.user.id, req.user.name, req.user.usertype]
    )

    await client.query('COMMIT')

    const { rows: [full] } = await client.query(
      `SELECT c.*, u.name AS registered_by_name, u.usertype AS registered_by_usertype,
              cl.cfa_name, dm.division_name,
              co.outstanding_amount, co.outstanding_since,
              -- "Outstanding" per the business formula: approved orders not yet
              -- paid, plus the SAP ledger above. Aging comes only from these
              -- orders' final approval date (order_approvals), falling back to
              -- placed_at for the rare order approved outside the normal
              -- approve flow with no logged approval event — never from
              -- outstanding_since — see memory "outstanding-balance-definition".
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ), 0) AS outstanding_orders_total,
              (
                SELECT MIN(COALESCE(fa.approved_at, o.placed_at))
                FROM orders o
                LEFT JOIN LATERAL (
                  SELECT oa.approved_at FROM order_approvals oa
                  WHERE oa.order_id = o.id AND oa.action = 'approve'
                  ORDER BY oa.approved_at DESC LIMIT 1
                ) fa ON true
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ) AS outstanding_orders_oldest_approved_at,
              (SELECT reason FROM customer_approvals ca WHERE ca.customer_id = c.id AND ca.action = 'reject' ORDER BY ca.approved_at DESC LIMIT 1) AS rejection_reason,
              ${DOCUMENTS_SUBQUERY} AS documents,
              ${ADDRESSES_SUBQUERY} AS addresses
       FROM customers c
       LEFT JOIN users u ON u.id = c.registered_by
       LEFT JOIN cfa_locations cl ON cl.cfa_code = c.cfa_code
       LEFT JOIN division_mapping dm ON dm.division_code = c.division_code
       LEFT JOIN customer_outstanding co ON co.customerid = c.id
       WHERE c.id = $1`,
      [req.params.id]
    )
    res.json(await resolveUrlsDeep(full))
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

// PATCH /customers/:id/approve
router.patch('/:id/approve', async (req, res, next) => {
  const client = await pool.connect()
  try {
    const approved_by = req.user.id
    const approved_by_name = req.user.name

    const { rows: [customer] } = await client.query(
      `SELECT division_code, approval_status, registered_by, cfa_code FROM customers WHERE id = $1`,
      [req.params.id]
    )
    if (!customer) return res.status(404).json({ error: 'Customer not found' })

    const rules = await getDivisionRules(customer.division_code)
    const step = rules.customerWorkflow.steps.find(s => s.fromStatus === customer.approval_status)
    if (!step) return res.status(409).json({ error: 'Customer is not awaiting approval' })
    if (!step.approverRoles.includes(req.user.usertype)) {
      return res.status(403).json({ error: 'Not authorized to approve this step' })
    }
    if (customer.registered_by === req.user.id) {
      return res.status(403).json({ error: 'You cannot act on a customer you registered yourself.' })
    }
    const scope = await getScope(req.user, { subjectType: 'customer' })
    if (!scope.allows(customer)) {
      return res.status(403).json({ error: 'This customer is outside your assignment.' })
    }
    const next_status = step.toStatus

    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE customers SET approval_status = $1 WHERE id = $2 RETURNING *`,
      [next_status, req.params.id]
    )
    const { rows: [approval] } = await client.query(
      `INSERT INTO customer_approvals (customer_id, action, approved_by, approved_by_name, approver_usertype)
       VALUES ($1, 'approve', $2, $3, $4)
       RETURNING approved_at`,
      [req.params.id, approved_by, approved_by_name, req.user.usertype]
    )

    if (next_status === 'approved') {
      const customerRow = rows[0]
      if (customerRow.mobile) {
        const { rows: existingUser } = await client.query(
          `SELECT id FROM users WHERE mobileno = $1`,
          [customerRow.mobile]
        )
        if (!existingUser.length) {
          await client.query(
            `INSERT INTO users (usertype, name, mobileno, otp, division_code, email)
             VALUES ($1, $2, $3, '123456', $4, $5)`,
            [customerRow.customer_type, customerRow.name, customerRow.mobile, customerRow.division_code, customerRow.email]
          )
        }
      }
    }

    await client.query('COMMIT')
    if (next_status === 'approved') {
      void notifyCustomerApproved(rows[0], approved_by_name, approval.approved_at)
      void notifyCustomerWelcome(rows[0])
      void exportCustomerCsv(rows[0])
    } else if (next_status === 'approved-l1') {
      void notifyCustomerAwaitingFinalApproval(rows[0], approved_by_name, approval.approved_at)
    }
    const { rows: [full] } = await pool.query(
      `SELECT c.*, u.name AS registered_by_name, u.usertype AS registered_by_usertype,
              cl.cfa_name, dm.division_name,
              co.outstanding_amount, co.outstanding_since,
              -- "Outstanding" per the business formula: approved orders not yet
              -- paid, plus the SAP ledger above. Aging comes only from these
              -- orders' final approval date (order_approvals), falling back to
              -- placed_at for the rare order approved outside the normal
              -- approve flow with no logged approval event — never from
              -- outstanding_since — see memory "outstanding-balance-definition".
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ), 0) AS outstanding_orders_total,
              (
                SELECT MIN(COALESCE(fa.approved_at, o.placed_at))
                FROM orders o
                LEFT JOIN LATERAL (
                  SELECT oa.approved_at FROM order_approvals oa
                  WHERE oa.order_id = o.id AND oa.action = 'approve'
                  ORDER BY oa.approved_at DESC LIMIT 1
                ) fa ON true
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ) AS outstanding_orders_oldest_approved_at,
              (SELECT reason FROM customer_approvals ca WHERE ca.customer_id = c.id AND ca.action = 'reject' ORDER BY ca.approved_at DESC LIMIT 1) AS rejection_reason,
              ${DOCUMENTS_SUBQUERY} AS documents,
              ${ADDRESSES_SUBQUERY} AS addresses
       FROM customers c
       LEFT JOIN users u ON u.id = c.registered_by
       LEFT JOIN cfa_locations cl ON cl.cfa_code = c.cfa_code
       LEFT JOIN division_mapping dm ON dm.division_code = c.division_code
       LEFT JOIN customer_outstanding co ON co.customerid = c.id
       WHERE c.id = $1`,
      [req.params.id]
    )
    res.json(await resolveUrlsDeep(full))
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

// PATCH /customers/:id/reject
router.patch('/:id/reject', async (req, res, next) => {
  try {
    const { reason } = req.body
    const approved_by = req.user.id
    const approved_by_name = req.user.name

    const { rows: [customer] } = await pool.query(
      `SELECT division_code, approval_status, registered_by, cfa_code FROM customers WHERE id = $1`,
      [req.params.id]
    )
    if (!customer) return res.status(404).json({ error: 'Customer not found' })

    const rules = await getDivisionRules(customer.division_code)
    const step = rules.customerWorkflow.steps.find(s => s.fromStatus === customer.approval_status)
    if (!step) return res.status(409).json({ error: 'Customer is not awaiting approval' })
    if (!step.approverRoles.includes(req.user.usertype)) {
      return res.status(403).json({ error: 'Not authorized to act on this step' })
    }
    if (customer.registered_by === req.user.id) {
      return res.status(403).json({ error: 'You cannot act on a customer you registered yourself.' })
    }
    const scope = await getScope(req.user, { subjectType: 'customer' })
    if (!scope.allows(customer)) {
      return res.status(403).json({ error: 'This customer is outside your assignment.' })
    }

    await pool.query('BEGIN')
    const { rows } = await pool.query(
      `UPDATE customers SET approval_status = 'rejected' WHERE id = $1 RETURNING *`,
      [req.params.id]
    )
    const { rows: [rejection] } = await pool.query(
      `INSERT INTO customer_approvals (customer_id, action, approved_by, approved_by_name, reason, approver_usertype)
       VALUES ($1, 'reject', $2, $3, $4, $5)
       RETURNING approved_at`,
      [req.params.id, approved_by, approved_by_name, reason || null, req.user.usertype]
    )
    await pool.query('COMMIT')
    void notifyCustomerRejected(rows[0], approved_by_name, rejection.approved_at, reason)
    const { rows: [full] } = await pool.query(
      `SELECT c.*, u.name AS registered_by_name, u.usertype AS registered_by_usertype,
              cl.cfa_name, dm.division_name,
              co.outstanding_amount, co.outstanding_since,
              -- "Outstanding" per the business formula: approved orders not yet
              -- paid, plus the SAP ledger above. Aging comes only from these
              -- orders' final approval date (order_approvals), falling back to
              -- placed_at for the rare order approved outside the normal
              -- approve flow with no logged approval event — never from
              -- outstanding_since — see memory "outstanding-balance-definition".
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ), 0) AS outstanding_orders_total,
              (
                SELECT MIN(COALESCE(fa.approved_at, o.placed_at))
                FROM orders o
                LEFT JOIN LATERAL (
                  SELECT oa.approved_at FROM order_approvals oa
                  WHERE oa.order_id = o.id AND oa.action = 'approve'
                  ORDER BY oa.approved_at DESC LIMIT 1
                ) fa ON true
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ) AS outstanding_orders_oldest_approved_at,
              (SELECT reason FROM customer_approvals ca WHERE ca.customer_id = c.id AND ca.action = 'reject' ORDER BY ca.approved_at DESC LIMIT 1) AS rejection_reason,
              ${DOCUMENTS_SUBQUERY} AS documents,
              ${ADDRESSES_SUBQUERY} AS addresses
       FROM customers c
       LEFT JOIN users u ON u.id = c.registered_by
       LEFT JOIN cfa_locations cl ON cl.cfa_code = c.cfa_code
       LEFT JOIN division_mapping dm ON dm.division_code = c.division_code
       LEFT JOIN customer_outstanding co ON co.customerid = c.id
       WHERE c.id = $1`,
      [req.params.id]
    )
    res.json(await resolveUrlsDeep(full))
  } catch (err) { await pool.query('ROLLBACK'); next(err) }
})

// PUT /customers/:id/resubmit — original registrant edits a rejected customer and resubmits it
router.put('/:id/resubmit', async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { rows: [customer] } = await client.query(
      `SELECT registered_by, customer_type, division_code, approval_status FROM customers WHERE id = $1`,
      [req.params.id]
    )
    if (!customer) return res.status(404).json({ error: 'Customer not found' })
    if (customer.registered_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the original registrant can resubmit this customer' })
    }
    if (customer.approval_status !== 'rejected') {
      return res.status(409).json({ error: 'Only rejected customers can be resubmitted' })
    }

    const {
      name, email, mobile, address, pin_code, city, state,
      age, gender, registration_number,
      selected_doctor_dml_code, selected_doctor_name, selected_doctor_speciality, selected_doctor_classification,
      gst_number, composition_scheme, drug_licence_number, drug_licence_valid_till,
      pan_number, aadhaar_number,
      linked_doctor_dml_code, linked_doctor_name, linked_doctor_speciality, linked_doctor_registration_number,
      selected_pharmacy_cml_code, selected_pharmacy_name,
      hospital_registration_number,
      documents,
    } = req.body
    // customer_type intentionally not accepted here — locked on resubmit

    // sap_code is re-derived from the resubmitting user, same as on initial
    // create — resubmit is already gated to the original registrant above,
    // so this is always that TM/RM's own SAP territory code.
    const sap_code = req.user.sapCode
    if (!sap_code) {
      return res.status(400).json({ error: 'Your account has no SAP territory code configured — contact your administrator before registering customers.' })
    }

    const rules = await getDivisionRules(customer.division_code)
    const resolvedCfaCode = await resolveCfaCodeForState(client, state)

    await client.query('BEGIN')
    const { rows: [updated] } = await client.query(
      `UPDATE customers SET
         approval_status = $1, registered_at = NOW(),
         name = $2, email = $3, mobile = $4, address = $5, pin_code = $6, city = $7, state = $8, cfa_code = $9,
         age = $10, gender = $11, registration_number = $12,
         selected_doctor_dml_code = $13, selected_doctor_name = $14, selected_doctor_speciality = $15, selected_doctor_classification = $16,
         gst_number = $17, composition_scheme = $18, drug_licence_number = $19, drug_licence_valid_till = $20,
         pan_number = $21, aadhaar_number = $22,
         linked_doctor_dml_code = $23, linked_doctor_name = $24, linked_doctor_speciality = $25, linked_doctor_registration_number = $26,
         selected_pharmacy_cml_code = $27, selected_pharmacy_name = $28,
         hospital_registration_number = $29, sap_code = $30
       WHERE id = $31
       RETURNING *`,
      [rules.customerWorkflow.initialStatus, name, email || null, mobile, address, pin_code, city, state, resolvedCfaCode,
       age ?? null, gender ?? null, registration_number || null,
       selected_doctor_dml_code ?? null, selected_doctor_name ?? null, selected_doctor_speciality ?? null, selected_doctor_classification ?? null,
       gst_number ?? null, composition_scheme ?? null, drug_licence_number ?? null, drug_licence_valid_till ?? null,
       pan_number || null, aadhaar_number || null,
       linked_doctor_dml_code ?? null, linked_doctor_name ?? null, linked_doctor_speciality ?? null, linked_doctor_registration_number ?? null,
       selected_pharmacy_cml_code ?? null, selected_pharmacy_name ?? null,
       hospital_registration_number ?? null, sap_code ?? null,
       req.params.id]
    )

    const docs = (Array.isArray(documents) ? documents : []).filter(d => d?.doc_type && d?.url)
    for (const d of docs) {
      await client.query(
        `INSERT INTO customer_documents (customer_id, doc_type, url, original_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (customer_id, doc_type) DO UPDATE SET url = EXCLUDED.url, original_name = EXCLUDED.original_name, uploaded_at = NOW()`,
        [req.params.id, d.doc_type, d.url, d.original_name ?? null]
      )
    }

    await client.query(
      `INSERT INTO customer_approvals (customer_id, action, approved_by, approved_by_name, approver_usertype)
       VALUES ($1, 'resubmit', $2, $3, $4)`,
      [req.params.id, req.user.id, req.user.name, req.user.usertype]
    )

    await client.query('COMMIT')

    const { rows: [full] } = await client.query(
      `SELECT c.*, u.name AS registered_by_name, u.usertype AS registered_by_usertype,
              cl.cfa_name, dm.division_name,
              co.outstanding_amount, co.outstanding_since,
              -- "Outstanding" per the business formula: approved orders not yet
              -- paid, plus the SAP ledger above. Aging comes only from these
              -- orders' final approval date (order_approvals), falling back to
              -- placed_at for the rare order approved outside the normal
              -- approve flow with no logged approval event — never from
              -- outstanding_since — see memory "outstanding-balance-definition".
              COALESCE((
                SELECT SUM(o.total_payable) FROM orders o
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ), 0) AS outstanding_orders_total,
              (
                SELECT MIN(COALESCE(fa.approved_at, o.placed_at))
                FROM orders o
                LEFT JOIN LATERAL (
                  SELECT oa.approved_at FROM order_approvals oa
                  WHERE oa.order_id = o.id AND oa.action = 'approve'
                  ORDER BY oa.approved_at DESC LIMIT 1
                ) fa ON true
                WHERE o.ordering_for_id = c.id
                  AND o.approval_status = 'approved'
                  AND o.payment_status != 'Success'
              ) AS outstanding_orders_oldest_approved_at,
              ${DOCUMENTS_SUBQUERY} AS documents,
              ${ADDRESSES_SUBQUERY} AS addresses
       FROM customers c
       LEFT JOIN users u ON u.id = c.registered_by
       LEFT JOIN cfa_locations cl ON cl.cfa_code = c.cfa_code
       LEFT JOIN division_mapping dm ON dm.division_code = c.division_code
       LEFT JOIN customer_outstanding co ON co.customerid = c.id
       WHERE c.id = $1`,
      [req.params.id]
    )
    void notifyCustomerSubmitted(full)
    res.json(await resolveUrlsDeep(full))
  } catch (err) {
    await client.query('ROLLBACK')
    const friendly = friendlyConstraintError(err)
    if (friendly) return res.status(409).json({ error: friendly })
    next(err)
  } finally {
    client.release()
  }
})

export default router
