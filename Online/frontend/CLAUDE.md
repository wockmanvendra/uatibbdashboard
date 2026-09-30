# D2D — Direct to Customer Portal (frontend)

React 19 + Vite SPA (`package.json` name `DirectToCustomer`, page title "Direct To Customer") for browsing products, building orders with promotional schemes, and managing a cart. Routing via `react-router-dom` 7.

This is the `frontend/` half of a monorepo — see the root `CLAUDE.md` for the overall architecture, backend API, approval workflow, and auth flow.

## Commands (run from `frontend/`)

- `npm run dev` — start the Vite dev server (HMR)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run preview` — preview a production build

## Structure (paths relative to `frontend/`)

- `src/routes/AppRoutes.jsx` — route table; pages are wrapped in `MainLayout` (Navbar + `<Outlet/>`)
- `src/layouts/` — `MainLayout` shell
- `src/pages/` — route-level views (`Dashboard`, `ProductGallery`, `CartPage`), each with a co-located `.css`
- `src/components/` — shared/reusable UI (`Navbar`, `ProductCard`, `CartSummary`, `QuantityStepper`), each with a co-located `.css`
- `src/hooks/` — `useCartState` (internal cart state implementation — items, add/remove/update, derived totals — wrapped by `src/context/CartContext.jsx`, not called directly by pages)
- `src/registration/mockData.js` — unified static data layer: product catalog (`CATEGORIES`, `BRANDS`, `PRODUCTS`) merged with registration reference data (`CUSTOMER_TYPES`, `CFA_Master`, `PIN_CODE_DIRECTORY`, `DOCTORS`, `PHARMACIES`, `HOSPITALS`); all entities carry a `divisionCode` (`DIV-GRO`, `DIV-BEV`, `DIV-PCA`, `DIV-HCA`)
- `src/utils/` — `schemeCalculator.js` (`calculateSchemeBenefit`, `findBestScheme`), `currency.js` (`formatCurrency`, INR via `Intl.NumberFormat`)
- `src/styles/index.css` — global design tokens and shared layout/animation classes

## Design system — "Customer-facing online ordering portal" (in migration)

The app is mid-migration from an internal "distribution ledger" B2B aesthetic to a warmer, rounder **customer-facing online ordering portal** look. Global tokens in `frontend/src/styles/index.css` have already been updated to the new palette/fonts (so every page picks up the new colors/type immediately), and `/dashboard` (`Dashboard.jsx` + `Dashboard.css`) has been fully restyled as the pilot page. Other pages (Navbar, DetailPage, registration flow, etc.) still use the old "manifest/ticket" motifs and component shapes — and some of them hardcode `rgba(...)` tints based on the *old* hex values, so translucent badges/borders on those pages may look slightly mismatched until they're migrated too. Treat `/dashboard` as the reference for new work.

- **Palette** (CSS vars in `frontend/src/styles/index.css`): `--paper` (warm ivory #faf6ef) is the dominant surface, with `--paper-deep`/`--paper-line` for layered surfaces and borders. `--ink` (#1a1d21, plus `--ink-faint`) is unchanged and still carries text and high-contrast call-outs (dark `.benefit`/lightbox/`.cpicker__header` panels). `--steel` (emerald/teal #1f9d7c) / `--steel-deep` (#157a60) is the **primary "trust & health" brand color** — buttons, links, focus rings, prices, eyebrows, IDs. `--signal` (coral #ff6a45) / `--signal-deep` (#e0502b) is the **energetic call-to-action accent** — the highest-emphasis ordering action (e.g. "Place Order on Behalf of Customer"), deals/discount highlights, and destructive actions on hover. `--ok` (grass green #3fae6b) marks success/approved states
- **Type**: `--font-display: Fraunces` (warm variable serif for headings — use normal case, not uppercase), `--font-mono: JetBrains Mono` (order/customer IDs, codes, amounts), `--font-body: Public Sans` (body copy, labels, table headers) — all loaded via Google Fonts `<link>` tags in `index.html`. The old Anton/IBM Plex fonts are still loaded (un-migrated registration pages reference them directly)
- **Motifs (new, on `/dashboard`)**: rounded cards (12–20px radii) with soft layered shadows instead of hairline borders/offset-shadow tickets; pill-shaped status badges and tags with tinted backgrounds (`.aq__status*`, `.aq__row-tag`); a "greeting hero" banner (`.dashboard__hero`) with soft gradient-blob accents; pill CTA buttons with hover-lift; staggered reveal via the shared `@keyframes rise-in` animation (kept from the old system)
- **Motifs (old, pending migration)**: manifest/ticket cards (order tickets, cart rows), graduation-tick rules (`Navbar.css` `.navbar__hazard`), paper-grain texture backgrounds
- **Color discipline**: `--steel` (emerald) is the "always-on" brand/interactive color — reach for it first for anything clickable, focusable, or informational. `--signal` (coral) punctuates rather than dominates: the single most important ordering CTA, deal/discount highlights, and destructive actions on hover/confirm
- When adding UI, follow `/dashboard`'s new rounded/pill motifs and reuse the updated tokens — don't introduce additional palettes or fonts

## Conventions and gotchas

- **Currency**: always format money with `formatCurrency` from `frontend/src/utils/currency.js` (INR, `Intl.NumberFormat`) — don't hand-roll `₹` strings
- **Scheme math**: use `calculateSchemeBenefit(orderedQty, scheme)` from `frontend/src/utils/schemeCalculator.js` for any free-quantity/total-quantity derivation — don't duplicate the block-eligibility logic
- **Cart state**: lives in `src/context/CartContext.jsx` (`CartProvider` + `useCart()`), wired into `App.jsx`'s provider stack — promoted from a `ProductGallery`-local hook once the cart needed to survive navigation between `/products` and the dedicated `/cart` page; the underlying add/remove/update/totals logic (`useCartState` in `src/hooks/useCart.js`) is unchanged. `CartProvider` clears the cart when the logged-in user changes, since logout doesn't do a full page reload
- **JSX entities**: avoid HTML named entities for math symbols in JSX text (e.g. `&plus;`/`&minus;`) — Babel's JSX entity table is inconsistent (HTML4 vs HTML5 sets) and can render literal text instead of the symbol. Use literal Unicode characters (`+`, `−`) directly
- **Equal-height cards**: achieved via the flex-stretch chain `<li>` → `.product-card { flex: 1 }` → `.product-card__body { flex: 1; flex-direction: column }` → `.product-card__footer { margin-top: auto }`

## Verification

- **Do not use Playwright/Puppeteer or any browser-automation tool** — the user checks UI changes manually in the browser
- To sanity-check that edits compile, `cd frontend` then run the dev server (e.g. `npm run dev -- --port 5181 --strictPort`) and `curl` the changed source files through it, grepping for Vite/Babel error strings (`Internal server error`, `SyntaxError`, `Failed to parse`, `Pre-transform error`, `[plugin:vite`)
