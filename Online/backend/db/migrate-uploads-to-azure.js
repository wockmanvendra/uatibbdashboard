// ============================================================
//  D2D Portal — one-off migration of local backend/uploads/* files
//  into Azure Blob Storage, rewriting the DB rows that reference them.
//
//  Usage:  node db/migrate-uploads-to-azure.js
//  Prereq: AZURE_* vars set in backend/.env (see .env.*.example), and the
//          service principal must already have blob read/write + delegation
//          permissions on the target container.
//
//  Leaves the local files under backend/uploads/ untouched — safe to re-run
//  (rows already migrated no longer match the '/uploads/...' pattern below).
// ============================================================

import 'dotenv/config'
import pg from 'pg'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { uploadFile } from '../src/config/azureBlob.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = path.join(__dirname, '../uploads')

const { Pool } = pg
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'd2d_portal',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
})

const MIME_BY_EXT = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png':  'image/png',
}

const isLocalUploadPath = (value) => typeof value === 'string' && value.startsWith('/uploads/')

async function migrateOne(localPath, category, date) {
  const filename = path.basename(localPath)
  const buffer = await fs.readFile(path.join(UPLOADS_DIR, filename))
  const mimetype = MIME_BY_EXT[path.extname(filename).toLowerCase()] || 'application/octet-stream'
  return uploadFile(buffer, filename, mimetype, category, date)
}

async function migrateCustomerDocuments() {
  const { rows } = await pool.query(
    `SELECT id, url, uploaded_at FROM customer_documents WHERE url LIKE '/uploads/%'`
  )
  let migrated = 0, failed = 0
  for (const row of rows) {
    try {
      const blobName = await migrateOne(row.url, 'customers', row.uploaded_at)
      await pool.query('UPDATE customer_documents SET url = $1 WHERE id = $2', [blobName, row.id])
      migrated++
    } catch (err) {
      failed++
      console.error(`  ! customer_documents ${row.id} (${row.url}): ${err.message}`)
    }
  }
  return { migrated, failed }
}

async function migrateProductImages() {
  const { rows } = await pool.query(
    `SELECT id, image_url FROM products WHERE image_url LIKE '/uploads/%'`
  )
  let migrated = 0, failed = 0
  for (const row of rows) {
    try {
      const blobName = await migrateOne(row.image_url, 'products', new Date())
      await pool.query('UPDATE products SET image_url = $1 WHERE id = $2', [blobName, row.id])
      migrated++
    } catch (err) {
      failed++
      console.error(`  ! products ${row.id} (${row.image_url}): ${err.message}`)
    }
  }
  return { migrated, failed }
}

async function migrateOrderPodUrls() {
  const { rows } = await pool.query(
    `SELECT id, pod_url, placed_at FROM orders WHERE pod_url LIKE '/uploads/%'`
  )
  let migrated = 0, failed = 0
  for (const row of rows) {
    try {
      const blobName = await migrateOne(row.pod_url, 'orders', row.placed_at)
      await pool.query('UPDATE orders SET pod_url = $1 WHERE id = $2', [blobName, row.id])
      migrated++
    } catch (err) {
      failed++
      console.error(`  ! orders.pod_url ${row.id} (${row.pod_url}): ${err.message}`)
    }
  }
  return { migrated, failed }
}

// extra_data is a freeform JSONB blob (compliance docs, cheque photo, …) that
// can nest a `url` field at any depth — walk it and migrate every local path found.
async function migrateExtraDataUrls(value, category, date) {
  let changed = false
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const result = await migrateExtraDataUrls(value[i], category, date)
      if (result.changed) { value[i] = result.value; changed = true }
    }
    return { value, changed }
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key === 'url' && isLocalUploadPath(value[key])) {
        value[key] = await migrateOne(value[key], category, date)
        changed = true
      } else {
        const result = await migrateExtraDataUrls(value[key], category, date)
        if (result.changed) { value[key] = result.value; changed = true }
      }
    }
    return { value, changed }
  }
  return { value, changed }
}

async function migrateOrderExtraData() {
  const { rows } = await pool.query(
    `SELECT id, extra_data, placed_at FROM orders WHERE extra_data::text LIKE '%/uploads/%'`
  )
  let migrated = 0, failed = 0
  for (const row of rows) {
    try {
      const { value, changed } = await migrateExtraDataUrls(row.extra_data, 'orders', row.placed_at)
      if (changed) {
        await pool.query('UPDATE orders SET extra_data = $1 WHERE id = $2', [JSON.stringify(value), row.id])
        migrated++
      }
    } catch (err) {
      failed++
      console.error(`  ! orders.extra_data ${row.id}: ${err.message}`)
    }
  }
  return { migrated, failed }
}

async function main() {
  console.log('Migrating local backend/uploads/* files to Azure Blob Storage...\n')

  console.log('customer_documents:')
  console.log(' ', await migrateCustomerDocuments())

  console.log('products.image_url:')
  console.log(' ', await migrateProductImages())

  console.log('orders.pod_url:')
  console.log(' ', await migrateOrderPodUrls())

  console.log('orders.extra_data (nested urls):')
  console.log(' ', await migrateOrderExtraData())

  console.log('\nDone. Local files under backend/uploads/ were left in place — verify the')
  console.log('migrated rows load correctly, then clear that folder manually if desired.')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
