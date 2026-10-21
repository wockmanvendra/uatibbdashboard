# divperf-api

Node + TypeScript + Fastify API for the Division Performance dashboard.
Read `../ARCHITECTURE.md` first — it is the source of truth for both repos.

## Run

```bash
npm install
cp .env.example .env      # then fill in USER_DATABASE_URL and INFINITY_*
npm run db:schema         # create the sign-in tables and views
npm run infinity:sync     # pull the field structure from Infinity
npm run dev               # http://127.0.0.1:8787, reads .env
```

`USE_MOCK_DATA=true` serves generated data that satisfies the response
contract; `false` reads the warehouse (see `.env`).

## Data source

Two Synapse sources, mapped in `src/data/sqlFragments.ts`. Everything but credit
notes comes from `Infinity.Infinity_Reports` (`DASHBOARD_TABLE`):

| Figure | Column |
| --- | --- |
| Target / Dispatch / Collection | `BUDGET1` / `NET_SALES` / `-COLLECTION` |
| Gross sales (CN% denominator) | `GROSS_SALES` |
| Outstanding / Inventory | `OS` / `STOCK + GIT` — balances: a period's value is its **last month's**, never a sum of months |
| Secondary / RCPA | `secondary` / `RCPA_VALUE` |
| Division / Zone / Region / HQ / Brand / Month | `Division_Code` / `ZONE_CODE` / `REGION_CODE` / `SAP_Code` / `Brand` / `yearMonth` |

Credit notes come from `Infinity.VW_Credit_Note_Details` (`CN_TABLE`), by
`Division_Code` / `TERRITORY_CODE` (HQ) / `Product_code` / `yearMonth`:

| Figure | Column |
| --- | --- |
| Exp CN / SRCN / PD CN | `Breakage_Expiry` / `SalesReturn_CreditNote` / `PriceDifference_CreditNote` |
| Total CN | `Total_CreditNote` (always the sum of the three) |

The view has no zone, region or brand. Zone and region come from a territory
lookup over the sales table (each division + territory sits in exactly one zone
and region); a brand filter matches the products carrying that brand. The
Credit note tab's grids are by HQ and by SKU — the view has no stockist — and a
SKU is named by its brand, because the sales table's `MATERIAL_DESC` does not
match its product codes. `CR_NOTES` in the sales table is a different figure and
is not shown.

Credit notes start in Apr-2025, sales in Apr-2026. Every CN% counts only the
credit notes of the period's months that have sales (`meta.cnPctFrom..cnPctTo`,
from the first and last month with `GROSS_SALES`), so a period reaching back
past the sales does not set a year of credit notes against a few months of
sales. The CN values themselves still cover the whole period, and the card and
grids say which months the % covers.

Prescriptions come from the sales table too: Rxns = `RXN_TOT`, Rxber = `DR_TOT`
(Jan-2026 only so far). Rxber is counted per SKU, so a doctor writing several
SKUs counts once for each; for a period it is the average per month over the
months with Rx data, and P/D/M = Rxns ÷ Rxber over those months.

Attrition and new joiners come from the SAP HR views `Infinity.VW_Exit_Details`
and `Infinity.VW_Hiring_Details` (`HR_EXIT_TABLE`, `HR_HIRING_TABLE`), one row
per person. Cadre is `EMP_TYPE` (TM / RM / ZM = ZSM). A leaver counts in the
month of their `DOL`; a joiner in the month of `BEGDA` (the joining date).
Ageing is `DOL − DOJ`: under 6 months, 6 months to 1 year, over 1 year. The
views have no division, zone, region or HQ code — only a cost centre — so
`HR_DIVISION_COST_CENTRES` maps cost centres to divisions (85 = 1000EM68 "Emp
WTF", A5 = 1000EM75 "Emp Cost MIQNAF", confirmed against Infinity's field
structure), and the figures are whole-division only: a zone, region or HQ view,
a brand filter, or a division with no mapping shows the reason instead.

The dashboard's SQL login needs SELECT on every source; a grant on the schema
(`GRANT SELECT ON SCHEMA::[Infinity] TO …`) survives a table being rebuilt.

Both sources are zero-filled, so a measure with no non-zero value in the window
is returned as null (an em dash), not 0. Blank on purpose, until a source is
given: PCPM (no headcount), RCPA plan, collection by brand, and inventory below
division (stock is per plant). Each is explained in `meta.unavailable`.

Port 8787, not 8080 — 8080 is taken by another app on the current dev machine.

```bash
npm test          # needs the local PostgreSQL on 127.0.0.1:5432 (see below)
npm run typecheck
npm run build
```

## BU head sign-in — password accounts

BU heads are not in Infinity's field structure, so they have accounts of their
own in `dashboard_accounts` and sign in at `/login/bu-head` with a mobile number
and password — the D2D portal's staff (password) login:

- bcrypt hashes; 3 wrong passwords lock the account until it is unlocked;
- a new password is required at first sign-in and every 90 days (8+ characters,
  upper- and lower-case, a digit, a symbol);
- "Forgot password" sends a code by email (and SMS, where configured), shown on
  screen outside production, which unlocks the account and sets a new password;
- the token that sets a password is good for 15 minutes and one use, and is
  never accepted as a session;
- a BU head sees the divisions on the account, as an NSM sees theirs.

Accounts are managed from the command line (there is no admin screen):

```bash
npm run account -- add     --name "Name" --mobile 98XXXXXXXX --division 85[,A5] [--email a@b.com] [--empcode 123]
npm run account -- reset   --mobile 98XXXXXXXX   # new temporary password, unlocks
npm run account -- unlock  --mobile 98XXXXXXXX
npm run account -- disable --mobile 98XXXXXXXX   # enable to restore
npm run account -- update  --mobile 98XXXXXXXX [--name] [--email] [--division]
npm run account -- list
```

`add` and `reset` print a temporary password once; the user must replace it at
first sign-in. Every attempt is recorded in `login_history` with
`login_method = 'password'`.

## Sign-in — Infinity's field structure

Mobile number + OTP, the D2D portal's TM login flow, for the field force listed
in Infinity. Everything lives in the PostgreSQL database `sales_dash_user_db`
(`db/schema.sql`):

| Object | What it is |
| --- | --- |
| `infinity_division` | Divisions to pull, with Infinity's id for each. Seeded with `85` and `A5`; add a row per further division. |
| `field_structure_infinity` | Infinity's field structure, as the D2D portal keeps it. Filled by `npm run infinity:sync`. |
| `vw_emp_email_mobile`, `vw_tm_hierarchy`, `vw_infinity_users` | The D2D portal's views, unchanged. |
| `vw_dashboard_users` | One row per person: sign-in mobile, and scope. **Who may sign in.** |
| `login_otp`, `login_history` | Pending codes (as HMACs) and the audit of every attempt. |
| `infinity_sync_log` | One row per division per sync. |

`npm run infinity:sync` calls `{INFINITY_REPORT_BASE_URL}/filed-structure/{id}`
for each division (`-- --division 85` for one). Each division is replaced in one
transaction; an error, an empty response, or one under half the rows held keeps
the previous data (`-- --force` accepts a shrink). Run it on a schedule — a new
joiner can sign in, and a leaver is cut off within a minute, after the next sync.

Scope in `vw_dashboard_users` — someone under several roles gets the broadest:

| Role | Scope |
| --- | --- |
| TM | HQ — own SAP code (BZIRK) |
| RM | Region — own SAP code (VKGRP) |
| ZSM | Zone — own SAP code (VKBUR) |
| NSM | Division — `division_code` (SPART) |

- `POST /api/auth/otp/request` looks the mobile up in `vw_dashboard_users` and
  sends a 6-digit code by SMS and email (`SMS_*`, `SMTP_*`). The code expires
  after `OTP_EXPIRY_MINUTES` and can be re-sent after 30 s. Outside production
  it is also returned as `devOtp`. A number listed against two people, or a
  person with no territory, is refused with a reason.
- `POST /api/auth/otp/verify` allows five wrong guesses per code, uses the code
  up on success, and returns a session token carrying only the employee code.
- Both are limited to `AUTH_RATE_LIMIT` requests per IP per 15 minutes.

Every route except `/health`, `/ready`, `/api/auth/otp/*` and `/api/meta/flush`
needs `Authorization: Bearer <token>`. Production refuses to start without
`JWT_SECRET` or without an SMS or email channel.

Tests use a throwaway `sales_dash_user_db_test` on the local PostgreSQL, created
automatically; nothing in the test suite can reset a database not named `*_test`.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness. Never touches the database. |
| `GET /ready` | Readiness + warmup target. |
| `POST /api/auth/otp/request` | Send an OTP to a registered mobile. |
| `POST /api/auth/otp/verify` | Exchange the OTP for a session token. |
| `GET /api/meta/version` | Data version token the frontend polls (§4.9). |
| `GET /api/meta/filters` | Cascading, scope-filtered option lists. |
| `GET /api/meta/model` | Dimensions and measures, for the deferred chart builder (§13). |
| `GET /api/dashboard/:tab` | Every panel for a tab, in one response (I2). |
| `POST /api/meta/flush` | Cache flush; called at the end of the load pipeline. |

Tabs: `division-performance`, `brand-performance`, `zone-performance`,
`region-performance`, `hq-performance`, `credit-note`.

```bash
curl "http://127.0.0.1:8787/api/dashboard/division-performance?from=202604&to=202608&zone=JH"
```

## Layout

```
src/
  server.ts        fastify instance, plugin + route registration
  config.ts        the ONLY place process.env is read; fails fast
  types/api.ts     response contract — mirrored byte-for-byte in divperf-web
  plugins/         cache, scope (auth arrives at Phase 4)
  routes/          validate with zod, call a service, return. No SQL here.
  services/        orchestration; tabService fires panel queries in parallel
  cache/           CacheClient + Memory/Redis impls + key builders
  tabs/registry.ts which panels each tab renders
  lib/             yrmn (month maths), metrics (every derived formula), errors
tools/
  discover*.ts     read-only warehouse discovery. NOT part of the request path.
```

## Rules that are easy to break

- **I9 — the API never connects to Synapse.** Only `tools/` and the load
  pipeline authenticate to the warehouse. `config.ts` refuses to start if
  `SERVING_SQL_SERVER` contains a Synapse hostname.
  Verify: `grep -ri "synapse\|azuresynapse" src/` must return nothing.
- **I6 — every cache key carries a scope.** `scopeHash` is the first positional
  argument of every builder in `cache/key.ts`, and the builders throw if it is
  empty. Every producer of a `dash:v1:` key lives in that one file.
- **I3 — no aggregation in Node.** `lib/metrics.ts` computes ratios from sums;
  it does not sum. No `reduce` over fact rows anywhere.
- **I4 — derived metrics are computed at read time.** Store numerator and
  denominator, never the ratio.

## Dummy formulas

`lib/metrics.ts` carries formulas marked `DUMMY:` for metrics whose source or
definition is not yet settled — PCPM headcount, RCPA, secondary, and the CN
split. Each is a single expression, so each is a one-line swap. See
ARCHITECTURE.md §5.
