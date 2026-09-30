import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../db/pool.js'
import { CUSTOMER_TYPE_CODES } from './customerCode.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSVS_DIR = path.join(__dirname, '../../csvs')

const ORDER_COLUMNS = [
  'ordering_for_id', 'id', 'order_number', 'placed_at', 'status', 'approval_status', 'placed_by_name',
  'placed_by_usertype', 'ordering_for_name', 'ordering_for_type',
  'division_code', 'item_count', 'total_units', 'total_payable', 'total_discount',
  'payment_method', 'payment_status', 'delivery_address',
  'delivery_pin_code', 'delivery_city', 'delivery_state_code', 'cfa_code',
]
// item_ prefix avoids colliding with the orders columns above (both tables have id/order_id-shaped columns)
const ORDER_ITEM_COLUMNS = [
  'item_product_name', 'item_material_code',
  'item_quantity', 'item_free_qty', 'item_unit_price', 'item_scheme_label',
  'item_discount_value', 'item_line_total',
]
const CUSTOMER_COLUMNS = [
  'id', 'customer_type', 'customer_type_code', 'customer_code', 'name', 'email', 'mobile', 'address', 'pin_code', 'city', 'state', 'state_code',
  'cfa_code', 'division_code', 'sap_customer_code', 'sap_code', 'approval_status',
  'registered_at', 'age', 'gender', 'registration_number', 'selected_doctor_dml_code',
  'selected_doctor_name', 'selected_doctor_speciality', 'selected_doctor_classification',
  'gst_number', 'composition_scheme', 'drug_licence_number', 'drug_licence_valid_till',
  'pan_number', 'aadhaar_number', 'linked_doctor_dml_code', 'linked_doctor_name',
  'linked_doctor_speciality', 'selected_pharmacy_cml_code', 'selected_pharmacy_name',
  'hospital_registration_number',
]

// Only these columns are UUIDs (per db/schema.sql) — written to CSV without
// hyphens. Every other column (dates, business codes like customer_code/
// sap_code/material_code) must pass through formatField untouched.
const CUSTOMER_UUID_COLUMNS = new Set(['id'])
const ORDER_UUID_COLUMNS = new Set(['id', 'ordering_for_id'])

const stripHyphens = (value) => typeof value === 'string' ? value.replaceAll('-', '') : value

// customers.state is a free-text state name (no FK) — resolve it to state_master's
// code the same way customers.js's CFA lookup does (case-insensitive name match).
async function resolveStateCode(stateName) {
  if (!stateName) return ''
  const { rows } = await pool.query('SELECT state_code FROM state_master WHERE LOWER(state_name) = LOWER($1)', [stateName])
  return rows[0]?.state_code ?? ''
}

function customerRowValues(customer, stateCode) {
  return CUSTOMER_COLUMNS.map(c => {
    if (c === 'state_code') return stateCode
    if (c === 'customer_type_code') return CUSTOMER_TYPE_CODES[customer.customer_type] ?? ''
    return CUSTOMER_UUID_COLUMNS.has(c) ? stripHyphens(customer[c]) : customer[c]
  })
}

function formatField(value) {
  if (value === null || value === undefined) return ''
  const str = value instanceof Date ? value.toISOString()
    : typeof value === 'object' ? JSON.stringify(value)
    : String(value)
  return /[|"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

async function writeCsvFile(subdir, filename, headers, rows) {
  const dir = path.join(CSVS_DIR, subdir)
  await mkdir(dir, { recursive: true })
  const lines = [headers.join('|'), ...rows.map(row => row.map(formatField).join('|'))]
  await writeFile(path.join(dir, filename), lines.join('\n') + '\n', 'utf8')
}

export async function buildCustomerCsvContent(customer) {
  const stateCode = await resolveStateCode(customer.state)
  const lines = [
    CUSTOMER_COLUMNS.join('|'),
    customerRowValues(customer, stateCode).map(formatField).join('|'),
  ]
  return lines.join('\n') + '\n'
}

export function buildOrderCsvContent(order, items) {
  const orderValues = ORDER_COLUMNS.map(c => ORDER_UUID_COLUMNS.has(c) ? stripHyphens(order[c]) : order[c])
  const itemColumnNames = ORDER_ITEM_COLUMNS.map(c => c.replace(/^item_/, ''))
  const rows = items.length
    ? items.map(item => [...orderValues, ...itemColumnNames.map(c => item[c])])
    : [[...orderValues, ...ORDER_ITEM_COLUMNS.map(() => '')]]
  const lines = [
    [...ORDER_COLUMNS, ...ORDER_ITEM_COLUMNS].join('|'),
    ...rows.map(row => row.map(formatField).join('|')),
  ]
  return lines.join('\n') + '\n'
}

export async function exportOrderCsv(order) {
  try {
    const { rows: items } = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY seq', [order.id])
    const divCode = order.division_code || 'NA'
    const orderValues = ORDER_COLUMNS.map(c => ORDER_UUID_COLUMNS.has(c) ? stripHyphens(order[c]) : order[c])
    const itemColumnNames = ORDER_ITEM_COLUMNS.map(c => c.replace(/^item_/, ''))
    const rows = items.length
      ? items.map(item => [...orderValues, ...itemColumnNames.map(c => item[c])])
      : [[...orderValues, ...ORDER_ITEM_COLUMNS.map(() => '')]]
    await writeCsvFile('Order', `Order_${divCode}_${order.order_number}.csv`, [...ORDER_COLUMNS, ...ORDER_ITEM_COLUMNS], rows)
  } catch (err) {
    console.error('[csv-export] exportOrderCsv failed:', err)
  }
}

export async function exportCustomerCsv(customer) {
  try {
    const divCode = customer.division_code || 'NA'
    const stateCode = await resolveStateCode(customer.state)
    await writeCsvFile('Customer', `Customer_${divCode}_${customer.id}.csv`, CUSTOMER_COLUMNS, [customerRowValues(customer, stateCode)])
  } catch (err) {
    console.error('[csv-export] exportCustomerCsv failed:', err)
  }
}
