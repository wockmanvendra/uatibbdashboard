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

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Phase 1 — add new typed columns (idempotent)
    console.log('Phase 1: adding typed columns...')
    await client.query(`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS age                              SMALLINT,
        ADD COLUMN IF NOT EXISTS gender                          VARCHAR(20),
        ADD COLUMN IF NOT EXISTS registration_number             VARCHAR(100),
        ADD COLUMN IF NOT EXISTS selected_doctor_dml_code        VARCHAR(50),
        ADD COLUMN IF NOT EXISTS selected_doctor_name            VARCHAR(150),
        ADD COLUMN IF NOT EXISTS selected_doctor_speciality      VARCHAR(100),
        ADD COLUMN IF NOT EXISTS selected_doctor_classification  VARCHAR(50),
        ADD COLUMN IF NOT EXISTS gst_number                      VARCHAR(20),
        ADD COLUMN IF NOT EXISTS composition_scheme              BOOLEAN,
        ADD COLUMN IF NOT EXISTS drug_licence_number             VARCHAR(100),
        ADD COLUMN IF NOT EXISTS drug_licence_valid_till         DATE,
        ADD COLUMN IF NOT EXISTS pan_number                      VARCHAR(10),
        ADD COLUMN IF NOT EXISTS aadhaar_number                  VARCHAR(12),
        ADD COLUMN IF NOT EXISTS linked_doctor_dml_code          VARCHAR(50),
        ADD COLUMN IF NOT EXISTS linked_doctor_name              VARCHAR(150),
        ADD COLUMN IF NOT EXISTS linked_doctor_speciality        VARCHAR(100),
        ADD COLUMN IF NOT EXISTS selected_pharmacy_cml_code      VARCHAR(50),
        ADD COLUMN IF NOT EXISTS selected_pharmacy_name          VARCHAR(150),
        ADD COLUMN IF NOT EXISTS hospital_registration_number    VARCHAR(100),
        ADD COLUMN IF NOT EXISTS signed_registration_form_url    TEXT,
        ADD COLUMN IF NOT EXISTS signed_registration_form_name   VARCHAR(255),
        ADD COLUMN IF NOT EXISTS gst_certificate_url             TEXT,
        ADD COLUMN IF NOT EXISTS gst_certificate_name            VARCHAR(255),
        ADD COLUMN IF NOT EXISTS hospital_registration_cert_url  TEXT,
        ADD COLUMN IF NOT EXISTS hospital_registration_cert_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS drug_licence_cert_url           TEXT,
        ADD COLUMN IF NOT EXISTS drug_licence_cert_name          VARCHAR(255)
    `)
    console.log('  done.')

    // Phase 2 — backfill from extra_data if that column still exists
    const hasExtraData = await columnExists(client, 'customers', 'extra_data')
    if (hasExtraData) {
      console.log('Phase 2: backfilling from extra_data JSONB...')
      await client.query(`
        UPDATE customers SET
          age                              = NULLIF(extra_data->>'age', '')::SMALLINT,
          gender                           = extra_data->>'gender',
          registration_number              = extra_data->>'registrationNumber',
          selected_doctor_dml_code         = extra_data->'selectedDoctor'->>'dmlCode',
          selected_doctor_name             = extra_data->'selectedDoctor'->>'name',
          selected_doctor_speciality       = extra_data->'selectedDoctor'->>'speciality',
          selected_doctor_classification   = extra_data->'selectedDoctor'->>'classification',
          gst_number                       = extra_data->>'gstNumber',
          composition_scheme               = NULLIF(extra_data->>'compositionScheme', '')::BOOLEAN,
          drug_licence_number              = extra_data->>'drugLicenceNumber',
          drug_licence_valid_till          = NULLIF(extra_data->>'drugLicenceValidTill', '')::DATE,
          pan_number                       = extra_data->>'panNumber',
          aadhaar_number                   = extra_data->>'aadhaarNumber',
          linked_doctor_dml_code           = extra_data->'linkedDoctor'->>'dmlCode',
          linked_doctor_name               = extra_data->'linkedDoctor'->>'name',
          linked_doctor_speciality         = extra_data->'linkedDoctor'->>'speciality',
          selected_pharmacy_cml_code       = extra_data->'selectedPharmacy'->>'cmlCode',
          selected_pharmacy_name           = extra_data->'selectedPharmacy'->>'name',
          hospital_registration_number     = extra_data->>'hospitalRegistrationNumber',
          signed_registration_form_url     = extra_data->'signedRegistrationForm'->>'url',
          signed_registration_form_name    = extra_data->'signedRegistrationForm'->>'originalName',
          gst_certificate_url              = extra_data->'gstCertificate'->>'url',
          gst_certificate_name             = extra_data->'gstCertificate'->>'originalName',
          hospital_registration_cert_url   = extra_data->'hospitalRegistrationCertificate'->>'url',
          hospital_registration_cert_name  = extra_data->'hospitalRegistrationCertificate'->>'originalName',
          drug_licence_cert_url            = extra_data->'drugLicenceCertificate'->>'url',
          drug_licence_cert_name           = extra_data->'drugLicenceCertificate'->>'originalName'
        WHERE extra_data IS NOT NULL
      `)
      console.log('  done.')

      // Phase 3 — drop extra_data
      console.log('Phase 3: dropping extra_data column...')
      await client.query(`ALTER TABLE customers DROP COLUMN extra_data`)
      console.log('  done.')
    } else {
      console.log('Phase 2/3: extra_data column not found — skipping backfill and drop.')
    }

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
