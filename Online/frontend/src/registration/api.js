import { CFA_Master } from './mockData.js'
import { cfaApi, mastersApi } from '../lib/api.js'

const SIMULATED_LATENCY_MS = 450

function delay(value, ms = SIMULATED_LATENCY_MS) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/**
 * Searchable-dropdown data source for the Doctor / Doctor Pharmacy directory
 * pickers. Doctor records come from `doctor_master_infinity`, Doctor
 * Pharmacy records from `chemist_master_infinity` (both via /masters/*).
 * Patient and Hospital registrations have no master directory — those forms
 * don't use this.
 */
export async function searchDirectory(type, query = '', divisionCode, sapCode, location, excludeCustomerId) {
  const q = query.trim()
  if (type === 'doctor') return mastersApi.searchDoctors(q, divisionCode, sapCode, location, excludeCustomerId)
  if (type === 'doctor-pharmacy') return mastersApi.searchChemists(q, divisionCode, sapCode, location)
  return []
}

/**
 * PIN code → city/state auto-fill via India Post public API.
 */
export async function lookupPinCode(pinCode) {
  const res = await fetch(`https://api.postalpincode.in/pincode/${pinCode}`)
  if (!res.ok) throw new Error('Lookup failed')
  const data = await res.json()
  if (!data?.[0] || data[0].Status !== 'Success' || !data[0].PostOffice?.length) {
    throw new Error('No address found for this PIN code')
  }
  const { District: city, State: state } = data[0].PostOffice[0]
  return { city, state }
}

/**
 * CFA codes for the dropdown — calls GET /cfa-locations.
 * Falls back to mock CFA_Master if the API is unreachable.
 */
export async function fetchCfaCodes() {
  try {
    return await cfaApi.list()
  } catch {
    return [...CFA_Master]
  }
}

/**
 * Final registration submission, including any uploaded documents.
 * Real implementation: POST /registrations  (multipart/form-data — see
 * buildRegistrationFormData for how files are attached alongside JSON fields)
 */
export function submitRegistration(customerType, formValues) {
  const referenceId = `REG-${customerType.toUpperCase().slice(0, 3)}-${Math.floor(100000 + Math.random() * 900000)}`
  return delay({ ok: true, referenceId, submittedAt: new Date().toISOString() }, 900)
}

/**
 * Builds the multipart payload a real backend would receive: JSON fields plus
 * any File objects captured by the upload widgets.
 */
export function buildRegistrationFormData(customerType, formValues) {
  const formData = new FormData()
  formData.append('customerType', customerType)

  Object.entries(formValues).forEach(([key, value]) => {
    if (value instanceof File) {
      formData.append(key, value, value.name)
    } else if (value !== undefined && value !== null) {
      formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    }
  })

  return formData
}
