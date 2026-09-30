// ============================================================
//  D2D Portal — Import field_user_details from Internal_User_Details.xlsx
//  Usage:  node db/import_field_user_details.js
//  Prereq: field_user_details table must exist (run schema.sql or
//          migrate_add_field_user_details.sql first)
//
//  Reads tempdata/Internal_User_Details.xlsx directly as a ZIP archive
//  (xlsx files are ZIP + XML) using only Node built-ins, so no extra
//  dependency is needed for this one-off import.
// ============================================================

import 'dotenv/config'
import { readFileSync } from 'fs'
import path from 'path'
import zlib from 'zlib'
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'd2d_portal',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
})

const XLSX_PATH = path.join(import.meta.dirname, '../tempdata/Internal_User_Details.xlsx')

// ── Minimal ZIP reader (stored or deflate entries) ───────────────────────────

function readZipEntry(buf, entryName) {
  let eocdOffset = buf.length - 22
  while (eocdOffset >= 0 && buf.readUInt32LE(eocdOffset) !== 0x06054b50) eocdOffset--
  if (eocdOffset < 0) throw new Error('Not a valid zip file (EOCD not found)')

  const cdEntries = buf.readUInt16LE(eocdOffset + 10)
  let offset = buf.readUInt32LE(eocdOffset + 16)

  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('Malformed central directory')
    const compMethod  = buf.readUInt16LE(offset + 10)
    const compSize    = buf.readUInt32LE(offset + 20)
    const nameLen     = buf.readUInt16LE(offset + 28)
    const extraLen    = buf.readUInt16LE(offset + 30)
    const commentLen  = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)

    if (name === entryName) {
      const lfNameLen  = buf.readUInt16LE(localOffset + 26)
      const lfExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart  = localOffset + 30 + lfNameLen + lfExtraLen
      const data = buf.subarray(dataStart, dataStart + compSize)
      if (compMethod === 0) return data
      if (compMethod === 8) return zlib.inflateRawSync(data)
      throw new Error(`Unsupported zip compression method ${compMethod} for ${entryName}`)
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`Zip entry not found: ${entryName}`)
}

// ── Minimal XLSX (SpreadsheetML) parsing ─────────────────────────────────────

function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseSharedStrings(xml) {
  const strings = []
  for (const siMatch of xml.matchAll(/<si>(.*?)<\/si>/gs)) {
    const text = [...siMatch[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)]
      .map(m => decodeXmlEntities(m[1]))
      .join('')
    strings.push(text)
  }
  return strings
}

function parseSheetRows(xml, sharedStrings) {
  const rows = []
  for (const rowMatch of xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    const row = {}
    for (const cellMatch of rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"(?:\s+t="(\w+)")?[^>]*>(?:<v>(.*?)<\/v>)?<\/c>/gs)) {
      const [, col, type, rawValue] = cellMatch
      if (rawValue === undefined) { row[col] = null; continue }
      row[col] = type === 's' ? sharedStrings[Number(rawValue)] : decodeXmlEntities(rawValue)
    }
    rows.push(row)
  }
  return rows
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const zipBuf = readFileSync(XLSX_PATH)
  const sharedStrings = parseSharedStrings(readZipEntry(zipBuf, 'xl/sharedStrings.xml').toString('utf8'))
  const rows = parseSheetRows(readZipEntry(zipBuf, 'xl/worksheets/sheet1.xml').toString('utf8'), sharedStrings)

  const [header, ...dataRows] = rows
  const colFor = name => Object.keys(header).find(col => header[col] === name)
  const cols = {
    divisionCode: colFor('division_code'),
    empCode:      colFor('Emp_Code'),
    empName:      colFor('Emp_Name'),
    desig:        colFor('DESIG'),
    mobileNo:     colFor('MOBILE_NO'),
    emailId:      colFor('EMIAL ID'),
  }
  for (const [field, col] of Object.entries(cols)) {
    if (!col) throw new Error(`Column not found in spreadsheet header: ${field}`)
  }

  console.log(`\nD2D Portal — Import field_user_details from ${path.basename(XLSX_PATH)}\n`)
  console.log(`  Found ${dataRows.length} data rows`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let count = 0
    for (const row of dataRows) {
      const empCode = row[cols.empCode]?.trim()
      if (!empCode) continue
      await client.query(
        `INSERT INTO field_user_details (emp_code, emp_name, desig, mobile_no, email_id, division_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (emp_code) DO UPDATE SET
           emp_name = EXCLUDED.emp_name, desig = EXCLUDED.desig,
           mobile_no = EXCLUDED.mobile_no, email_id = EXCLUDED.email_id,
           division_code = EXCLUDED.division_code`,
        [
          empCode,
          row[cols.empName]?.trim() ?? null,
          row[cols.desig]?.trim() ?? null,
          row[cols.mobileNo]?.trim() || null,
          row[cols.emailId]?.trim() || null,
          row[cols.divisionCode]?.trim() ?? null,
        ]
      )
      count++
    }
    await client.query('COMMIT')
    console.log(`  Imported ${count} rows\n`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nImport failed — rolled back.\n', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
