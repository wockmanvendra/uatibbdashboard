import multer from 'multer'

// Shared by every admin "upload an Excel file" feature (e.g. customer-outstanding)
// — memory storage since rows are parsed and discarded, never written to /uploads
// like document/image uploads.
export const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
    ]
    cb(null, allowed.includes(file.mimetype))
  },
})

// Matches "Customer ID" / "customerid" / "SAP Customer Code" / "sap_customer_code" etc.
// to the same key, so an upload template's exact header casing/spacing doesn't matter.
export function normalizeHeader(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// ExcelJS cell values can be a plain scalar, a Date, rich text ({richText: [...]}),
// or a formula result ({formula, result}) — flatten all of those to a trimmed string.
export function cellToString(value) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(rt => rt.text).join('')
    if (value.result != null) return String(value.result)
    if (value.text != null) return String(value.text)
    return ''
  }
  return String(value).trim()
}

// Reads row 1 of a worksheet and returns a { normalizedHeader: colNumber } map,
// so callers can look up e.g. columns.empcode regardless of the template's exact header text.
export function mapHeaderColumns(worksheet) {
  const columns = {}
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    columns[normalizeHeader(cellToString(cell.value))] = colNumber
  })
  return columns
}
