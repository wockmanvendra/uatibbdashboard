// ============================================================
//  D2D Portal — Add sync_history table
//  Usage:  node db/migrate_add_sync_history.js
//
//  Creates the sync_history table (audit trail of Infinity Master
//  Sync job runs — doctors/chemists/field-structure/users — see schema.sql).
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_history (
        id            SERIAL       PRIMARY KEY,
        sync_type     VARCHAR(30)  NOT NULL,
        division_code VARCHAR(20),
        status        VARCHAR(20)  NOT NULL,
        record_count  INTEGER,
        skipped_count INTEGER,
        error_message TEXT,
        run_by        VARCHAR(20)  REFERENCES users(id),
        run_by_name   VARCHAR(100),
        run_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  console.log('sync_history table ensured')

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sync_history_type_division ON sync_history(sync_type, division_code)
  `)
  console.log('idx_sync_history_type_division index ensured')

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
