// ============================================================
//  D2D Portal — Add UNIQUE constraints on customers identity fields
//  Usage:  node db/migrate_add_customers_unique_constraints.js
//
//  Adds UNIQUE constraints on customers.email / registration_number /
//  pan_number / aadhaar_number (mobile already has one — see schema.sql).
//  Before each constraint is added: blank strings are normalized to NULL
//  (never a real value), and any pre-existing duplicate keeps its value on
//  the earliest-registered row while later rows sharing it are nulled out.
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

const UNIQUE_COLUMNS = ['email', 'registration_number', 'pan_number', 'aadhaar_number']

async function main() {
  for (const col of UNIQUE_COLUMNS) {
    const { rowCount: blanked } = await pool.query(`UPDATE customers SET ${col} = NULL WHERE ${col} = ''`)
    if (blanked) console.log(`${col}: cleared ${blanked} blank-string value(s)`)

    const { rows: dupes } = await pool.query(`
      SELECT ${col} AS val FROM customers
      WHERE ${col} IS NOT NULL
      GROUP BY ${col} HAVING COUNT(*) > 1
    `)
    for (const { val } of dupes) {
      const { rows: ids } = await pool.query(
        `SELECT id FROM customers WHERE ${col} = $1 ORDER BY registered_at ASC`,
        [val]
      )
      const idsToNull = ids.slice(1).map(r => r.id)
      await pool.query(`UPDATE customers SET ${col} = NULL WHERE id = ANY($1::text[])`, [idsToNull])
      console.log(`${col}: duplicate "${val}" — kept on ${ids[0].id}, cleared on`, idsToNull)
    }

    try {
      await pool.query(`ALTER TABLE customers ADD CONSTRAINT customers_${col}_key UNIQUE (${col})`)
      console.log(`customers.${col} UNIQUE constraint added`)
    } catch (err) {
      // Postgres raises 42P07 ("relation already exists") for the constraint's
      // backing index, not 42710 (duplicate_object), when re-run.
      if (err.code === '42710' || err.code === '42P07') {
        console.log(`customers.${col} UNIQUE constraint already exists`)
      } else {
        throw err
      }
    }
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
