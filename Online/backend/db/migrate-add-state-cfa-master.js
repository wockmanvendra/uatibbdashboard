// ============================================================
//  One-time bridge script — creates state_master and cfa_state_master on an
//  already-existing dev DB, and seeds state_master with the standard list of
//  Indian states/UTs (state_code/state_name). cfa_state_master is left for
//  an admin to populate via POST /api/cfa-state-master — guessing real
//  division+state -> CFA assignments isn't something a migration should do.
//  Usage:  node db/migrate-add-state-cfa-master.js
//  Safe to re-run (IF NOT EXISTS / ON CONFLICT); delete after use.
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

// Standard Indian states + union territories.
const STATES = [
  ['AP', 'Andhra Pradesh'], ['AR', 'Arunachal Pradesh'], ['AS', 'Assam'], ['BR', 'Bihar'],
  ['CG', 'Chhattisgarh'], ['GA', 'Goa'], ['GJ', 'Gujarat'], ['HR', 'Haryana'],
  ['HP', 'Himachal Pradesh'], ['JH', 'Jharkhand'], ['KA', 'Karnataka'], ['KL', 'Kerala'],
  ['MP', 'Madhya Pradesh'], ['MH', 'Maharashtra'], ['MN', 'Manipur'], ['ML', 'Meghalaya'],
  ['MZ', 'Mizoram'], ['NL', 'Nagaland'], ['OD', 'Odisha'], ['PB', 'Punjab'],
  ['RJ', 'Rajasthan'], ['SK', 'Sikkim'], ['TN', 'Tamil Nadu'], ['TG', 'Telangana'],
  ['TR', 'Tripura'], ['UP', 'Uttar Pradesh'], ['UK', 'Uttarakhand'], ['WB', 'West Bengal'],
  ['AN', 'Andaman and Nicobar Islands'], ['CH', 'Chandigarh'],
  ['DH', 'Dadra and Nagar Haveli and Daman and Diu'], ['DL', 'Delhi'],
  ['JK', 'Jammu and Kashmir'], ['LA', 'Ladakh'], ['LD', 'Lakshadweep'], ['PY', 'Puducherry'],
]

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS state_master (
        state_code  VARCHAR(10)   PRIMARY KEY,
        state_name  VARCHAR(100)  NOT NULL UNIQUE
    )
  `)
  console.log('state_master table created (or already existed)')

  for (const [stateCode, stateName] of STATES) {
    await pool.query(
      'INSERT INTO state_master (state_code, state_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [stateCode, stateName]
    )
  }
  console.log(`  seeded ${STATES.length} states/UTs`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cfa_state_master (
        id             SERIAL       PRIMARY KEY,
        division_code  VARCHAR(20)  NOT NULL,
        state_code     VARCHAR(10)  NOT NULL REFERENCES state_master(state_code),
        cfa_code       VARCHAR(20)  NOT NULL REFERENCES cfa_locations(cfa_code),
        UNIQUE (division_code, state_code)
    )
  `)
  console.log('cfa_state_master table created (or already existed)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cfa_state_master_division ON cfa_state_master(division_code)')

  // Seed the obvious same-city-name mappings for every division that already
  // has division_rules configured, so the feature is testable out of the box.
  // Anything less direct (e.g. which CFA covers Kerala) is left for an admin
  // to configure via POST /api/cfa-state-master.
  const OBVIOUS_CFA_STATE = [
    ['CFA-MUM-01', 'MH'], // CFA Mumbai -> Maharashtra
    ['CFA-DEL-03', 'DL'], // CFA Delhi -> Delhi
    ['CFA-BLR-04', 'KA'], // CFA Bangalore -> Karnataka
    ['CFA-HYD-05', 'TG'], // CFA Hyderabad -> Telangana
    ['CFA-CHN-06', 'TN'], // CFA Chennai -> Tamil Nadu
  ]
  const { rows: divisions } = await pool.query('SELECT DISTINCT division_code FROM division_rules')
  for (const { division_code } of divisions) {
    for (const [cfaCode, stateCode] of OBVIOUS_CFA_STATE) {
      await pool.query(
        `INSERT INTO cfa_state_master (division_code, state_code, cfa_code)
         SELECT $1::VARCHAR(20), $2::VARCHAR(10), $3::VARCHAR(20)
         WHERE EXISTS (SELECT 1 FROM cfa_locations WHERE cfa_code = $3::VARCHAR(20))
         ON CONFLICT (division_code, state_code) DO NOTHING`,
        [division_code, stateCode, cfaCode]
      )
    }
  }
  console.log(`  seeded obvious CFA/state mappings for ${divisions.length} division(s)`)
} finally {
  await pool.end()
}
