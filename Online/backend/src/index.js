import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import path from 'path'
import { fileURLToPath } from 'url'

import { authenticate } from './middleware/auth.js'
import { authLimiter, uploadLimiter } from './middleware/rateLimit.js'

import authRouter           from './routes/auth.js'
import productsRouter       from './routes/products.js'
import customersRouter      from './routes/customers.js'
import ordersRouter         from './routes/orders.js'
import cfaRouter            from './routes/cfa.js'
import stateMasterRouter    from './routes/state-master.js'
import cfaStateMasterRouter from './routes/cfa-state-master.js'
import usersRouter          from './routes/users.js'
import mastersRouter        from './routes/masters.js'
import divisionConfigRouter from './routes/division-config.js'
import appConfigRouter      from './routes/app-config.js'
import divisionRulesRouter  from './routes/division-rules.js'
import divisionContactsRouter from './routes/division-contacts.js'
import customerOutstandingRouter from './routes/customer-outstanding.js'
import adminUserDetailsRouter from './routes/admin-user-details.js'
import adminRouter           from './routes/admin.js'
import overviewRouter        from './routes/overview.js'
import uploadsRouter        from './routes/uploads.js'
import bankMasterRouter     from './routes/bank-master.js'
import ccavenueRouter         from './routes/ccavenue.js'
import ccavenueCallbackRouter, { handleLiveCallback } from './routes/ccavenue-callback.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app  = express()
const PORT = process.env.PORT || 3001

// Behind the production Apache reverse proxy (see deploy/apache/), so
// req.ip / X-Forwarded-For and express-rate-limit need the proxy trusted.
// Harmless in dev, where there's no proxy and no such header.
app.set('trust proxy', 1)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())

app.use(helmet({ contentSecurityPolicy: false }))

app.use(express.urlencoded({ extended: true }))
app.use(express.json())

// CCAvenue's own redirect-back is a cross-site browser *navigation*
// (top-level form POST from test.ccavenue.com / secure.ccavenue.com), not a
// same-origin fetch/XHR — the browser still sends an Origin header on a
// cross-site POST, which would otherwise trip the CORS check below and get
// rejected by our own server before ever reaching the handler. So only this
// route is registered before app.use(cors) and never passes through it.
// CCAvenue posts back application/x-www-form-urlencoded, hence
// express.urlencoded() above (json() alone won't parse it).
app.post('/api/ccavenue/callback', handleLiveCallback)
app.get('/api/ccavenue/callback', handleLiveCallback)
app.post('/api/payment/payment-redirect', handleLiveCallback)  // legacy path already registered with CCAvenue's merchant account
app.get('/api/payment/payment-redirect', handleLiveCallback)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}))

// GET /link/:token (opened directly by the customer's browser) and POST
// /mock-callback (called via fetch from the SPA) are same-origin-checked
// browser requests, unlike /callback above — they need real CORS headers,
// so they're mounted here, after app.use(cors), not alongside it.
app.use('/api/ccavenue', ccavenueCallbackRouter)   // unauthenticated — customer payment links

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

app.use('/api/auth', authLimiter, authRouter)

// Everything mounted below this line requires a valid bearer token.
app.use(authenticate)

app.use('/api/products',      productsRouter)
app.use('/api/customers',     customersRouter)
app.use('/api/orders',        ordersRouter)
app.use('/api/cfa-locations', cfaRouter)
app.use('/api/state-master', stateMasterRouter)
app.use('/api/cfa-state-master', cfaStateMasterRouter)
app.use('/api/users',         usersRouter)
app.use('/api/masters',       mastersRouter)
app.use('/api/divisions',     divisionConfigRouter)
app.use('/api/app-config',    appConfigRouter)
app.use('/api/division-rules', divisionRulesRouter)
app.use('/api/division-contacts', divisionContactsRouter)
app.use('/api/customer-outstanding', customerOutstandingRouter)
app.use('/api/admin-user-details', adminUserDetailsRouter)
app.use('/api/admin',             adminRouter)
app.use('/api/overview',          overviewRouter)
app.use('/api/uploads',            uploadLimiter, uploadsRouter)
app.use('/api/bank-master',        bankMasterRouter)
app.use('/api/payment',            ccavenueRouter)   // /initiate, /create-link — authenticated

// Serve frontend — API routes live under /api (above) so they can't collide
// with the SPA catch-all below; everything else is a static asset or an
// SPA client-side route. Works in both dev (run `npm run build` first) and
// production.
const distDir = path.join(__dirname, '../../frontend/dist')
app.use(express.static(distDir))
app.get('*', (_req, res) =>
  res.sendFile(path.join(distDir, 'index.html'))
)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`D2D API listening on http://localhost:${PORT}`)
})
