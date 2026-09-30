// ============================================================
//  D2D Portal — cfa_state_master: drop the division dimension
//  Usage:  node db/migrate_cfa_state_master_drop_division.js
//
//  cfa_state_master used to map (division_code, state_code) -> cfa_code.
//  division_code is no longer read anywhere in the app (customer/order CFA
//  auto-resolution, the admin panel, and the dm/mm CFA-assignment picker are
//  all state-only now) — this collapses the table to one CFA per state_code
//  and nulls out the now-unused division_code column (kept, not dropped).
//
//  Aborts with no changes if any state_code currently maps to more than one
//  distinct cfa_code across divisions — that would mean collapsing loses
//  real information and needs a manual decision on which cfa_code wins.
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

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: conflicts } = await client.query(`
      SELECT state_code, ARRAY_AGG(DISTINCT cfa_code) AS cfa_codes
      FROM cfa_state_master
      GROUP BY state_code
      HAVING COUNT(DISTINCT cfa_code) > 1
    `)
    if (conflicts.length) {
      console.error(`Abort: ${conflicts.length} state(s) map to more than one distinct cfa_code across divisions — resolve manually before collapsing.`, conflicts)
      await client.query('ROLLBACK')
      process.exit(1)
    }

    // Multiple divisions may already share the same (state_code, cfa_code)
    // pair — keep one row per state_code, drop the rest, before the unique
    // constraint can be narrowed to state_code alone.
    const { rows: deduped } = await client.query(`
      DELETE FROM cfa_state_master a
      USING cfa_state_master b
      WHERE a.state_code = b.state_code AND a.id > b.id
      RETURNING a.id
    `)
    console.log(`removed ${deduped.length} duplicate row(s) (same state_code, different division_code)`)

    await client.query(`ALTER TABLE cfa_state_master ALTER COLUMN division_code DROP NOT NULL`)

    await client.query(`UPDATE cfa_state_master SET division_code = NULL`)

    await client.query(`
      ALTER TABLE cfa_state_master DROP CONSTRAINT IF EXISTS cfa_state_master_division_code_state_code_key
    `)
    await client.query(`
      ALTER TABLE cfa_state_master ADD CONSTRAINT cfa_state_master_state_code_key UNIQUE (state_code)
    `)

    await client.query(`DROP INDEX IF EXISTS idx_cfa_state_master_division`)

    await client.query('COMMIT')
    console.log('Done — cfa_state_master.division_code is now NULL/unused, UNIQUE(state_code) enforced.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
