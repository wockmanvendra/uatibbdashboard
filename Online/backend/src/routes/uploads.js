import { Router } from 'express'
import multer from 'multer'
import { uploadFile, getReadUrl } from '../config/azureBlob.js'
import { isUuid } from '../utils/uuid.js'

const ALLOWED_CATEGORIES = new Set(['customers', 'orders', 'products'])
// customers/orders files nest under the owning record's own uuid (see
// azureBlob.js DATE_PARTITIONED_CATEGORIES) — entityId is required for these.
const ENTITY_SCOPED_CATEGORIES = new Set(['customers', 'orders'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png']
    cb(null, allowed.includes(file.mimetype))
  },
})

const router = Router()

// POST /uploads — accepts a single file in field "file" plus an optional
// "category" field (customers|orders|products, used to fold the blob into
// the right folder in Azure Blob Storage). For customers/orders, "entityId"
// (the owning customer/order's own uuid — client-generated ahead of the
// record's creation when it doesn't exist yet) is required, so files nest
// under .../YYYY/MM/DD/<entityId>/. Returns { url, blobName, originalName,
// size } — url is a short-lived SAS link, blobName is the durable value
// callers must persist (the container is private).
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No valid file received' })
    const category = ALLOWED_CATEGORIES.has(req.body.category) ? req.body.category : 'misc'
    const entityId = req.body.entityId
    if (ENTITY_SCOPED_CATEGORIES.has(category) && !isUuid(entityId)) {
      return res.status(400).json({ error: 'entityId (a valid UUID) is required for this category' })
    }
    const blobName = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, category, new Date(), isUuid(entityId) ? entityId : null)
    const url = await getReadUrl(blobName)
    res.status(201).json({ url, blobName, originalName: req.file.originalname, size: req.file.size })
  } catch (err) { next(err) }
})

export default router
