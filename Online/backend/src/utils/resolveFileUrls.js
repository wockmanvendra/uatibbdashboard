import { getReadUrl } from '../config/azureBlob.js'

// Azure connectivity issues (or any other getReadUrl failure) must never
// take down an entire orders/customers listing — one bad SAS-URL lookup
// used to reject the whole Promise.all and 500 the whole response even
// though the DB rows were fetched fine. Isolate failures per blob name.
async function safeGetReadUrl(blobName) {
  try {
    return await getReadUrl(blobName)
  } catch (err) {
    console.error('[resolveFileUrls] failed to resolve blob read URL:', err)
    return null
  }
}

// Mirrors the frontend's resolveUrlsDeep (frontend/src/lib/api.js) but runs
// server-side and actually generates the URL: any string found under a `url`
// key — however deeply nested (order extra_data, customer documents, …) —
// is treated as a stored Azure blob name and swapped for a live SAS link.
// On failure, `url` resolves to null and a sibling `urlUnavailable: true` is
// added so the frontend can distinguish "temporarily unavailable" from
// "nothing was ever uploaded" — these nested doc entries have no other
// durable identifier once `url` is overwritten in place.
export async function resolveUrlsDeep(value) {
  if (value instanceof Date) return value
  if (Array.isArray(value)) return Promise.all(value.map(resolveUrlsDeep))
  if (value && typeof value === 'object') {
    const entryGroups = await Promise.all(
      Object.entries(value).map(async ([key, v]) => {
        if (key === 'url' && typeof v === 'string') {
          const resolved = await safeGetReadUrl(v)
          return resolved === null ? [[key, null], ['urlUnavailable', true]] : [[key, resolved]]
        }
        return [[key, await resolveUrlsDeep(v)]]
      })
    )
    return Object.fromEntries(entryGroups.flat())
  }
  return value
}

// For columns that store a blob name directly (products.image_url,
// orders.pod_url) rather than under a `url` key. Callers already preserve
// the raw blob name separately (pod_blob_name, image_blob_name), so a
// failure here just resolves to null rather than throwing.
export async function resolveFileField(value) {
  return typeof value === 'string' ? safeGetReadUrl(value) : value
}

// products.image_url gets resolved into a short-lived SAS link for display,
// but the admin Product Master edit form needs the durable blob key back
// (image_blob_name) so re-saving a product without changing its image
// doesn't overwrite image_url with an expiring link.
export async function resolveProductRow(row) {
  if (!row) return row
  return { ...row, image_blob_name: row.image_url, image_url: await resolveFileField(row.image_url) }
}

export async function resolveProductRows(rows) {
  return Promise.all(rows.map(resolveProductRow))
}

// orders.* rows carry a direct pod_url column plus a freeform extra_data
// JSONB blob that can nest `url` fields (compliance docs, cheque photo) —
// resolve both in one pass. pod_blob_name preserves the durable key (see
// resolveProductRow above) so re-dispatching without a new POD file doesn't
// overwrite pod_url with an expiring SAS link.
export async function resolveOrderRow(row) {
  if (!row) return row
  const [pod_url, extra_data] = await Promise.all([
    resolveFileField(row.pod_url),
    resolveUrlsDeep(row.extra_data),
  ])
  return { ...row, pod_blob_name: row.pod_url, pod_url, extra_data }
}

export async function resolveOrderRows(rows) {
  return Promise.all(rows.map(resolveOrderRow))
}
