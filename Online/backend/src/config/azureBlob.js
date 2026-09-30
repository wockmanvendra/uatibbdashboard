import { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } from '@azure/storage-blob'
import { ClientSecretCredential } from '@azure/identity'
import crypto from 'crypto'
import path from 'path'

const AZURE_STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT || ''
const AZURE_TENANT_ID       = process.env.AZURE_TENANT_ID || ''
const AZURE_CLIENT_ID       = process.env.AZURE_CLIENT_ID || ''
const AZURE_CLIENT_SECRET   = process.env.AZURE_CLIENT_SECRET || ''
const AZURE_CONTAINER       = process.env.AZURE_CONTAINER || ''
const SAS_EXPIRY_MINUTES    = Number(process.env.AZURE_SAS_EXPIRY_MINUTES) || 60
// Keeps local/dev testing out of the same folder tree as real production
// files within the one shared container.
const ENV_FOLDER            = process.env.NODE_ENV === 'production' ? 'production' : 'development'

// Documents/order attachments get a YYYY/MM/DD folder so they can be browsed
// (and lifecycle-managed) by upload date; products stay flat since there's
// no such need for the catalogue image set.
const DATE_PARTITIONED_CATEGORIES = new Set(['customers', 'orders'])

let blobServiceClient = null
let containerClientPromise = null
let delegationKey = null
let delegationKeyExpiresOn = null

// When Azure is genuinely unreachable at the network level (not just a bad
// credential), MSAL's own retry/backoff policy makes a single token
// acquisition take many seconds — and every document/POD/cheque-photo
// lookup on every incoming request would otherwise re-attempt that from
// scratch. Once a real attempt fails, short-circuit for a cooldown window
// instead of hammering the network again on every call; a success clears it
// immediately so it self-heals the moment Azure is reachable again.
const CIRCUIT_COOLDOWN_MS = 60_000
const NETWORK_TIMEOUT_MS = 5_000
let circuitOpenUntil = 0

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[azureBlob] ${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function guardedAzureCall(fn, label) {
  if (Date.now() < circuitOpenUntil) {
    throw new Error(`[azureBlob] skipping ${label} — Azure was unreachable recently, retrying after cooldown`)
  }
  try {
    const result = await withTimeout(fn(), NETWORK_TIMEOUT_MS, label)
    circuitOpenUntil = 0
    return result
  } catch (err) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS
    throw err
  }
}

function getBlobServiceClient() {
  if (blobServiceClient) return blobServiceClient
  if (!AZURE_STORAGE_ACCOUNT || !AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
    throw new Error('[azureBlob] AZURE_STORAGE_ACCOUNT, AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET must be set')
  }
  const credential = new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)
  blobServiceClient = new BlobServiceClient(`https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`, credential)
  return blobServiceClient
}

function getContainerClient() {
  if (!containerClientPromise) {
    containerClientPromise = guardedAzureCall(async () => {
      if (!AZURE_CONTAINER) throw new Error('[azureBlob] AZURE_CONTAINER must be set')
      const containerClient = getBlobServiceClient().getContainerClient(AZURE_CONTAINER)
      await containerClient.createIfNotExists() // no `access` option => private container
      return containerClient
    }, 'createIfNotExists').catch(err => {
      // Don't let a transient failure poison the cache forever — clear it so
      // the next call retries instead of replaying the same rejection.
      containerClientPromise = null
      throw err
    })
  }
  return containerClientPromise
}

function pad(n) { return String(n).padStart(2, '0') }

function datePrefix(date) {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

export function buildBlobName(category, originalName, date = new Date(), entityId = null) {
  const safeCategory = category || 'misc'
  const filename = `${crypto.randomBytes(8).toString('hex')}${path.extname(originalName || '')}`
  if (!DATE_PARTITIONED_CATEGORIES.has(safeCategory)) return `${ENV_FOLDER}/${safeCategory}/${filename}`
  const folder = entityId ? `${datePrefix(date)}/${entityId}` : datePrefix(date)
  return `${ENV_FOLDER}/${safeCategory}/${folder}/${filename}`
}

// Uploads a buffer under a fresh, category-scoped blob name and returns that
// name (not a URL — the container is private, so the name is what gets
// persisted in the DB and later turned into a short-lived SAS URL on read).
// entityId (the owning customer/order's own UUID) nests customer/order files
// one level deeper, under YYYY/MM/DD/<entityId>/ — products stay flat.
export async function uploadFile(buffer, originalName, mimetype, category, date = new Date(), entityId = null) {
  const blobName = buildBlobName(category, originalName, date, entityId)
  const containerClient = await getContainerClient()
  await containerClient.getBlockBlobClient(blobName).uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: mimetype },
  })
  return blobName
}

// User delegation SAS is the only option here since auth is an AAD service
// principal (tenant/client id/secret) — there's no account key to build a
// classic SAS from. The delegation key is valid up to 7 days; cache it and
// only refresh when it's about to expire.
async function getCachedUserDelegationKey() {
  const now = Date.now()
  if (delegationKey && delegationKeyExpiresOn && delegationKeyExpiresOn.getTime() - now > 5 * 60 * 1000) {
    return delegationKey
  }
  const startsOn = new Date(now - 5 * 60 * 1000) // clock-skew allowance
  const expiresOn = new Date(now + 7 * 24 * 60 * 60 * 1000)
  delegationKey = await guardedAzureCall(() => getBlobServiceClient().getUserDelegationKey(startsOn, expiresOn), 'getUserDelegationKey')
  delegationKeyExpiresOn = expiresOn
  return delegationKey
}

// Turns a stored blob name into a short-lived, read-only SAS URL. Returns
// falsy values (null/undefined/'') as-is, and passes already-absolute
// http(s) URLs through untouched (legacy rows from before this migration).
export async function getReadUrl(blobName, expiryMinutes = SAS_EXPIRY_MINUTES) {
  if (!blobName) return blobName
  if (/^https?:\/\//i.test(blobName)) return blobName

  const [key, containerClient] = await Promise.all([getCachedUserDelegationKey(), getContainerClient()])
  const blockBlobClient = containerClient.getBlockBlobClient(blobName)
  const sas = generateBlobSASQueryParameters(
    {
      containerName: AZURE_CONTAINER,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn: new Date(Date.now() + expiryMinutes * 60 * 1000),
    },
    key,
    AZURE_STORAGE_ACCOUNT,
  ).toString()

  return `${blockBlobClient.url}?${sas}`
}
