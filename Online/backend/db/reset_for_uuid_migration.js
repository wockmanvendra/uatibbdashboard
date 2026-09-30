// ============================================================
//  D2D Portal — One-time reset for the UUID primary-key migration
//  Usage:  node db/reset_for_uuid_migration.js
//
//  Drops the FK-interconnected web of business-data tables whose `id` column
//  is changing from an app-generated string/SERIAL to a DB-generated UUID
//  (these get repopulated by `node db/seed.js` afterwards), and converts the
//  two SERIAL-id tables with no incoming FK references (cfa_state_master,
//  sync_history) to UUID in place, with zero data loss. Everything else
//  (cfa_locations, state_master, division_mapping, division_rules,
//  bank_master, doctor_master_infinity, chemist_master_infinity,
//  field_structure_infinity, field_user_details) is untouched.
//
//  After this script: re-apply db/schema.sql, then run db/seed.js.
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

const TABLES_TO_DROP = [
  'payment_log', 'order_approvals', 'order_items', 'orders',
  'customer_outstanding', 'customer_approvals', 'customer_addresses', 'customer_documents', 'customers',
  'product_schemes', 'products',
  'users',
]

async function main() {
  console.log('\nD2D Portal — UUID migration reset\n')
  try {
    for (const table of TABLES_TO_DROP) {
      await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`)
      console.log(`  dropped ${table}`)
    }

    await pool.query(`
      ALTER TABLE cfa_state_master ALTER COLUMN id DROP DEFAULT;
      ALTER TABLE cfa_state_master ALTER COLUMN id TYPE UUID USING gen_random_uuid();
      ALTER TABLE cfa_state_master ALTER COLUMN id SET DEFAULT gen_random_uuid();
    `)
    console.log('  converted cfa_state_master.id to UUID in place (no data lost)')

    await pool.query(`
      ALTER TABLE sync_history ALTER COLUMN id DROP DEFAULT;
      ALTER TABLE sync_history ALTER COLUMN id TYPE UUID USING gen_random_uuid();
      ALTER TABLE sync_history ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE sync_history ALTER COLUMN run_by TYPE UUID USING NULL::uuid;
    `)
    console.log('  converted sync_history.id to UUID in place (run_by cleared — old users.id values no longer exist)')

    console.log('\nReset complete — now re-apply db/schema.sql, then run db/seed.js.\n')
  } catch (err) {
    console.error('\nReset failed.\n', err)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
