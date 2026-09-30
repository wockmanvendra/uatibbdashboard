// Generates the next customer_code for a (customer_type, year) pair, e.g.
// ('doctor', 2026) -> 'DR2026000123'. `db` is anything exposing `.query`
// (a pool or a transaction client). Backed by customer_code_sequences so
// counters are permanent and never reused, even if the customer they were
// assigned to is later deleted, and atomic under concurrent registration
// (INSERT ... ON CONFLICT ... RETURNING, same pattern as generateOrderNumber()).
const CUSTOMER_TYPE_INITIALS = {
  patient: 'PT',
  doctor: 'DR',
  'doctor-pharmacy': 'DP',
  hospital: 'HS',
}

// Numeric code for customer_type, surfaced on the customer CSV export.
export const CUSTOMER_TYPE_CODES = {
  patient: 1,
  doctor: 2,
  'doctor-pharmacy': 3,
  hospital: 4,
}

export async function generateCustomerCode(db, customerType) {
  const year = new Date().getFullYear()
  const initials = CUSTOMER_TYPE_INITIALS[customerType] ?? 'CU'
  const { rows } = await db.query(
    `INSERT INTO customer_code_sequences (customer_type, year, next_seq) VALUES ($1, $2, 2)
     ON CONFLICT (customer_type, year) DO UPDATE SET next_seq = customer_code_sequences.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    [customerType, year]
  )
  return `${initials}${year}${String(rows[0].seq).padStart(6, '0')}`
}
