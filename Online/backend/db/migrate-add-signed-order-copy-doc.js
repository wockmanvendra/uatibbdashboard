// ============================================================
//  One-time bridge script — adds the "Signed Order Copy" document
//  requirement to every existing division_rules row's documents.order
//  array (DEFAULT_RULES already has it for divisions with no row).
//  Usage:  node db/migrate-add-signed-order-copy-doc.js
//  Safe to re-run — skips rows that already have the key; delete after use.
// ============================================================

import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'd2d_portal',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
})

const SIGNED_ORDER_COPY_DOC = { key: 'signedOrderCopy', label: 'Signed Order Copy', required: true }

try {
  const { rows } = await pool.query('SELECT division_code, documents FROM division_rules')
  for (const row of rows) {
    const order = row.documents?.order ?? []
    if (order.some(doc => doc.key === 'signedOrderCopy')) {
      console.log(`  ${row.division_code}: already has signedOrderCopy, skipping`)
      continue
    }
    const updatedDocuments = { ...row.documents, order: [...order, SIGNED_ORDER_COPY_DOC] }
    await pool.query(
      `UPDATE division_rules SET documents = $1 WHERE division_code = $2`,
      [JSON.stringify(updatedDocuments), row.division_code]
    )
    console.log(`  ${row.division_code}: added signedOrderCopy`)
  }
  console.log(`Done — ${rows.length} division_rules row(s) checked`)
} finally {
  await pool.end()
}
