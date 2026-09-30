import { Router } from 'express'
import ExcelJS from 'exceljs'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'
import { uploadLimiter } from '../middleware/rateLimit.js'
import { recordSyncHistory } from './masters.js'
import { excelUpload, cellToString, mapHeaderColumns } from '../utils/excelUpload.js'

const router = Router()

router.use(authorize('admin', 'bu-head', 'super-admin'))

// GET /customer-outstanding  — list balances; admin/bu-head are confined to
// their own division, super-admin must pass ?division_code= explicitly (no
// accidental all-division dump).
router.get('/', async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.usertype === 'super-admin'
    const division_code = isSuperAdmin ? req.query.division_code : req.user.divisionCode
    if (isSuperAdmin && !division_code) return res.status(400).json({ error: 'division_code is required' })

    const conditions = []
    const params = []
    if (division_code) { conditions.push(`co.division_code = $${params.length + 1}`); params.push(division_code) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const { rows } = await pool.query(
      `SELECT co.*, c.name AS customer_name, c.customer_type, c.customer_code
       FROM customer_outstanding co
       JOIN customers c ON c.id = co.customerid
       ${where}
       ORDER BY co.outstanding_amount DESC`,
      params
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /customer-outstanding/template  — downloadable .xlsx with the expected
// headers + one example row, so admins know exactly what to upload.
router.get('/template', async (_req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('customer_outstanding')
    sheet.addRow(['customerid', 'sap_customer_code', 'outstanding_amount'])
    sheet.addRow(['CUS-1234567890', 'SAP-0001', 4500])
    sheet.getRow(1).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="customer_outstanding_template.xlsx"')
    res.send(Buffer.from(buffer))
  } catch (err) { next(err) }
})

// POST /customer-outstanding/upload  — Excel upload (multipart, field "file"), admin-only.
// Expects columns customerid, sap_customer_code, outstanding_amount (header matching is
// case/space-insensitive, first worksheet only). division_code is never read from the file —
// every row is stamped with the uploading user's active division — sent as a "division_code"
// form field alongside the file (req.user.divisionCode is null for admin/super-admin now that
// neither role is locked to one division). The upsert target is (division_code,
// sap_customer_code), not customerid, so a re-upload updates the same row instead of erroring
// on the customerid primary key.
router.post('/upload', uploadLimiter, excelUpload.single('file'), async (req, res, next) => {
  const run_by = req.user.id
  const run_by_name = req.user.name
  const division_code = req.body.division_code || req.user.divisionCode
  try {
    if (!req.file) return res.status(400).json({ error: 'No valid Excel file received' })
    if (!division_code) {
      const errorMessage = 'Select a division before uploading'
      await recordSyncHistory(pool, { syncType: 'customer-outstanding', status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: errorMessage })
    }

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(req.file.buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) {
      const errorMessage = 'Excel file has no worksheet'
      await recordSyncHistory(pool, { syncType: 'customer-outstanding', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: errorMessage })
    }

    const columns = mapHeaderColumns(worksheet)
    const customerIdCol = columns.customerid
    const sapCol = columns.sapcustomercode
    const amountCol = columns.outstandingamount
    if (!customerIdCol || !sapCol || !amountCol) {
      const errorMessage = 'Excel must have customerid, sap_customer_code, and outstanding_amount columns'
      await recordSyncHistory(pool, { syncType: 'customer-outstanding', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: errorMessage })
    }

    const dataRows = []
    worksheet.eachRow((row, rowNumber) => { if (rowNumber > 1) dataRows.push(row) })

    let count = 0
    let skipped = 0
    for (const row of dataRows) {
      const customerid = cellToString(row.getCell(customerIdCol).value)
      const sapCode = cellToString(row.getCell(sapCol).value)
      const amountText = cellToString(row.getCell(amountCol).value)
      const outstandingAmount = Number(amountText)

      if (!customerid || !sapCode || amountText === '' || Number.isNaN(outstandingAmount)) {
        skipped++
        continue
      }

      try {
        await pool.query(
          // outstanding_since ages from whenever the balance last went from
          // <=0 to positive — re-uploading the same still-unpaid amount
          // doesn't reset the clock, only settling to <=0 (or first going
          // positive) does. See recordCustomerOutstandingOutcome
          // (config/ccavenue.js) for the other writer of this pair.
          `INSERT INTO customer_outstanding (customerid, division_code, sap_customer_code, outstanding_amount, outstanding_since)
           VALUES ($1, $2, $3, $4::numeric, CASE WHEN $4::numeric > 0 THEN NOW() ELSE NULL END)
           ON CONFLICT (division_code, sap_customer_code) DO UPDATE SET
             customerid = EXCLUDED.customerid,
             outstanding_amount = EXCLUDED.outstanding_amount,
             outstanding_since = CASE
               WHEN EXCLUDED.outstanding_amount <= 0 THEN NULL
               WHEN customer_outstanding.outstanding_amount <= 0 THEN NOW()
               ELSE customer_outstanding.outstanding_since
             END`,
          [customerid, division_code, sapCode, outstandingAmount]
        )
        count++
      } catch {
        skipped++
      }
    }

    await recordSyncHistory(pool, { syncType: 'customer-outstanding', divisionCode: division_code, status: 'success', recordCount: count, skippedCount: skipped, runBy: run_by, runByName: run_by_name })
    res.json({ success: true, count, skipped })
  } catch (err) {
    await recordSyncHistory(pool, { syncType: 'customer-outstanding', divisionCode: division_code, status: 'error', errorMessage: err.message, runBy: run_by, runByName: run_by_name })
    next(err)
  }
})

export default router
