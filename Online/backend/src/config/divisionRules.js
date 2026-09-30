// ── Per-division business rules ───────────────────────────────────────────────
//
// Single source of truth for approval workflows, order-entry rules, and document
// requirements that can vary by division. DEFAULT_RULES is the fallback for any
// division with no row in the division_rules table — admins manage per-division
// overrides through the Division Rules admin panel (backend/src/routes/division-rules.js),
// not by editing this file. Exposed to the frontend via GET /divisions/:code/config
// and used directly by the orders/customers route handlers for enforcement.

import pool from '../db/pool.js'

const ORDER_WORKFLOW = {
  initialStatus: 'pending-l1',
  steps: [
    {
      step: 1,
      label: 'Field Management Approval',
      approverRoles: ['rm', 'zsm', 'nsm'],
      fromStatus: 'pending-l1',
      toStatus: 'approved-l1',
    },
    {
      step: 2,
      label: 'Marketing Approval',
      approverRoles: ['mm'],
      fromStatus: 'approved-l1',
      toStatus: 'approved',
    },
  ],
}

const CUSTOMER_WORKFLOW = {
  initialStatus: 'pending-l1',
  steps: [
    {
      step: 1,
      label: 'Field Management Approval',
      approverRoles: ['rm', 'zsm', 'nsm'],
      fromStatus: 'pending-l1',
      toStatus: 'approved-l1',
    },
    {
      step: 2,
      label: 'Distribution Approval',
      approverRoles: ['dm'],
      fromStatus: 'approved-l1',
      toStatus: 'approved',
    },
  ],
}

// Mirrors each registration form's current hardcoded "documents" section.
const CUSTOMER_DOCUMENTS = {
  patient: [],
  doctor: [
    { key: 'signedRegistrationForm', label: 'Customer Signed Registration Form', required: true },
    { key: 'panCopy', label: 'PAN Copy', required: false },
    { key: 'aadhaarCopy', label: 'Aadhaar Copy', required: false },
  ],
  'doctor-pharmacy': [
    { key: 'signedRegistrationForm', label: 'Customer Signed Registration Form', required: true },
    { key: 'gstCertificate', label: 'GST Certificate', required: true },
    { key: 'panCopy', label: 'PAN Copy', required: false },
    { key: 'aadhaarCopy', label: 'Aadhaar Copy', required: false },
  ],
  hospital: [
    { key: 'signedRegistrationForm', label: 'Customer Signed Registration Form', required: true },
    { key: 'gstCertificate', label: 'GST Certificate', required: true },
    { key: 'hospitalRegistrationCertificate', label: 'Hospital Registration Certificate', required: true },
    { key: 'drugLicenceCertificate', label: 'Drug Licence Certificate', required: true },
    { key: 'panCopy', label: 'PAN Copy', required: false },
    { key: 'aadhaarCopy', label: 'Aadhaar Copy', required: false },
  ],
}

export const DEFAULT_RULES = {
  orderWorkflow: ORDER_WORKFLOW,
  customerWorkflow: CUSTOMER_WORKFLOW,
  allowedCustomerTypes: ['patient', 'doctor', 'doctor-pharmacy', 'hospital'],
  // Which customer types may log in (OTP) to their own account — separate
  // from allowedCustomerTypes (registration eligibility).
  allowedLoginCustomerTypes: ['patient', 'doctor', 'doctor-pharmacy', 'hospital'],
  orderEntry: {
    showPrices: true,
    minOrderValue: 0,
    minOrderValueByType: { patient: 0, doctor: 0, 'doctor-pharmacy': 0, hospital: 0 },
    outstandingLimitByType: { patient: 0, doctor: 0, 'doctor-pharmacy': 0, hospital: 0 },
    paymentOptions: [], // subset of: 'pdc-delivery', 'online', 'payment-link'
  },
  documents: {
    customer: CUSTOMER_DOCUMENTS,
    order: [
      { key: 'signedOrderCopy', label: 'Signed Order Copy', required: true },
    ],
  },
}

/**
 * Effective rules for a division: the division_rules row for divisionCode if one
 * exists (admin-configured via the Division Rules panel), otherwise DEFAULT_RULES.
 * Each JSONB column on the row is a complete object for that piece — no merging
 * with defaults happens here once a row exists.
 */
export async function getDivisionRules(divisionCode) {
  if (!divisionCode) return DEFAULT_RULES
  const { rows } = await pool.query(
    `SELECT order_workflow, customer_workflow, order_entry, documents, allowed_customer_types, allowed_login_customer_types
     FROM division_rules WHERE division_code = $1`,
    [divisionCode]
  )
  if (!rows.length) return DEFAULT_RULES
  return {
    orderWorkflow:         rows[0].order_workflow,
    customerWorkflow:      rows[0].customer_workflow,
    orderEntry:            rows[0].order_entry,
    documents:             rows[0].documents,
    allowedCustomerTypes:  rows[0].allowed_customer_types ?? DEFAULT_RULES.allowedCustomerTypes,
    allowedLoginCustomerTypes: rows[0].allowed_login_customer_types ?? DEFAULT_RULES.allowedLoginCustomerTypes,
  }
}
