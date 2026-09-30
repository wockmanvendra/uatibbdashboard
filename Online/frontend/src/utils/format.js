export const USERTYPE_LABELS = {
  patient: 'Patient', doctor: 'Doctor', 'doctor-pharmacy': 'Doctor Pharmacy',
  hospital: 'Hospital', admin: 'Admin', 'super-admin': 'Super Admin', 'scm-admin': 'SCM Admin', tm: 'Territory Manager',
  rm: 'Regional Manager', zsm: 'Zonal Sales Manager',
  nsm: 'National Sales Manager', cfa: 'CFA',
  mm: 'Marketing Manager', dm: 'Distribution Manager', 'bu-head': 'BU Head',
}

// Doctors are addressed with the "Dr." honorific (unless their stored name
// already carries one); other customer types are shown their name as-is.
export function formatCustomerDisplayName(customer) {
  const name = customer?.name?.trim() ?? ''
  if (!name || customer?.customerType !== 'doctor') return name
  return /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`
}

const dateFormatter     = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const dateOnlyFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export function fmtDate(iso) {
  return dateFormatter.format(new Date(iso)).replace(',', ' ·')
}

export function fmtDateOnly(iso) {
  return dateOnlyFormatter.format(new Date(iso)).replace(',', ' ')
}

// Elapsed time since `iso`, e.g. "2 days", "3 hrs", "Just now"
export function fmtElapsed(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Sortable key for a date's calendar month, e.g. "2026-04"
export function monthKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Display label for a monthKey, e.g. "2026-04" -> "Apr-2026"
export function monthKeyLabel(key) {
  const [year, month] = key.split('-')
  return `${MONTH_ABBR[Number(month) - 1]}-${year}`
}
