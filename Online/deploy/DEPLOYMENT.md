# Production deployment (Linux + PM2 + Apache)

Topology: Express serves everything — the React SPA static files, every API
route under `/api`, and the unprefixed `/health` check. Apache sits in
front as a thin reverse proxy (forwarding all traffic to Node on
`127.0.0.1:3001`). Same pattern as Demo PG.

This runbook assumes frontend and backend share one origin. If you're
instead hosting the frontend separately (its own static host/CDN, or a
different domain/subdomain than the API), skip step 4/step 5's frontend
`DocumentRoot`-less serving and instead point that host's `VITE_API_URL`
build var at this backend's own public origin (e.g.
`https://api.yourdomain.com`) — and make sure `ALLOWED_ORIGINS` below
includes the frontend's real origin, since the requests become cross-origin.

One-time server prerequisites: Node.js (match the version you develop
against), PostgreSQL, Apache (`mod_proxy`, `mod_proxy_http`),
and PM2 (`npm install -g pm2`).

## 1. Get the code onto the server

```bash
git clone <repo-url> /var/www/d2d
cd /var/www/d2d
```

For later deploys, `git pull` here instead of re-cloning.

## 2. Database

Create the database/role, then apply the schema (see root `CLAUDE.md` —
the `db:schema` npm script doesn't exist, run `psql` directly):

```bash
createdb d2d_portal   # or via psql, as whatever role you'll use in PGUSER
psql -U d2d_app -d d2d_portal -f /var/www/d2d/backend/db/schema.sql
```

Run any `backend/db/migrate-*.js` files that have landed since the schema
was last applied, and `npm run db:seed` only if you actually want seed data
in production (it's idempotent, but it's sample/demo data — usually skip
this in prod).

## 3. Backend

```bash
cd /var/www/d2d/backend
npm ci --omit=dev
cp .env.production.example .env
# edit .env: PG*, JWT_SECRET (generate fresh, don't reuse dev's), SMTP_*,
# ALLOWED_ORIGINS / FRONTEND_BASE_URL / CCAVENUE_REDIRECT_URL /
# CCAVENUE_CANCEL_URL (your real domain), MOCK_PAYMENT=false + real
# CCAVENUE_* credentials once you're ready to take live payments
mkdir -p logs uploads
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed instructions once, so PM2 survives a reboot
```

Confirm it's actually up before wiring Apache to it:

```bash
curl http://127.0.0.1:3001/health
```

## 4. Frontend

```bash
cd /var/www/d2d/frontend
npm ci
npm run build   # outputs to frontend/dist; Express serves it directly
```

The built `frontend/dist` is served by Express — no Apache `DocumentRoot`
needed. Build before (re)starting PM2 so the SPA is always in sync with
the API.

## 5. Apache

```bash
cp /var/www/d2d/deploy/apache/d2d.conf.example /etc/apache2/sites-available/d2d.conf
# edit: ServerName -> your real domain
a2enmod proxy proxy_http
a2ensite d2d.conf
apachectl configtest
systemctl reload apache2

# add TLS once the plain-HTTP vhost is confirmed working:
certbot --apache -d yourdomain.com
```

## 6. Smoke test

- `https://yourdomain.com/` loads the SPA
- `https://yourdomain.com/health` returns `{"status":"ok",...}`
- Refresh a deep client-side route (e.g. `/dashboard`) — should NOT 404
- Log in, browse products, place a test order through to the approval chain
- If `MOCK_PAYMENT=false`, place one real low-value order to confirm the
  CCAvenue redirect/callback round-trip before relying on it

## Subsequent deploys

```bash
cd /var/www/d2d && git pull
cd frontend && npm ci && npm run build   # build first so new UI is ready
cd ../backend && npm ci --omit=dev && pm2 restart d2d-backend
# Apache picks up changes automatically — no reload needed
```
