// Migration: add allowed_customer_types column to division_rules and extend
// order_entry JSONB with minOrderValueByType and outstandingLimitByType fields.
//
// Run once: node backend/db/migrate-add-division-customer-rules.js

import pool from '../src/db/pool.js'

const ALL_TYPES = ['patient', 'doctor', 'doctor-pharmacy', 'hospital']
const DEFAULT_BY_TYPE = { patient: 0, doctor: 0, 'doctor-pharmacy': 0, hospital: 0 }

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Add allowed_customer_types column (no-op if already exists)
    await client.query(`
      ALTER TABLE division_rules
        ADD COLUMN IF NOT EXISTS allowed_customer_types TEXT[]
          DEFAULT ARRAY['patient','doctor','doctor-pharmacy','hospital']
    `)
    console.log('✓ allowed_customer_types column added (or already existed)')

    // 2. Back-fill allowed_customer_types = all types where still NULL
    await client.query(`
      UPDATE division_rules
         SET allowed_customer_types = $1
       WHERE allowed_customer_types IS NULL
    `, [ALL_TYPES])
    console.log('✓ Back-filled allowed_customer_types for existing rows')

    // 3. Add minOrderValueByType and outstandingLimitByType to order_entry JSONB
    //    where those keys don't already exist (safe to re-run).
    await client.query(`
      UPDATE division_rules
         SET order_entry = order_entry
           || jsonb_build_object(
                'minOrderValueByType',    $1::jsonb,
                'outstandingLimitByType', $1::jsonb
              )
       WHERE NOT (order_entry ? 'minOrderValueByType')
          OR NOT (order_entry ? 'outstandingLimitByType')
    `, [JSON.stringify(DEFAULT_BY_TYPE)])
    console.log('✓ Extended order_entry JSONB with per-type fields for existing rows')

    await client.query('COMMIT')
    console.log('\nMigration complete.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Migration failed, rolled back:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
