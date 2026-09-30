// Generates the next order_number for a (division_code, year) pair, e.g.
// ('DIV-GRO', 2026) -> 'DIV-GRO2026000123'. `db` is anything exposing `.query`
// (a pool or a transaction client). Backed by order_number_sequences so
// counters are permanent and never reused, even if the order they were
// assigned to is later deleted, and atomic under concurrent placement
// (INSERT ... ON CONFLICT ... RETURNING, same pattern as generateUserId()
// used for user ids before this migration).
export async function generateOrderNumber(db, divisionCode) {
  const year = new Date().getFullYear()
  const { rows } = await db.query(
    `INSERT INTO order_number_sequences (division_code, year, next_seq) VALUES ($1, $2, 2)
     ON CONFLICT (division_code, year) DO UPDATE SET next_seq = order_number_sequences.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    [divisionCode, year]
  )
  return `${divisionCode}${year}${String(rows[0].seq).padStart(6, '0')}`
}
