import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({
  host:     process.env.PGHOST     ?? 'localhost',
  port:     Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'd2d_portal',
  user:     process.env.PGUSER     ?? 'postgres',
  password: process.env.PGPASSWORD ?? '',
})

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  return rows.length > 0
}

// Old paired columns -> canonical doc_type key (matches rules.documents.customer keys
// in src/config/divisionRules.js and the registration payload object names).
const DOC_COLUMNS = [
  { type: 'signedRegistrationForm',          url: 'signed_registration_form_url',   name: 'signed_registration_form_name' },
  { type: 'gstCertificate',                  url: 'gst_certificate_url',            name: 'gst_certificate_name' },
  { type: 'hospitalRegistrationCertificate', url: 'hospital_registration_cert_url', name: 'hospital_registration_cert_name' },
  { type: 'drugLicenceCertificate',          url: 'drug_licence_cert_url',          name: 'drug_licence_cert_name' },
]

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Phase 1 — create the child table (idempotent)
    console.log('Phase 1: creating customer_documents...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_documents (
        id            SERIAL       PRIMARY KEY,
        customer_id   VARCHAR(30)  NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        doc_type      VARCHAR(50)  NOT NULL,
        url           TEXT         NOT NULL,
        original_name VARCHAR(255),
        uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (customer_id, doc_type)
      )
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_documents_customer_id
        ON customer_documents(customer_id)
    `)
    console.log('  done.')

    // Phase 2 — backfill from the paired columns if they still exist
    for (const doc of DOC_COLUMNS) {
      if (!(await columnExists(client, 'customers', doc.url))) {
        console.log(`Phase 2: ${doc.url} not found — skipping backfill for ${doc.type}.`)
        continue
      }
      console.log(`Phase 2: backfilling ${doc.type}...`)
      const { rowCount } = await client.query(
        `INSERT INTO customer_documents (customer_id, doc_type, url, original_name)
         SELECT id, $1, ${doc.url}, ${doc.name}
         FROM customers
         WHERE ${doc.url} IS NOT NULL
         ON CONFLICT (customer_id, doc_type) DO NOTHING`,
        [doc.type]
      )
      console.log(`  ${rowCount} row(s).`)
    }

    // Phase 3 — drop the old paired columns
    console.log('Phase 3: dropping old document columns...')
    await client.query(`
      ALTER TABLE customers
        DROP COLUMN IF EXISTS signed_registration_form_url,
        DROP COLUMN IF EXISTS signed_registration_form_name,
        DROP COLUMN IF EXISTS gst_certificate_url,
        DROP COLUMN IF EXISTS gst_certificate_name,
        DROP COLUMN IF EXISTS hospital_registration_cert_url,
        DROP COLUMN IF EXISTS hospital_registration_cert_name,
        DROP COLUMN IF EXISTS drug_licence_cert_url,
        DROP COLUMN IF EXISTS drug_licence_cert_name
    `)
    console.log('  done.')

    await client.query('COMMIT')
    console.log('Migration complete.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Migration failed, rolled back:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
