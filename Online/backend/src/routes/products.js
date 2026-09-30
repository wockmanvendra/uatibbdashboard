import { Router } from 'express'
import ExcelJS from 'exceljs'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'
import { uploadLimiter } from '../middleware/rateLimit.js'
import { excelUpload, cellToString, mapHeaderColumns } from '../utils/excelUpload.js'
import { resolveProductRow, resolveProductRows } from '../utils/resolveFileUrls.js'

const router = Router()

// GET /products  — list active products with their schemes
// Optional ?division_code= restricts results to a single division (used by
// division-scoped users, e.g. TMs, to only see their division's catalogue)
// Optional ?include_inactive=true lifts the is_active filter (used by the
// admin Product Master panel, which needs to manage inactive products too)
router.get('/', async (req, res, next) => {
  try {
    const { division_code, include_inactive } = req.query
    const conditions = []
    const params = []
    if (include_inactive !== 'true') conditions.push('p.is_active = TRUE')
    if (division_code) { conditions.push(`p.division_code = $${params.length + 1}`); params.push(division_code) }
    if (!conditions.length) conditions.push('TRUE')

    const { rows: products } = await pool.query(
      `SELECT p.*, COALESCE(
         JSON_AGG(s ORDER BY s.seq) FILTER (WHERE s.id IS NOT NULL), '[]'
       ) AS schemes
       FROM products p
       LEFT JOIN product_schemes s ON s.product_id = p.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY p.id
       ORDER BY p.name`,
      params
    )
    res.json(await resolveProductRows(products))
  } catch (err) { next(err) }
})

// GET /products/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, COALESCE(
         JSON_AGG(s ORDER BY s.seq) FILTER (WHERE s.id IS NOT NULL), '[]'
       ) AS schemes
       FROM products p
       LEFT JOIN product_schemes s ON s.product_id = p.id
       WHERE p.id = $1
       GROUP BY p.id`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Product not found' })
    res.json(await resolveProductRow(rows[0]))
  } catch (err) { next(err) }
})

// POST /products  — create a product (admin Product Master; write access is
// scm-admin/super-admin only — admin/bu-head are view-only here)
router.post('/', authorize('scm-admin', 'super-admin'), async (req, res, next) => {
  try {
    const { name, brand, material_code, division_code, price, description, min_order_qty, init_min_order_qty, max_order_qty, accent, image_url, unit, unit_description, is_active } = req.body
    if (!name || !brand || !material_code || !division_code || price == null || min_order_qty == null || init_min_order_qty == null || max_order_qty == null || !unit) {
      return res.status(400).json({ error: 'name, brand, material_code, division_code, price, min_order_qty, init_min_order_qty, max_order_qty and unit are required' })
    }

    const { rows } = await pool.query(
      `INSERT INTO products (name, brand, material_code, division_code, price, description, min_order_qty, init_min_order_qty, max_order_qty, accent, image_url, unit, unit_description, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [name, brand, material_code, division_code, price, description ?? null, min_order_qty, init_min_order_qty, max_order_qty, accent ?? null, image_url ?? null, unit, unit_description ?? null, is_active ?? true]
    )
    res.status(201).json({ ...(await resolveProductRow(rows[0])), schemes: [] })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Material code "${req.body.material_code}" already exists` })
    next(err)
  }
})

// PATCH /products/:id  — update a product (admin Product Master; write access is
// scm-admin/super-admin only — admin/bu-head are view-only here)
router.patch('/:id', authorize('scm-admin', 'super-admin'), async (req, res, next) => {
  try {
    const { name, brand, material_code, price, description, min_order_qty, init_min_order_qty, max_order_qty, accent, is_active, image_url, unit, unit_description } = req.body
    if (!name || !brand || !material_code || price == null || min_order_qty == null || init_min_order_qty == null || max_order_qty == null || !unit) {
      return res.status(400).json({ error: 'name, brand, material_code, price, min_order_qty, init_min_order_qty, max_order_qty and unit are required' })
    }

    const { rows } = await pool.query(
      `UPDATE products SET
         name              = COALESCE($2, name),
         brand             = COALESCE($3, brand),
         material_code     = COALESCE($4, material_code),
         price             = COALESCE($5, price),
         description       = $6,
         min_order_qty     = COALESCE($7, min_order_qty),
         max_order_qty     = COALESCE($8, max_order_qty),
         accent            = COALESCE($9, accent),
         is_active         = COALESCE($10, is_active),
         image_url         = COALESCE($11, image_url),
         unit              = $12,
         unit_description  = $13,
         init_min_order_qty = COALESCE($14, init_min_order_qty)
       WHERE id = $1
       RETURNING id`,
      [req.params.id, name, brand, material_code, price, description, min_order_qty, max_order_qty, accent, is_active, image_url, unit, unit_description, init_min_order_qty]
    )
    if (!rows.length) return res.status(404).json({ error: 'Product not found' })

    const { rows: full } = await pool.query(
      `SELECT p.*, COALESCE(
         JSON_AGG(s ORDER BY s.seq) FILTER (WHERE s.id IS NOT NULL), '[]'
       ) AS schemes
       FROM products p
       LEFT JOIN product_schemes s ON s.product_id = p.id
       WHERE p.id = $1
       GROUP BY p.id`,
      [req.params.id]
    )
    res.json(await resolveProductRow(full[0]))
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Material code "${req.body.material_code}" already exists` })
    next(err)
  }
})

// GET /products/upload/template — downloadable .xlsx with the expected headers
// + an example row. division_code is not a column here — it's sent as a form field
// alongside the file (the division already selected in the Product Master panel),
// since every product belongs to exactly one division.
router.get('/upload/template', authorize('scm-admin', 'super-admin'), async (_req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('products')
    sheet.addRow([
      'name', 'brand', 'material_code', 'price', 'min_order_qty', 'init_min_order_qty', 'max_order_qty',
      'description', 'accent', 'unit', 'unit_description', 'image_url', 'is_active',
    ])
    sheet.addRow([
      'Paracetamol 500mg', 'WockCare', 'MAT-001', 25.5, 10, 20, 500,
      'Pain relief tablet strip', '', 'Strip of 10 Tablets', '', '', 'TRUE',
    ])
    sheet.getRow(1).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="products_upload_template.xlsx"')
    res.send(Buffer.from(buffer))
  } catch (err) { next(err) }
})

// POST /products/upload — bulk-create products from an Excel file (multipart,
// field "file", plus a division_code form field), admin-only. material_code is the
// natural key and is globally unique across every division: a row whose
// material_code already exists anywhere is skipped and never overwrites the
// existing product — re-uploading a file can't silently change live pricing/
// catalog data. image_url is optional since Excel can't carry a
// binary image — bulk-created products land with no picture until the admin attaches
// one via the existing Edit form.
router.post('/upload', authorize('scm-admin', 'super-admin'), uploadLimiter, excelUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No valid Excel file received' })
    const division_code = req.body.division_code
    if (!division_code) return res.status(400).json({ error: 'division_code is required' })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(req.file.buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return res.status(400).json({ error: 'Excel file has no worksheet' })

    const columns = mapHeaderColumns(worksheet)
    const REQUIRED_COLUMNS = {
      name: 'name', brand: 'brand', price: 'price', materialcode: 'material_code',
      minorderqty: 'min_order_qty', initminorderqty: 'init_min_order_qty', maxorderqty: 'max_order_qty',
      unit: 'unit',
    }
    const missingCols = Object.entries(REQUIRED_COLUMNS).filter(([key]) => !columns[key]).map(([, label]) => label)
    if (missingCols.length) {
      return res.status(400).json({ error: `Excel must have columns: ${Object.values(REQUIRED_COLUMNS).join(', ')} (missing: ${missingCols.join(', ')})` })
    }

    const cell = (row, key) => (columns[key] ? cellToString(row.getCell(columns[key]).value) : '')

    const dataRows = []
    worksheet.eachRow((row, rowNumber) => { if (rowNumber > 1) dataRows.push({ row, rowNumber }) })

    const parseIntOrDefault = (text, fallback) => {
      if (!text) return { value: fallback, ok: true }
      const n = Number(text)
      return Number.isInteger(n) ? { value: n, ok: true } : { value: null, ok: false }
    }

    const parsed = dataRows.map(({ row, rowNumber }) => {
      const name = cell(row, 'name')
      const brand = cell(row, 'brand')
      const priceText = cell(row, 'price')
      const material_code = cell(row, 'materialcode') || null
      const description = cell(row, 'description') || null
      const unit = cell(row, 'unit')
      const minQtyText = cell(row, 'minorderqty')
      const initMinQtyText = cell(row, 'initminorderqty')
      const maxQtyText = cell(row, 'maxorderqty')

      const missingField = !name ? 'name' : !brand ? 'brand' : !priceText ? 'price'
        : !material_code ? 'material_code' : !unit ? 'unit'
        : !minQtyText ? 'min_order_qty' : !initMinQtyText ? 'init_min_order_qty' : !maxQtyText ? 'max_order_qty'
        : null
      if (missingField) {
        return { rowNumber, material_code, name, reason: `Missing required field: ${missingField}` }
      }
      const price = Number(priceText)
      if (Number.isNaN(price) || price < 0) {
        return { rowNumber, material_code, name, reason: 'Invalid price' }
      }

      const minQty = parseIntOrDefault(minQtyText, null)
      if (!minQty.ok) return { rowNumber, material_code, name, reason: 'Invalid min_order_qty' }
      const initMinQty = parseIntOrDefault(initMinQtyText, null)
      if (!initMinQty.ok) return { rowNumber, material_code, name, reason: 'Invalid init_min_order_qty' }
      const maxQty = parseIntOrDefault(maxQtyText, null)
      if (!maxQty.ok) return { rowNumber, material_code, name, reason: 'Invalid max_order_qty' }

      const isActiveText = cell(row, 'isactive').toLowerCase()
      const is_active = isActiveText === '' ? true : ['true', '1', 'yes'].includes(isActiveText)

      return {
        rowNumber, name, brand, material_code, price,
        min_order_qty: minQty.value,
        init_min_order_qty: initMinQty.value,
        max_order_qty: maxQty.value,
        description,
        accent: cell(row, 'accent') || null,
        unit,
        unit_description: cell(row, 'unitdescription') || null,
        image_url: cell(row, 'imageurl') || null,
        is_active,
      }
    })

    const candidateCodes = [...new Set(parsed.filter(r => !r.reason && r.material_code).map(r => r.material_code))]
    const { rows: existing } = candidateCodes.length
      ? await pool.query('SELECT material_code FROM products WHERE material_code = ANY($1::text[])', [candidateCodes])
      : { rows: [] }
    const existingCodes = new Set(existing.map(r => r.material_code))
    const seenInFile = new Set()

    const skippedRows = []
    let count = 0

    for (const r of parsed) {
      if (r.reason) {
        skippedRows.push({ row: r.rowNumber, material_code: r.material_code, name: r.name, reason: r.reason })
        continue
      }
      if (r.material_code && (existingCodes.has(r.material_code) || seenInFile.has(r.material_code))) {
        skippedRows.push({ row: r.rowNumber, material_code: r.material_code, name: r.name, reason: 'Material code already exists' })
        continue
      }
      if (r.material_code) seenInFile.add(r.material_code)

      try {
        await pool.query(
          `INSERT INTO products (name, brand, material_code, division_code, price, description, min_order_qty, init_min_order_qty, max_order_qty, accent, image_url, unit, unit_description, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [r.name, r.brand, r.material_code, division_code, r.price, r.description, r.min_order_qty, r.init_min_order_qty, r.max_order_qty, r.accent, r.image_url, r.unit, r.unit_description, r.is_active]
        )
        count++
      } catch (err) {
        if (r.material_code) seenInFile.delete(r.material_code)
        const reason = err.code === '23505' ? 'Material code already exists' : err.message
        skippedRows.push({ row: r.rowNumber, material_code: r.material_code, name: r.name, reason })
      }
    }

    res.json({ success: true, count, skipped: skippedRows.length, skippedRows })
  } catch (err) { next(err) }
})

export default router
