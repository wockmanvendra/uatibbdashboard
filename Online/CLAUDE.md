# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

D2D ("Direct to Customer") is a pharma distribution ordering portal: field staff (TMs) register customers (doctors, doctor-pharmacies, hospitals, patients) and place orders on their behalf from a product catalogue with promotional schemes (buy-get-free, gifts). Both customer registrations and orders flow through a 2-step management approval chain before being finalized.

Monorepo layout:

```
D2D/
  frontend/   ← React 19 + Vite SPA
  backend/    ← Node.js / Express / PostgreSQL REST API
```

## Commands

### Frontend (run from `frontend/`)
- `npm run dev` — start the Vite dev server (HMR, default port 5173)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run preview` — preview a production build

### Backend (run from `backend/`)
- `npm run dev` — start the API with nodemon (port from `PORT` env, default 3001)
- `npm start` — start the API with plain node
- Apply schema: `psql -U postgres -d d2d_portal -f db/schema.sql` (the `db:schema` npm script points at a non-existent `db/schema.js` — run psql directly instead)
- `npm run db:seed` — idempotent seed (`ON CONFLICT ... DO UPDATE`) for users, TM hierarchy, CFA locations, products/schemes, and customers; requires the schema to already be applied
- Backend reads `backend/.env` (gitignored) for `PG*` connection vars, `PORT`, `ALLOWED_ORIGINS`, etc. — copy `backend/.env.development.example` for local dev or `backend/.env.production.example` for a production server, never both at once in the same checkout
- Frontend has no required env vars (`frontend/src/lib/api.js` always calls relative `/api/...`); `frontend/.env.development.example` / `.env.production.example` document this and are there for future overrides

## Deployment

Production target is a single Linux host: Apache serves the frontend build and reverse-proxies `/api`, `/uploads`, `/health` to the backend, which PM2 keeps alive on `127.0.0.1:3001` — see `deploy/DEPLOYMENT.md` for the full runbook, `deploy/apache/d2d.conf.example` for the vhost, and `backend/ecosystem.config.cjs` for the PM2 process definition.

## Architecture

### Frontend ↔ backend wiring
- The Vite dev server proxies `/api/*` → `http://localhost:3001` (`frontend/vite.config.js`), so the frontend calls relative `/api/...` paths and CORS is a non-issue in dev
- `frontend/src/lib/api.js` is the **single integration layer** — every backend call goes through its named exports (`auth`, `productsApi`, `customersApi`, `ordersApi`, `cfaApi`). It also owns the snake_case (DB/API) ↔ camelCase (frontend) transform via `transformProduct`, `transformCustomer`, `transformOrder` — don't hand-roll fetches or field-name conversions elsewhere

### Backend (`backend/`)
ESM throughout (`"type": "module"`).
- `src/index.js` — Express app entry; mounts one router per resource under `/api/*` (`auth`, `products`, `customers`, `orders`, `cfa-locations`); CORS origin allowlist comes from `ALLOWED_ORIGINS`
- `src/db/pool.js` — single shared `pg` Pool, configured from `PG*` env vars
- `src/routes/*.js` — thin handlers using raw SQL via `pool.query`; multi-statement writes are wrapped in `BEGIN`/`COMMIT`/`ROLLBACK` (e.g. placing an order inserts into `orders` plus every `order_items` row in one transaction)
- `db/schema.sql` — 9 tables: `users`, `cfa_locations`, `products`, `product_schemes`, `customers`, `customer_approvals`, `orders`, `order_items`, `order_approvals`
- `db/seed.js` — re-runnable seed; hashes passwords with bcrypt (`SALT_ROUNDS = 10`)

### Frontend (`frontend/`)
See `frontend/CLAUDE.md` for the full structure, design system, and UI conventions. Cross-cutting pieces relevant repo-wide:
- `src/context/` — `AuthContext` (session persisted to `localStorage`), `OrderingContext` (in-memory "ordering on behalf of" customer selection), `CustomersContext` / `OrdersContext` (API-backed: fetch via `customersApi`/`ordersApi` on mount, mutate through approve/reject/place actions)
- `src/data/workflow.js` — single source of truth for the approval workflow on the frontend; mirrors the `approval_status` values in `db/schema.sql`

### Approval workflow
Customer registrations and orders share one status machine in `approval_status`:
`pending-l1` → `approved-l1` → `approved`, or `rejected` at any step.
- Step 1 (`pending-l1` → `approved-l1`, "Field Management Approval"): approver roles `rm`, `zsm`, `nsm` — same for both orders and customers
- Step 2 (`approved-l1` → `approved`): `mm` approves orders ("Marketing Approval"); `dm` approves customers ("Distribution Approval")
- Every transition is recorded in `order_approvals` / `customer_approvals` (action, approver, timestamp)
- `getOrderStep(usertype)` / `getCustomerStep(usertype)` in `workflow.js` tell an approver's dashboard which status queue they own

### Auth
Two login flows, selected by `usertype` (14 roles total — see `frontend/src/utils/format.js`'s `USERTYPE_LABELS` for the canonical list):
- **OTP** (`POST /api/auth/otp/request`, `/api/auth/otp/verify`) — `patient`, `doctor`, `doctor-pharmacy`, `hospital`, `tm`, `rm`, `zsm`, `nsm`. Dev OTP is a fixed per-user value (`123456`) stored in `users.otp`
- **Password** (`POST /api/auth/password`, bcrypt) — `admin`, `super-admin`, `bu-head`, `cfa`, `mm`, `dm`. `admin`/`bu-head` accounts are division-scoped and must have a `division_code` to log in
- Both flows return a JWT (`signUserToken` in `backend/src/config/jwt.js`, `JWT_EXPIRES_IN`, default 6h) alongside the `{id, name, usertype, mobileno, ...}` user object; the frontend stores the token via `setAuthToken` (`frontend/src/lib/api.js`) and sends it as `Authorization: Bearer <token>` on every request. `AuthContext` persists the session (token + user) to `localStorage`. Backend routes gate access with an `authorize(...usertypes)` middleware

## Conventions and gotchas

- `frontend/src/data/users.js` is leftover mock auth data and is **not imported anywhere** — all auth goes through `/api/auth/*`
- CFA name/code mismatch: registration forms carry CFA as a display name (e.g. `'CFA Pune'`); `POST /api/customers` auto-resolves it to `cfa_code` (e.g. `'CFA-PNQ-02'`) via a `cfa_locations.cfa_name` lookup whenever the incoming value doesn't already start with `'CFA-'`
- `customers.extra_data` (JSONB) holds customer-type-specific fields (GST number, drug licence, PAN/Aadhaar, uploaded document metadata, etc.) — read via `customer.extraData` on the frontend
- Order line items: DB column `quantity` is exposed to components as `orderedQty` (via `transformOrderItem` in `src/lib/api.js`); each item also gets a synthetic `cartItemId: oi-${id}` for stable React keys

## Verification

- **Do not use Playwright/Puppeteer or any browser-automation tool** — the user checks UI changes manually in the browser
- To sanity-check that frontend edits compile: `cd frontend`, run the dev server (e.g. `npm run dev -- --port 5181 --strictPort`), then `curl` the changed source files through it and grep for Vite/Babel error strings (`Internal server error`, `SyntaxError`, `Failed to parse`, `Pre-transform error`, `[plugin:vite`)
- For backend changes: `cd backend && npm run dev`, then `curl` the relevant `/api/...` endpoint directly
