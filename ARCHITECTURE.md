# Division Performance Dashboard — Build Specification

A Power BI–style sales performance dashboard for a pharma division, replacing an
existing Excel report. React frontend + Node API.

Data lives in **Azure Synapse Analytics**, which is the batch warehouse and
source of truth. The API does **not** query Synapse — it reads pre-aggregated
tables from a small Azure SQL serving database, fronted by Redis. §4.0 explains
why this two-tier split is mandatory rather than optional.

**Primary requirement is latency.** Every design decision in this document exists
to serve sub-100 ms filter and tab interactions. Where a choice trades developer
convenience for speed, speed wins.

---

## 0. How to use this document

This is the source of truth for both repos. Read it fully before writing code.

**Rules for the implementing agent:**

1. Build in the phase order given in §10. Do not skip ahead. Each phase has
   acceptance checks in §11 — verify them before moving on.
2. Anything marked `PENDING` is not yet supplied by the user. **Do not invent
   schema, column names, or DDL.** Stop, state what is missing, and ask.
3. The invariants in §3 are not suggestions. If a task appears to require
   breaking one, stop and raise it rather than working around it.
4. Keep this file updated as decisions are made. When a `PENDING` item is
   resolved, replace it with the answer inline.
5. Do not add dependencies not listed in §7.1 / §8.1 without asking.

Place a copy of this file at the root of both repositories.

---

## 1. What we are building

A multi-tab web dashboard showing division/brand sales performance, driven by a
month-range selection and a cascading set of hierarchy filters.

**Users:** division heads, zonal managers (ZSM), regional managers (RSM), area
managers (ASM). Used in monthly review meetings, frequently projected. Each user
sees only their slice of the hierarchy.

**Filters (global, apply to every tab):** Division, Brand, Zone, Region, HQ,
Period From, Period To.

**Tabs (v1):**

| Tab | Panels |
| --- | --- |
| Division Performance | Primary (Tgt/Coll/Disp with Value, Ach%, Gr%), PCPM, Secondary, RCPA, Key Brands table, CN & O/S, 4 trend charts, 4 mix pies |
| Brand Performance | Same metric set, grain = brand |
| Zonal / Regional / HQ Performance | Same KPI band plus a 14-column geo grid; one engine, three grains |
| Credit Note | CN split by type, stockist and SKU level |

The source workbook (`Dashboard format for field force.xlsx`) carries eight
sheets. `Div Perf`, `Zonal Perf`, `Region Perf.` and `HQ Perf` are the four
above — Zonal/Region/HQ are the *same* grid at three grains, which is exactly
what the tab registry in §8.5 exists to express. The remaining four sheets are
**out of scope for v1** because none of their data exists in the primary view:

| Sheet | Needs | Status |
| --- | --- | --- |
| `Deviation` | HQ profitability, breakeven PCPM, top/bottom 20% TMs | needs headcount + a PCPM breakeven figure |
| `Effort` | Doctor calls, coverage, call average, field days | no source |
| `Mktng` | Email/WhatsApp campaigns, NJC/PEP/RTM/CME | no source |
| `Attrition` | TM/RM/ZSM leavers with ageing | no source (HR system) |

Tabs share ~80% of their layout and all of their filter state. Build one tab
engine driven by config, not four hand-written pages.

**Deferred (v2, do not build now):** user-defined charts. §13 lists only the
decisions that must be made now to keep it cheap later.

---

## 2. Repositories

Two independent repos, deployed separately.

```
divperf-api/     Node + TypeScript. Fastify. Talks to Azure SQL + Redis.
divperf-web/     React + TypeScript. Vite. Talks only to divperf-api.
```

The frontend never talks to Azure SQL. There is no direct DB access from the
browser and no connection string in any frontend file or env var.

Shared types are duplicated by hand in v1 (a single `types/api.ts` in each repo,
kept identical). Do not set up a monorepo or a published package for this yet —
it adds CI complexity for little gain at two repos.

---

## 3. Architectural invariants

These are the load-bearing rules. Violating any one of them will cost the
latency target.

**I1. Rows never leave the database.** The API returns aggregates only. No
endpoint returns fact-level rows to the browser. The largest v1 response is a
few hundred rows (the Key Brands table).

**I2. One HTTP request per tab, not per panel.** A tab endpoint returns every
panel for that tab in one JSON object. The panel queries run in parallel
server-side.

**I3. All aggregation happens in SQL.** No `reduce`, `groupBy`, or summing in
Node or in React. Node shapes and serializes; it does not compute.

**I4. Derived metrics are computed at query time, never stored.** `Ach%`, `Gr%`,
and `PCPM` are ratios and do not aggregate. Summary tables store only additive
sums. See §5.

**I5. Every query is scoped server-side.** The role scope predicate is applied
in the data layer, not in a route handler and never in the frontend. A request
cannot widen its own scope through any parameter.

**I6. Cache keys include the scope identifier.** A cache key without scope will
serve national numbers to an area manager. This is the single highest-severity
bug available in this codebase.

**I7. Closed months are immutable.** Any period ending before the current
open period can be cached indefinitely. Only the open month needs freshness.
This asymmetry is exploited in both the server cache and the client cache.

**I8. `YR_MN` (int, e.g. `202508`) is the month key everywhere.** Frontend state,
API params, cache keys, and the leading column of every summary table index. Do
not derive months from `TDATE` at query time, and do not pass date strings.

**I9. The API never connects to Synapse.** Synapse is reached only by the
scheduled load pipeline. The API has one connection string and it points at the
serving database. A Synapse connection string appearing anywhere in
`divperf-api` is a defect, not an optimisation.

**I10. Redis is mandatory, not deferred.** With a batch-refreshed serving tier
and a data version token, cache hit rates will exceed 90%, and the cache is what
absorbs concurrent review-meeting load. Build against the `CacheClient`
interface from Phase 2 and wire Redis in Phase 3.

---

## 4. Data layer

**As built (2026-09-29): one source table.** Every dashboard figure now comes
from `Infinity.Infinity_Reports` in the same Synapse database
(`WH_SAPDataAnalytics`) — sales, target, collection, credit notes, outstanding,
stock, secondary and RCPA, by `Division_Code` / `ZONE_CODE` / `REGION_CODE` /
`SAP_Code` (HQ) / `Brand` / `yearMonth`. The sources described below —
`eflash.VW_SALES_PRIMARY_ALL_HIST_AZURE`, `dbo.All_EmployeeData`,
`dbo.RCPA_New`, `dbo.SecondaryData_test` — are no longer read. The column
mapping is in `divperf-api/src/data/sqlFragments.ts`. What the table lacks is
left blank with a reason: PCPM (no headcount), RCPA plan, the CN split,
collection by brand (customer-level), and inventory below division
(plant-level). Its sales measures start at Apr-2026, so sales growth is blank
until a prior year exists; secondary starts Apr-2025. Sales and secondary name
some products differently (`WOSULIN CTG` vs `WOSULIN CART`), so brand-level
secondary does not line up with brand-level sales.

### 4.0 Two-tier architecture — read this first

**The warehouse is Azure Synapse Analytics. Synapse is not the serving layer for
this dashboard, and must not be queried from the API.**

This is the single most important structural decision in the document. Synapse
(dedicated SQL pool) is a massively parallel batch warehouse. Its per-query
overhead floor is roughly 0.5–2 seconds even for a query returning one row,
because every statement is compiled into a distributed plan and coordinated
across 60 distributions. No amount of indexing removes that floor. A 100 ms
dashboard cannot be built on top of it.

Worse, dedicated pools meter **concurrency slots**, not connections:

| Service level | Max concurrent queries | Concurrency slots |
| --- | --- | --- |
| DW100c | 4 | 4 |
| DW200c | 8 | 8 |
| DW300c | 12 | 12 |
| DW500c | 20 | 20 |
| DW1000c | 32 | 40 |

A single tab load firing 14 panel queries in parallel would saturate a DW500c
pool by itself. Two managers opening the dashboard at the same time on DW100c
would queue. This alone rules Synapse out as an interactive backend.

**Therefore:**

```
Synapse dedicated SQL pool        →  source of truth + batch aggregation
   (fact tables, heavy ELT)          runs on a schedule, never user-facing

Azure SQL Database (serving)      →  the agg_* summary tables only
   (small: GP 2 vCore or S1)         this is the ONLY database the API queries

Redis                             →  response cache in front of the serving DB
```

The summary tables are a few thousand rows and a few MB. They fit comfortably in
the smallest useful Azure SQL tier, which costs a fraction of the Synapse pool
and answers a filtered aggregate query in 5–20 ms.

Redis is **required** in this architecture, not deferred as it would have been
against a plain Azure SQL source. See the revised §10 phasing.

**RESOLVED 2026-08-11 — dedicated SQL pool, confirmed by measurement.**
`SERVERPROPERTY('EngineEdition')` returns **6** (Synapse dedicated SQL pool);
`@@VERSION` reports `Microsoft Azure SQL Data Warehouse - 10.0.38605.0`.
`sys.database_service_objectives` is not exposed to the analytics login, so the
DWU level and any pause schedule are still unknown — ask the platform team.

The latency floor in this section is no longer an estimate. Measured against
this pool with the read-only analytics login:

| Query | Time |
| --- | --- |
| `SUM(NET_SALES)` for one division, one month (1 row out) | **1657 ms** cold, **986 ms** warm |
| Division rollup over a 5-month range (9 rows out) | **1838 ms** |
| `COUNT(*)` + `MIN/MAX(YR_MN)` | **22015 ms** |
| 12 × `COUNT(DISTINCT …)` across the hierarchy | **32907 ms** |

A single one-row aggregate costs ~1 s. A tab firing 14 panel queries against
this pool cannot meet a 100 ms target by any margin, and would also contend for
concurrency slots with whatever else uses the warehouse. The two-tier split is
therefore mandatory as written.

### 4.1 Source

Current source of primary sales, in Synapse:

```
[eflash].[VW_SALES_PRIMARY_ALL_HIST_AZURE]     -- a VIEW, ~1.2M rows
```

Known columns:

```
YR_MN, TDATE, SPART, DIV_NAME, WERKS, PLANT, VKBUR, ZONE_NAME,
VKGRP, REGION_NAME, BZIRK, TERRITORY_NAME, MATNR, MAKTX, BRAND,
CUSTOMER, CUST_NAME, ORDERS, ORDERS_QTY, GROSS_SALES, GROSS_SALES_QTY,
CR_NOTES, CR_NOTES_QTY, NET_SALES, NET_SALES_QTY, BUDGET, BUDGET1,
COLLECTION, COLLECTION_MATERIAL, OS, STOCK, GIT, STOCK_QTY, GIT_QTY,
TIMESTAMP
```

Hierarchy mapping:

| Level | Code column | Name column |
| --- | --- | --- |
| Division | `SPART` | `DIV_NAME` |
| Zone | `VKBUR` | `ZONE_NAME` |
| Region | `VKGRP` | `REGION_NAME` |
| HQ / Territory | `BZIRK` | `TERRITORY_NAME` |
| Material | `MATNR` | `MAKTX` |
| Brand | `BRAND` | — |
| Customer | `CUSTOMER` | `CUST_NAME` |

**PARTIALLY RESOLVED 2026-08-11.** Actual shape, measured:

- **1,271,681 rows**, months **202304–202608**, 29 distinct months.
- **`YR_MN` is `nvarchar(24)`, not an int**, and `TDATE` is `nvarchar(8)`
  (`'20230401'`). Invariant I8 still holds downstream — the load pipeline casts
  `YR_MN` to `int` exactly once, on the way in — but nothing may assume the
  source column is numeric.
- Every measure column is `DECIMAL(38,18)`. That is far wider than the data
  needs and wastes grant memory on every aggregate; the model narrows money to
  `DECIMAL(18,2)` as §4.5 already specifies.
- Name columns are `nvarchar(100)`, codes `nvarchar(2)`–`nvarchar(50)`,
  `MATNR` is `nvarchar(100)`, `TIMESTAMP` is `datetime2`.

`PENDING: view definition.` Still unresolved — `sys.sql_modules` returns no rows
for this object under the analytics login (no `VIEW DEFINITION` permission), so
whether it joins or unions physical tables cannot be read from the catalogue.
**However, the row shape proves it is a UNION of five feeds at different
grains** (see §4.3), which is the answer that actually matters for the ELT.
Ask a DBA to run `sp_helptext` if the exact text is needed.

**The month coverage has a 12-month hole.** Months present:

```
202304 … 202503   (24 consecutive months)
        ← 202504–202603 ENTIRELY ABSENT (12 months)
202604 … 202608   (5 months; 202608 is the open month, ~1/3 loaded)
```

This is not a rounding detail. `Gr%` compares against the same window one year
earlier, so **every month of FY26-27 has no prior-year window** and every growth
figure in the current fiscal year renders `—`. Either FY25-26 was never loaded
into this view or it lives somewhere else. This needs a business answer before
the dashboard is shown to managers, who will otherwise read the em dashes as a
bug in the tool.

### 4.2 Synapse-specific constraints

These differ from Azure SQL and will silently produce wrong or slow results if
ignored.

**Columnstore is the wrong choice at this row count.** Microsoft's own guidance:
use a clustered index or heap for tables under ~60 million rows. With 1.2M rows
across 60 distributions you get ~20,000 rows per distribution — far below the
1,048,576-row rowgroup threshold, so a clustered columnstore index produces tiny,
inefficient rowgroups and performs worse than a rowstore index.

> This reverses the columnstore recommendation that applies to Azure SQL. Use
> `CLUSTERED INDEX` on the Synapse fact table, not `CLUSTERED COLUMNSTORE INDEX`.
> Revisit only if the fact table passes ~60M rows.

**Do not partition the fact table.** Same arithmetic. Partitioning by month would
split 20,000 rows per distribution across dozens of partitions, making every
rowgroup useless. Filter on an indexed `date_key` instead.

**Distribution strategy.**

```sql
-- Dimensions: small, joined constantly → REPLICATE
WITH (DISTRIBUTION = REPLICATE, CLUSTERED INDEX (<key>))

-- Fact: at 1.2M rows, ROUND_ROBIN is acceptable and avoids all skew risk
WITH (DISTRIBUTION = ROUND_ROBIN, CLUSTERED INDEX (date_key, division_key))
```

Do **not** hash-distribute on `date_key`. With only ~24–60 distinct months, most
of the 60 distributions would sit empty and a few would hold everything. If the
fact table later grows past ~50M rows, switch to `HASH(customer_key)` or
`HASH(material_key)` — high cardinality, evenly spread, and never the column
you filter a single value on.

**Statistics are not automatic and their absence is the most common cause of slow
Synapse queries.** Create statistics on every column used in a join, filter, or
`GROUP BY`, and refresh them after each load:

```sql
CREATE STATISTICS stat_fact_date  ON fact_sales_primary (date_key);
CREATE STATISTICS stat_fact_div   ON fact_sales_primary (division_key);
CREATE STATISTICS stat_fact_geo   ON fact_sales_primary (geo_key);
CREATE STATISTICS stat_fact_brand ON fact_sales_primary (brand_key);
-- after every load:
UPDATE STATISTICS fact_sales_primary;
```

Also enable auto-create as a safety net:
`ALTER DATABASE <db> SET AUTO_CREATE_STATISTICS ON;`

**No constraint enforcement.** Dedicated pools do not support foreign keys,
unique constraints, or check constraints (`PRIMARY KEY NONCLUSTERED NOT ENFORCED`
is metadata only). Every integrity rule — surrogate key uniqueness, no orphan
dimension keys, no duplicate fact rows — must be enforced in the ELT and
verified by a post-load validation query. Do not assume the database will catch
a double-load.

**No `IDENTITY` for surrogate keys** in the usual sense. Generate keys with
`ROW_NUMBER() OVER (ORDER BY ...)` during a CTAS dimension rebuild, or use a
hash of the natural key. Whichever you pick, keys must be **stable across
reloads** — a dimension rebuild that reassigns keys invalidates every summary
table silently.

**Use CTAS, not `INSERT ... SELECT`.** `CREATE TABLE AS SELECT` is the fastest
bulk pattern in Synapse and lets you set distribution and index in one statement.
Build to a `_new` table, then swap with `RENAME OBJECT`.

**Result set caching** can be enabled and helps repeated identical queries:
`ALTER DATABASE <db> SET RESULT_SET_CACHING ON;`. Treat it as a minor bonus for
the ELT and ad-hoc analysis, not as part of the serving path — it is invalidated
by any change to underlying data and does not help across different filter
combinations.

**Resource classes.** Run the ELT under `largerc` or a `staticrc40`-style
workload group so aggregate builds get enough memory, and never under
`smallrc` — an under-resourced CTAS spills to disk and takes minutes.

### 4.3 Known data quality issues

These must be handled explicitly. Do not let them fail silently.

**The view is a UNION of five feeds at different grains. This is the single most
important thing to know about the source.** Measured 2026-08-11 by grouping on
which key columns are populated:

| MATNR | CUSTOMER | TDATE | Rows | Measures carried |
| --- | --- | --- | --- | --- |
| set | set | set | 755,319 | `GROSS_SALES`, `CR_NOTES`, `NET_SALES` + qtys |
| set | — | — | 200,878 | `STOCK`, `GIT`, **`BUDGET1`** |
| — | set | — | 193,390 | **`OS`** |
| — | set | set | 121,885 | **`COLLECTION`** |
| — | — | — | 209 | **`BUDGET`** |

The feeds are disjoint: a row carrying sales carries zero collection, and vice
versa. Consequences that change what the dashboard can show:

- **Collection and O/S have no brand or material grain** — they are
  customer-level. The Excel's Key Brands table has a `Coll` column and the mix
  pies include a Coll donut; neither is derivable from this source. Confirmed:
  grouping by `BRAND IS NULL` gives `collection = 0` for every row where a brand
  is set.
- **Target (`BUDGET1`) has no customer grain**, which is fine — it is needed per
  brand and per territory, and it has both.
- The nulls below are therefore **structural, not dirty data**. Do not "fix"
  them; resolve each feed to its own fact table at its own grain, exactly as
  §4.4 already prescribes, and let the aggregates join on shared dimension keys.

**`BUDGET` vs `BUDGET1` — RESOLVED, use `BUDGET1`.** (§12 Q3)
`BUDGET` totals ~4,000–6,000 per month across all 11 divisions and exists on
only **209 rows in the entire view, with no dimension keys at all** — no
material, no customer, no territory. It cannot be a money target against
~₹45 Cr/month of sales, and it is not integral so it is not a headcount either
(observed values include 503.92, 554.28, 42.27). `BUDGET1` totals
₹20–49 Cr/month, sits at material grain, and yields Ach% in a plausible 66–99%
band. Ach% is wired to `BUDGET1`; `BUDGET` is ignored until someone explains it.

**Sign conventions — RESOLVED.** `COLLECTION` is stored as a credit: 115,238
negative rows against 1,504 positive. It must be negated on load so every
downstream measure is a positive magnitude. `OS` is a genuine signed ledger
balance (94,732 negative / 98,638 positive) and is summed as-is. `CR_NOTES` is
positive on all but 10 rows.

**`GROSS_SALES − CR_NOTES = NET_SALES` exactly**, to the paisa, in every month
tested. See §5 for what that means for "Disp".

**Null dimensions.** Sample rows show `TDATE`, `MATNR`, and `MAKTX` all null on
the same row. A null in a `GROUP BY` column creates a phantom bucket; a null in a
filtered column silently drops the row and the dashboard stops tying to the ERP.

Measured null counts (of 1,271,681 rows):

```
BRAND           316,740  (24.9%)     TERRITORY_NAME   78,860  (6.2%)
MATNR           315,484  (24.8%)     REGION_NAME      74,819  (5.9%)
TDATE           394,477  (31.0%)     VKBUR/ZONE_NAME  48,314  (3.8%)
CUSTOMER        201,087  (15.8%)     VKGRP            47,042  (3.7%)
WERKS           153,851  (12.1%)     BZIRK            46,885  (3.7%)
SPART/DIV_NAME        0  (0%)        YR_MN                 0  (0%)
```

Most of the BRAND/MATNR/CUSTOMER/TDATE nulls are the grain-mixing above, not
data quality. The ~47k rows with **no geography at all** are the real unassigned
population and are what the `-1` / "Unassigned" key and the UI footer count are
for.

Rule: every dimension key is `NOT NULL` in the physical model. Unmapped source
values resolve to a reserved `-1` surrogate key whose display name is
`"Unassigned"`. The load pipeline counts these per column and writes the counts
to `etl_load_log`. Surface the count in the UI footer when non-zero.

> **`ISNULL()` is not sufficient — the codes are blank strings as well as nulls.**
> Found during reconciliation, 2026-08-11. `VKBUR` is a blank string (not null)
> on 162 rows, and **those 162 rows carry ₹27.89 Cr of outstanding**. For MERIND
> Apr–Aug 2026 that is 14 rows holding ₹27.79 Cr — **57% of the division's
> entire O/S**. A zone grid built with `ISNULL(VKBUR, 'Unassigned')` puts them in
> a separate blank-named bucket that looks like a rendering glitch, and the O/S
> column silently fails to tie to the division total.
>
> Every dimension resolution must therefore be
> `NULLIF(LTRIM(RTRIM(col)), '')` before the `-1` lookup, not `ISNULL(col, …)`.
> Blank-string counts across the view: `VKBUR` 48,476 · `VKGRP` 47,204 ·
> `BZIRK` 47,032 · `BRAND` 316,740 · `MATNR` 315,484 · `CUSTOMER` 201,087
> (these totals include the nulls).

**Inventory has no geography.** `STOCK` and `GIT` sit exclusively on rows whose
`VKBUR` is null — they are plant-level, not territory-level. Confirmed: for
MERIND Apr–Aug 2026, null-zone rows carry the entire ₹46.84 Cr stock and
₹8.39 Cr GIT, and every populated-zone row has zero stock.

Consequence: the **Inventory Value column in the Zonal / Regional / HQ grids is
not derivable from this source.** It is correct only at division level (and at
brand level, since those rows do carry `MATNR`). Either accept an "Unassigned"
row holding all inventory, or allocate it by a rule the business defines. It is
currently served by the mock layer and marked `DUMMY`.

Because Synapse enforces no constraints, add an explicit post-load check that
fails the pipeline if any fact row carries a dimension key absent from its
dimension table.

**Zone/Region inconsistency — CONFIRMED, and worse than a naming quirk.**
The user has confirmed the intended hierarchy is a strict tree:
**Division → Zone → Region → Territory (HQ)**. The source does not honour it.

Measured 2026-08-11:

- **80+ region codes appear under more than one zone.** Examples:
  `SNB / SSD AMBALA` under both `SSD - NORTH` and `DELHI`; `SSO / HYDERABAD - 1`
  under both `SSD - BANGALORE` and `HYDERABAD`; `JLA / AGRA` under both
  `MER2 - LUCKNOW` and `MER2 - DELHI`.
- **HQ codes appear under up to 16 different regions** (`DECDAN`: 16;
  `M2BHUB / MER BHUBANESHWAR`: 6; several at 4–5).
- **Product names appear in geography columns.** `SPASMO PROXYVON PLUS 8C` is
  present as both a `VKGRP` (region code) and a `BZIRK` (HQ code) value across
  10 zones, with a null `REGION_NAME`. `DECDAN` likewise appears as a `BZIRK`.
- Code and name cardinalities do not agree: 374 distinct `VKGRP` against 163
  distinct `REGION_NAME`; 768 `BZIRK` against 450 `TERRITORY_NAME`.

So the guidance in this section stands and is now mandatory rather than
precautionary: build `dim_geo` keyed on the **observed combination**
`(VKBUR, VKGRP, BZIRK)`, not on `BZIRK` alone. Keying on HQ alone will silently
merge territories that belong to different regions and the rollups will not tie.

`PENDING: business decision.` Someone must decide whether these are (a) genuine
re-assignments over time, which means `dim_geo` needs an effective-dated
version, or (b) master-data errors to be fixed at source. The product names in
geography columns are unambiguously (b).

**`MATNR` is an 18-char zero-padded varchar** (`000000000000503868`). Never join,
group, or index on it. It becomes a display attribute on `dim_material`; joins
use the integer surrogate key. In Synapse this matters more than usual — wide
varchar join keys inflate shuffle volume.

**`BUDGET` vs `BUDGET1`.** Resolved above — `BUDGET1` is the target. `Ach%` is
wired to it.

**Cardinalities** (for aggregate sizing, §4.6): 11 divisions, 98 zones,
374 regions, 768 HQs, 110 brands, 437 materials, 5,891 customers, 30 plants.
`agg_hq_brand_month` comes to **108,248 rows** — comfortably inside the ~500k
ceiling, so that table can be built as designed.

### 4.4 Missing sources — LOCATED 2026-08-12

The Excel report needs data not present in the primary sales view. Three of the
four sources have now been found **in the same database**, and the join path to
the SAP hierarchy is confirmed working.

| Need | For | Source | Status |
| --- | --- | --- | --- |
| TM headcount by month + territory | PCPM denominator | `dbo.RCPA_New` + `dbo.All_EmployeeData` | **FOUND** |
| Secondary sales | Secondary panel, Sec Gr% | `dbo.SecondaryData_test` | **FOUND** |
| RCPA actual | RCPA panel + trend chart | `dbo.RCPA_New` | **FOUND** |
| RCPA *plan* | RCPA Ach% | — | still missing |
| CN split (Exp / SRCN / PD) | Credit Note panel + stacked chart | — | still missing (Excel from distribution) |

Note: the DBA's `Infinity.VW_RCPA_DATA` references `Infinity.RCPA_Rupal` and
`Infinity.RCPA_2526`; that schema does not exist in `WH_SAPdataAnalytics`. The
equivalent base tables live in `dbo`.

#### 4.4.1 The territory bridge — `dbo.All_EmployeeData`

The field-force systems key on employee and on field-force HQ names
("Bangalore 1", "LUCKNOW 1"); the sales view keys on SAP codes (`M2BGLP`).
They do not join directly — `RCPA_New.hq` matches **0** of 768 `BZIRK` values.
`All_EmployeeData` is the bridge, and it resolves the whole hierarchy:

```
RCPA_New.employeeCode -> All_EmployeeData.empCode
                          .sapCode          -> VW_SALES.BZIRK   (HQ)
                          .manager1SapCode  -> VW_SALES.VKGRP   (Region)
                          .manager2SapCode  -> VW_SALES.VKBUR   (Zone)
                          .empJobRole       -> 'TM' | 'RM' | 'ZSM'  (headcount)
```

Master contents: **556 TM, 92 RM, 24 ZSM**, 446 distinct `sapCode`, of which
**315 match `BZIRK`**. End to end, **454 of 620 (73%) of RCPA TMs reach a sales
territory**. Verified against MERIND Jan-2026, which resolves to real codes
(`M2GUWP` Guwahati, 3 TMs, ₹18.27 L RCPA; `M2BGLP` Bangalore, 2 TMs, ₹11.81 L).

Handle when building the mapping:
- `manager1SapCode` is sometimes comma-separated (`'WKI,WKC'`) or blank.
- 156 RCPA TMs are absent from the master; they must fall to the `-1`
  "Unassigned" territory rather than being dropped, or the rollups stop tying.
- `activeFrom` / `activeTo` exist, so headcount can be point-in-time. Without
  them a leaver still counts, which inflates the PCPM denominator.

#### 4.4.2 `dbo.RCPA_New`  (1,915,398 rows, 2024-01-01 to 2026-08-11)

`activityDate` is ISO (`2026-03-14`) — parse with style 23/120, **not** 103.

| Column | Feeds |
| --- | --- |
| `value` | RCPA actual |
| `compValue` | competitor value -> MS% |
| `rxn` | Rxns; with `doctorCode` gives Rxbers and P/D |
| `doctorCode`, `speciality`, `classification` | the Effort sheet |
| `employeeCode` + `jobTitle` | TM headcount (PCPM denominator) |

`classification` is a mixed taxonomy today — `One/Two/Three/Five/Six` alongside
`A/B/C` and `New`. The Excel notes "Categories will be changed to A+, A, B, C",
so this needs a business mapping before the Effort tab is built.

**Currency warning:** coverage is uneven by division. MERIND stops at **202601**
while other divisions run to 202608. Sales and RCPA therefore have
*complementary* gaps for MERIND — sales has Apr–Aug 2026, RCPA does not; RCPA
has FY25-26, sales does not. The UI shows RCPA with an "as of" month rather than
silently comparing Aug-26 sales against Jan-26 RCPA.

#### 4.4.1a Bridge as built — results, 2026-08-12

`tools/etl.ts` now loads the bridge and both new sources. All 8 validation
checks pass. Landed into the serving database:

```
dim_employee            701 rows   (556 TM, 92 RM, 24 ZSM)
agg_headcount_month   3,649 rows   TM and RM count per month per territory
fact_rcpa            26,309 rows   rcpa_actual, comp_value, rxns, doctors
fact_secondary      102,274 rows   secondary_value, adj_secondary_value, stockist_closing
```

**Headcount works.** 474 TMs in Apr-26 rising to 556 in Aug-26, with only
19–27 per month unattributed. PCPM has a denominator.

**Territory attribution is partial, and it is a master-data gap, not a load
defect.** By row count the bridge resolves 91% of RCPA and 96% of secondary;
by *value* 56.8% of RCPA and 39.7% of secondary land on "Unassigned". Two
distinct causes, neither fixable by query:

1. **156 of 620 RCPA TMs are absent from `All_EmployeeData`**, so their activity
   has no SAP territory. They are disproportionately high-value.
2. **The field force runs divisions the sales view does not have** — `EMROK`,
   `BIOSCIENCES`, `BIOPHARMA`, `NEPAL`, `RESPIRATORY`. Only six division names
   are common to both (`SPECIALITY`, `DIABETES`, `MERIND`, `RESEARCH`,
   `AESTHETICS`, `MIQNAF`). The master's own `division` is a third, coarser
   taxonomy again.

Both are reported into `etl_load_log` rather than failing the load — a check
that can never go green stops being read. **Ask the business for (a) the missing
TMs in the employee master and (b) a field-force-division → SAP-division
mapping.** Those two answers move RCPA attribution from 43% to near complete.

Also note the load takes the FIRST code where `sapLocationCode` is
comma-separated — 967,204 secondary source rows are affected, credited wholly
to one territory. Division grain is unaffected; the geo grids approximate.

#### 4.4.3 `dbo.SecondaryData_test`  (4,289,671 rows, 202304–202607)

Covers **202504–202603 — the 12 months missing from the sales view** (§4.1), so
it is also the best available witness for that period.

| Column | Feeds |
| --- | --- |
| `secondaryValue`, `adjSecondaryValue` | Secondary panel and Sec Gr% |
| `rcpaValue` | a second RCPA source — reconcile against `RCPA_New` before use |
| `primaryValue` | independent check on `NET_SALES` |
| `closingValue` | stockist-held inventory |
| `stockistCode`, `stockistName` | the CN-by-stockist grid |

Geography here is **comma-separated multi-value** (`sapLocationCode` =
`'M2MADP,M2TNJR'`, occasionally with duplicates). Only 502 of 1,014 codes match
`BZIRK`. Prefer the employee bridge where a row can be attributed that way;
otherwise split on comma and attribute proportionally, or fall back to division
grain. Do not join on it naively.

`CR_NOTES` in the primary view remains a single total and cannot be split. Build
the CN panel against a `fact_credit_note` table with a `cn_type_key`, and stub
the loader until the Excel ingestion is defined.

### 4.5 Warehouse model (Synapse)

Star schema. Integer surrogate keys throughout.

```
dim_date          date_key (int, YR_MN as 202508), year, month_no, month_label,
                  fy_year, fy_quarter, is_closed (bit)          REPLICATE
dim_division      division_key, spart, div_name                 REPLICATE
dim_geo           geo_key, zone_code, zone_name, region_code, region_name,
                  hq_code, hq_name    -- flattened, one row per HQ
                                                                REPLICATE
dim_brand         brand_key, brand_name, division_key            REPLICATE
dim_material      material_key, matnr, maktx, brand_key          REPLICATE
dim_customer      customer_key, customer_code, customer_name     REPLICATE
dim_plant         plant_key, werks, plant_name                   REPLICATE
dim_cn_type       cn_type_key, cn_type_code, cn_type_name        REPLICATE

fact_sales_primary                                  ROUND_ROBIN
    date_key, division_key, geo_key, brand_key, material_key,
    customer_key, plant_key,
    orders, orders_qty, gross_sales, gross_sales_qty,
    cr_notes, cr_notes_qty, net_sales, net_sales_qty,
    budget, collection, collection_material, os,
    stock, git, stock_qty, git_qty,
    src_timestamp
    CLUSTERED INDEX (date_key, division_key)        -- NOT columnstore, see §4.2
```

`dim_geo` is deliberately flattened rather than three separate dimension tables.
The hierarchy is only ever used top-down for rollups and filtering, so a single
replicated join is faster than three, and the row count is one per HQ.

`PENDING: exact DDL` — the user will supply real types and lengths. Do not
guess `varchar` widths or numeric precision. Money columns are `DECIMAL(18,2)`
unless told otherwise; never `FLOAT`. Keep varchar widths tight: Synapse
allocates memory by declared width, so `VARCHAR(4000)` on a name column wastes
grant memory and causes spills.

### 4.6 Aggregate tables

Build one summary table per grain the dashboard actually queries — **not** one
universal cube. The combinatorics of a universal cube defeat the purpose.

```
agg_division_month   date_key, division_key                       + measures
agg_brand_month      date_key, division_key, brand_key            + measures
agg_geo_month        date_key, division_key, geo_key              + measures
agg_hq_brand_month   date_key, division_key, geo_key, brand_key   + measures
agg_cn_month         date_key, division_key, geo_key, cn_type_key + measures
```

Measure set on each (additive only, per I4):

```
budget, net_sales, gross_sales, collection, os,
cr_notes, stock, git, secondary_value, rcpa_plan, rcpa_actual,
tm_count
```

These are built in Synapse by CTAS, then **copied to the serving database**,
where they are the tables the API reads. In the serving Azure SQL database:

- Clustered index on `(date_key, division_key, ...)`, `date_key` always leading.
- Rowstore, not columnstore — these are tables of thousands of rows.
- Add a nonclustered covering index per query pattern if a panel measures slow.

Largest expected table is `agg_hq_brand_month`: roughly
(HQ count × brand count × months). Confirm this stays under ~500k rows once real
cardinalities are known; if it exceeds that, drop it and serve HQ-level brand
detail on drill-down only.

### 4.7 Load pipeline

Orchestrated by a **Synapse Pipeline** (or Azure Data Factory). Not a Node job,
not a cron script calling SQL over the network.

```
1. Resume the dedicated pool (if paused).
2. Refresh dimensions:
     CTAS dim_*_new from source distinct values, assign -1 for nulls,
     stable surrogate keys, RENAME OBJECT swap.
3. Rebuild fact_sales_primary for the target month range via CTAS.
4. UPDATE STATISTICS on fact and dimensions.
5. Validation queries:
     - orphan dimension keys  → fail
     - null/unassigned counts → write to etl_load_log
     - row count and SUM(net_sales) vs source view → fail on mismatch
6. CTAS each agg_* table for the target range.
7. Copy activity: agg_* from Synapse → serving Azure SQL (upsert by date_key
   range; delete-then-insert the affected months inside one transaction).
8. Write data_version + open_yr_mn to the serving DB's etl_data_version.
9. Call the API's cache-flush endpoint (or delete the dash:v1:* Redis prefix
   directly) so the response cache reloads.
10. Pause the pool (if on a pause schedule).
```

Schedule: the open month every 30–60 minutes; closed months on demand only. Do
not attempt a 15-minute cadence against Synapse — pool resume time and CTAS
overhead make it unreliable, and the serving tier is what users actually hit.

All aggregation happens in Synapse. Do not pull fact rows into Node.

### 4.8 Serving database

A small Azure SQL Database. Contents:

```
agg_division_month, agg_brand_month, agg_geo_month,
agg_hq_brand_month, agg_cn_month     -- copied from Synapse
dim_date, dim_division, dim_geo, dim_brand   -- for filter option lists
etl_data_version, etl_load_log
app_user, app_scope, app_scope_node, app_user_scope   -- see §6
```

Sizing: General Purpose 2 vCore, or Standard S1, is ample. Use a **provisioned**
tier, not serverless — auto-pause costs 5–20 s on first query and destroys the
latency target. This database holds no fact rows and never runs a scan over more
than a few thousand rows.

The API has exactly one database connection string, and it points here. There is
no Synapse connection string in the API at all. This is enforceable by grep and
should be checked in review.

### 4.9a Reconciliation results — MERIND, Apr–Aug 2026

Run 2026-08-11 with `divperf-api/tools/reconcile.ts`, read-only against the
view, using the agreed definitions. This is the §10 Phase 2 reconciliation done
early, before the serving tier exists, so that definition errors are found while
they are still free to fix. **Re-run it against the serving database after the
first load and the numbers must match exactly.**

```
Tgt   ₹32.62 Cr      Disp  ₹20.11 Cr  (Ach 61.6%)     Coll  ₹19.07 Cr  (Ach 58.5%)
CN    ₹0.97 Cr       CN%   4.59%      O/S   ₹48.50 Cr  Inventory ₹55.23 Cr
```

Monthly: Apr ₹5.14 Cr · May ₹5.14 Cr · Jun ₹4.42 Cr · Jul ₹5.36 Cr ·
Aug ₹0.05 Cr (open month, 5 days loaded).

**Consistency checks — all pass:**

| Check | Result |
| --- | --- |
| Zone rollup equals the division total (Disp and Coll) | **exact, diff = 0** |
| `GROSS_SALES − CR_NOTES = NET_SALES` | **exact, diff = 0** |
| Rows with no geography carry value | **none** (1,548 rows, ₹0) |
| An HQ under more than one region *within this division and window* | **none** |

That last one matters: the 80+ hierarchy conflicts in §4.3 are **across
divisions and across time**, not inside a single division-period. A geo
dimension keyed on `(zone, region, hq)` resolves them; the rollups tie today.

**Confirmed by the same run:** rows with a brand carry `Disp` and `Tgt` but
exactly `0` collection; rows without a brand carry the entire ₹19.07 Cr of
collection and zero dispatch. This is the grain split of §4.3, proven on real
numbers rather than inferred.

**Caveat on Ach% over a range that includes the open month.** Aug-26 contributes
a full month of target (₹6.38 Cr) against 5 days of actuals, which drags the
period Ach% from ~72% down to 61.6%. This is arithmetically correct and will
still be read as a bug by managers. Decide whether the open month should be
excluded from Ach%, pro-rated, or simply flagged in the UI.

### 4.10b Final architecture decision — warehouse only

**Decision 2026-08-12 (user): no intermediate database of any kind.** The API
reads Synapse directly and nothing else. The interim serving tier and its load
pipeline have been removed from the repo; §4.0's two-tier design is retained in
this document as the target should the position change, and `sqlFragments.ts`
keeps the single switch that would flip the panel SQL over to `agg_*` tables.

PCPM, RCPA and Secondary are therefore queried live through the employee bridge
(§4.4.1) rather than pre-joined. Measured with those panels wired in:

| Tab | Cold | Cached |
| --- | --- | --- |
| Division | 11.1 s | 2 ms |
| Brand | 10.6 s | 2 ms |
| Zonal | 11.3 s | 2 ms |
| Credit note | 2.2 s | 2 ms |

The three field-force queries add roughly 4–5 s over the sales-only figures in
§4.10a. The Credit Note tab is fast because it declares none of those panels and
so never fires them.

**The response cache is load-bearing, not an optimisation.** The first request
for each filter combination pays the full cost; every subsequent one is ~2 ms.
Closed months hold for 7 days, the open month for 5 minutes, and the frontend
prefetches adjacent months and the hovered tab. Anything that empties the cache
— a deploy, a restart, a `POST /api/meta/flush` — returns every user to the cold
path, so Redis (I10) matters more here than it would with a serving tier.

### 4.10a Phase 2 as built — `synapse-direct`, and what it costs

**Decision 2026-08-11 (user):** query Synapse directly rather than stand up an
interim serving tier. Implemented behind `DATA_SOURCE=synapse-direct`.
Invariant I9 is deliberately set aside; `config.ts` requires the flag so it can
never happen by accident, and logs an `[I9 OVERRIDE]` warning at startup.

**Correctness: complete.** Every panel reads the real warehouse, and every
figure ties to the §4.9a reconciliation exactly — Tgt ₹32.62 Cr, Disp ₹20.11 Cr
(61.6%), Coll ₹19.07 Cr (58.5%), CN ₹96.76 L (4.59%), O/S ₹48.50 Cr, Inventory
₹55.23 Cr, and the zone grid rows match row for row.

**Latency: measured, and worse than the 1–3 s estimate.**

| Interaction | synapse-direct | serving DB (built, benchmarked) | Target (§11) |
| --- | --- | --- | --- |
| Filter bar, first paint | **18,419 ms** | ~5 ms | — |
| Division tab | **6,635 ms** | 1.4 ms | 1,200 ms |
| Brand tab | **4,222 ms** | 2.9 ms | 1,200 ms |
| Zonal tab | **8,937 ms** | 0.5 ms | 1,200 ms |
| Regional tab | **6,961 ms** | ~3 ms | 1,200 ms |
| **HQ tab** | **27,013 ms** | **7.3 ms** | 1,200 ms |
| Credit note tab | 4,818 ms | ~2 ms | 1,200 ms |
| Any tab, cached | 2 ms | 2 ms | 80 ms |

The serving-DB column is not theoretical: `tools/etl.ts` builds those `agg_*`
tables, all seven of its validation checks pass, and the benchmark returns the
same numbers as the reconciliation. The HQ tab is **3,700× slower** read
directly.

Two effects compound beyond the per-query floor of §4.0:

1. **Grain.** The HQ grid groups 1.27M rows by `BZIRK` across two windows.
   Pre-aggregated, that is a 101-row scan.
2. **Concurrency slots.** A tab fires 5 panel queries in parallel, but a
   dedicated pool admits only 4 (DW100c) to 20 (DW500c) concurrent queries
   *across all users*. Parallelism past the slot limit does not speed anything
   up — it moves the queue into the warehouse where it is invisible. This is
   exactly the failure §4.0 predicts, now observed.

**What makes it survivable today:** the response cache. A repeat request is
2 ms, TTLs are 7 days for closed months and 5 minutes for the open month, and
the frontend prefetches adjacent months and the hovered tab. The first user of
each filter combination pays the full cost; everyone after them does not.

**To revert to the intended architecture:** provision the Azure SQL serving
database, point `SQL_SERVER` at it, set `DATA_SOURCE=serving-db`, and schedule
`tools/etl.ts` (or its Synapse Pipeline equivalent, §4.7). The panel SQL is
generated from `sqlFragments.ts`, which has one switch between reading the raw
view and reading `agg_hq_brand_month`, so no panel changes.

### 4.10 Current blocker: there is no serving tier

**Status 2026-08-11.** The credentials supplied are **read-only against
Synapse**. There is no serving Azure SQL database, and no write access to
Synapse either. That means, of §4.7's pipeline, steps 2–8 cannot be run at all:
no `agg_*` tables can be built, and nothing can be copied anywhere.

This does not block Phase 0 or Phase 1, which §10 deliberately designed to need
no database — both are complete. It blocks Phase 2 entirely.

Three ways forward, in preference order:

1. **Provision the serving Azure SQL database** (GP 2 vCore or S1, provisioned
   not serverless) and grant the pipeline write access to a Synapse schema for
   the `agg_*` CTAS builds. This is the architecture as designed and the only
   option that keeps the deferred chart builder (§13) possible.
2. **Serving tier only, no Synapse writes.** If write access to Synapse is not
   available, the aggregation can run as `SELECT`-only queries against the view,
   with results landed directly in the serving database by the pipeline. Slower
   and less elegant — it re-reads the view rather than building once — but it
   preserves invariant I9, keeps the API unchanged, and needs only one new
   resource.
3. **Redis-only fallback** (§12 Q13). Precompute every aggregate response as
   JSON. Workable for fixed tabs; removes ad-hoc filtering and effectively kills
   §13. Choose only if option 1 and 2 are both refused on budget.

Until one is chosen, the API runs with `USE_MOCK_DATA=true` and serves generated
data that satisfies the contract exactly. Switching to real data is a config
flag plus the panel queries in `data/panels/*` — no change to the frontend, the
contract, the cache, or the scope layer.

### 4.9 Data version token

In the serving database:

```
etl_data_version   id (1), data_version (varchar), open_yr_mn (int),
                   updated_at (datetime2)
```

`data_version` is a hash or the max source timestamp. The API exposes it at
`GET /api/meta/version`, served from Redis and refreshed at the end of the load
pipeline. The frontend polls it to invalidate only open-month queries (§8.4).

---

## 5. Metric definitions

Store the numerator and denominator; compute the ratio at read time. Every one
of these is wrong if pre-aggregated.

```
Value           = SUM(measure)

Ach%            = SUM(actual) / NULLIF(SUM(budget), 0) * 100

Gr%             = (SUM(current) - SUM(prior_same_period))
                  / NULLIF(SUM(prior_same_period), 0) * 100
                  -- prior period = same month range, previous year

PCPM            = SUM(collection)
                  / NULLIF(SUM(tm_count), 0)
                  / NULLIF(month_count, 0)
                  -- "Collection / No. of Budgeted TMs / No. of Months"

Ach% on Coll    = SUM(collection) / NULLIF(SUM(budget), 0) * 100

Total O/S       = SUM(os)
Inventory       = SUM(stock) + SUM(git)
Total CN        = SUM(cr_notes)
CN %            = SUM(cr_notes) / NULLIF(SUM(gross_sales), 0) * 100
```

Rules:
- Always `NULLIF` the denominator. A division with zero budget must render `—`,
  not `Infinity` or a crash.
- `month_count` is the number of months in the selected range, from `dim_date`,
  not `to - from`.
- Growth needs the prior-year window fetched in the same round trip. The tab
  endpoint queries both windows in parallel and returns both.
- Rounding happens in the frontend at render time. The API returns full
  precision numbers.

**RESOLVED 2026-08-11 by the user: `Disp = NET_SALES`.** (§12 Q4)
Note the arithmetic identity confirmed against the source —
`GROSS_SALES − CR_NOTES = NET_SALES` exactly, every month. So dispatch is
already net of credit notes, and the Credit Note panel shows a deduction that
has **already been applied** to the Disp figure. That is a legitimate way to
read the report, but it means Disp + CN must never be presented as if it summed
to gross. `CN%` is therefore computed against `GROSS_SALES`
(= `NET_SALES + CR_NOTES`), not against Disp, so the percentage means "what
share of what we billed came back".

**Also resolved by the user, 2026-08-11:**

- `Gr% = (current period − same period prior year) / same period prior year`,
  as already written above. Renders `—` for all of FY26-27 (see §4.1).
- `PCPM = total sales / total people`. The Excel additionally divides by the
  number of months so a multi-month range stays comparable; the implementation
  keeps `months` as an explicit argument rather than an implied divisor.
- Hierarchy is a strict tree: one division has many zones, one zone many
  regions, one region many territories. (The source violates this — see §4.3.)
- Sales channel vocabulary: **stockist = primary**, **chemist = secondary**,
  **patient = tertiary**. Only primary exists in this view.

**Still `PENDING` — carried as clearly-marked dummy formulas** in
`divperf-api/src/lib/metrics.ts` (each is a single expression, so each is a
one-line swap):

| Metric | Why it is a stub |
| --- | --- |
| `Ach%` denominator | User has not given the definitive rule; uses `BUDGET1` per §5 |
| `PCPM` denominator | No headcount column exists anywhere in the view |
| Secondary (`Sec`) | Chemist-level sales; no source |
| `RCPA` plan/actual | Doctor-related; definition not yet settled |
| CN split (Exp/SR/PD) | Arrives as an Excel from distribution; no feed yet |
| Brand-level `Coll` | Structurally absent — collection is customer-grain (§4.3) |

---

## 6. Role-based access

### 6.1 Model

A user's access is a **scope**: a level plus a set of node ids at that level.
Do not encode roles as behaviour — an RSM and an ASM run identical code and
differ only in which nodes they own.

```
app_user           user_id, upn, display_name, is_active
app_scope          scope_id, scope_level ('ALL'|'DIVISION'|'ZONE'|'REGION'|'HQ')
app_scope_node     scope_id, node_type, node_code
app_user_scope     user_id, scope_id
```

### 6.2 Enforcement

1. Auth via Entra ID (Azure AD). The API validates the JWT signature and
   audience on every request.
2. From the validated token's `oid`, resolve the user's `scope_id` — server-side,
   cached in Redis for 5 minutes. **The scope is never read from the token
   claims**, so access can be revoked without waiting for token expiry.
3. Compute `scopeHash` = stable hash of the resolved permitted node set.
4. The data layer appends the scope predicate to every query. This lives in the
   query builder, not in route handlers, so it cannot be forgotten.
5. `scopeHash` is a mandatory argument to the cache key builder. Make it
   impossible to construct a cache key without one:

```ts
// cache/key.ts — scope is positional and required, not an optional field
export function tabKey(
  scopeHash: string,   // must be first
  tab: string,
  filters: CanonicalFilters,
): string {
  return `dash:v1:${scopeHash}:${tab}:${canonToString(filters)}`;
}
```

6. Filters requesting nodes outside the user's scope are **intersected down**,
   not rejected — a ZSM selecting "all regions" gets their regions. Return the
   effective scope in the response so the UI can show what was applied.

**As built (2026-09-29):** not Entra ID. Sign-in is mobile + OTP, the D2D
portal's TM login flow, for the field force in Infinity. `npm run infinity:sync`
pulls Infinity's field structure into `sales_dash_user_db`
(`divperf-api/db/schema.sql`), and the view `vw_dashboard_users` — built on the
D2D portal's `vw_tm_hierarchy` / `vw_infinity_users` — stands in for §6.1's
four tables: a TM's, RM's or ZSM's own SAP code at HQ, region or zone level, an
NSM's division at division level. The session token carries only the employee
code; the person and scope are re-read from the view on every request (cached
one minute). Rules 2–6 hold unchanged.

**The scope also carries the user's division (2026-09-30).** HQ, region and zone
codes are not unique across divisions — 59 of 540 HQ codes, 2 region codes and
1 zone code recur in another division — so a node set alone would let a TM see a
second division's figures under the same HQ code. `vw_dashboard_users.divisions`
holds each person's division(s) (every current user has exactly one), and
`permittedFor()` in `plugins/scope.ts` is the one definition of what a scope
allows on each dimension: the nodes at its level, plus its divisions. The query
builder, the tab service and the filter options all use it, and the divisions
are part of `scopeHash`.

### 6.3 Second net

Enable SQL Server row-level security on the fact and summary tables as a
defence-in-depth layer. The application predicate remains the primary control;
RLS catches mistakes in new code paths.

---

## 7. Backend — `divperf-api`

### 7.1 Stack

```
Node 20 LTS, TypeScript (strict)
fastify                 HTTP server
@fastify/compress       brotli/gzip
@fastify/jwt            token validation
mssql                   Azure SQL driver (tedious), pooled
ioredis                 cache client
zod                     request validation
pino                    logging (fastify built-in)
vitest                  tests
```

No ORM. Queries are hand-written parameterized SQL against the summary tables.
An ORM buys nothing here and obscures the query plans that matter.

### 7.2 Structure

```
src/
  server.ts                  fastify instance, plugin registration
  config.ts                  env parsing + validation (zod), fail fast
  types/api.ts               response contracts (mirrored in web repo)
  plugins/
    auth.ts                  JWT verification, attaches req.user
    scope.ts                 resolves req.scope from req.user, cached
    cache.ts                 registers CacheClient on fastify instance
  routes/
    meta.ts                  GET /api/meta/version, /api/meta/filters
    dashboard.ts             GET /api/dashboard/:tab
    health.ts                GET /health, /ready
  services/
    tabService.ts            orchestrates panels for a tab, parallel
    filterService.ts         cascading filter option lists
  data/
    pool.ts                  mssql connection pool singleton
    queryBuilder.ts          composes SELECT + scope predicate + filters
    panels/
      primary.ts             one file per panel query
      pcpm.ts
      secondary.ts
      rcpa.ts
      keyBrands.ts
      creditNote.ts
      trends.ts
      mix.ts
  cache/
    CacheClient.ts           interface
    MemoryCache.ts           lru-cache implementation (phase 2)
    RedisCache.ts            ioredis implementation (phase 6)
    key.ts                   key builders, scope-mandatory
  tabs/
    registry.ts              tab config: which panels, which grain
  lib/
    errors.ts                AppError, error serializer
    yrmn.ts                  month arithmetic on YR_MN ints
```

### 7.3 Layer rules

- **routes/** validate input with zod, call a service, return. No SQL, no
  business logic, no cache calls.
- **services/** orchestrate. `tabService` reads the tab config, fires panel
  queries with `Promise.all`, assembles the response, handles caching.
- **data/** owns SQL. Every function takes a `Scope` and applies it. No
  function in this layer can be called without one — enforce via the type
  signature.
- **cache/** is swappable behind `CacheClient`. Nothing outside this folder
  imports `ioredis`.

### 7.4 Cache interface

```ts
export interface CacheClient {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delByPrefix(prefix: string): Promise<void>;
}
```

TTL policy, per I7:

```ts
const CLOSED_MONTH_TTL = 60 * 60 * 24 * 7;   // 7 days
const OPEN_MONTH_TTL   = 60 * 5;             // 5 minutes

function ttlFor(toYrMn: number, openYrMn: number) {
  return toYrMn < openYrMn ? CLOSED_MONTH_TTL : OPEN_MONTH_TTL;
}
```

The load procedure calls `delByPrefix('dash:v1:')` on completion. The `v1`
segment lets a deploy invalidate everything by bumping it.

### 7.5 API contract

#### `GET /api/meta/version`

```json
{ "dataVersion": "a3f9c1", "openYrMn": 202508, "updatedAt": "2026-08-11T04:10:00Z" }
```

#### `GET /api/meta/filters?division=78&zone=JH`

Cascading options, already scope-filtered. Each level returns only values
reachable given the levels above it and the user's scope:

```
Division ─┬─ Brand                  divisions: the user's own division(s) only
          └─ Zone ── Region ── HQ
```

The frontend clears every level below one that changes, and while the new lists
load it keeps the old ones on screen, marking only the levels below as loading.

```json
{
  "divisions": [{ "code": "78", "name": "MERIND" }],
  "zones":     [{ "code": "JH", "name": "MER2 - HYDERABAD" }],
  "regions":   [{ "code": "JHB", "name": "BANGALORE" }],
  "hqs":       [{ "code": "M2BGLP", "name": "MER BANGALORE POOL" }],
  "brands":    [{ "code": "HAPID", "name": "HAPID" }],
  "months":    [{ "yrMn": 202508, "label": "Aug-26", "isClosed": false }]
}
```

#### `GET /api/dashboard/:tab`

Query params: `from`, `to` (YR_MN ints), and optional repeated
`division`, `brand`, `zone`, `region`, `hq`.

**Response is columnar.** Arrays of primitives, parallel by index — not arrays
of objects. This cuts payload 60–70% before compression on the trend series.

```json
{
  "meta": {
    "tab": "division-performance",
    "dataVersion": "a3f9c1",
    "from": 202504,
    "to": 202508,
    "monthCount": 5,
    "effectiveScope": { "level": "ZONE", "nodes": ["JH"] },
    "unassignedRows": 0,
    "cached": true,
    "queryMs": 18
  },
  "primary": {
    "target":     { "value": 2000000, "ach": null,  "gr": null },
    "collection": { "value": 1750000, "ach": 87.5,  "gr": 12.3 },
    "dispatch":   { "value": 1920000, "ach": 96.0,  "gr": 8.1 }
  },
  "pcpm": { "budgetTm": 20, "pcpmCollection": 900000 },
  "secondary": { "value": 1000000, "grPct": 10.0 },
  "rcpa": { "plan": 1200, "actual": 1080, "achPct": 90.0, "grPct": 4.2 },
  "inventory": { "value": 1000000 },
  "keyBrands": {
    "columns": ["brand","tgt","disp","coll","achOnColl","grPct","sec","inventory","rcpa"],
    "rows": [
      ["HAPID", 400000, 380000, 350000, 87.5, 9.1, 210000, 190000, 240]
    ]
  },
  "creditNote": {
    "totalCn": 82000, "expCn": 51000, "srCn": 19000, "pdCn": 12000,
    "totalOs": 640000,
    "cnPct": 4.3
  },
  "trends": {
    "months": [202504, 202505, 202506, 202507, 202508],
    "labels": ["Apr-26","May-26","Jun-26","Jul-26","Aug-26"],
    "disp":  [420000, 480000, 390000, 510000, 460000],
    "sec":   [300000, 340000, 280000, 360000, 330000],
    "rcpa":  [410000, 470000, 380000, 500000, 450000],
    "pcpm":  [9.4, 9.9, 9.2, 10.1, 9.7],
    "tgt":   [440000, 480000, 420000, 500000, 470000],
    "coll":  [400000, 450000, 370000, 480000, 440000],
    "rcpaPlan":   [1200, 1250, 1180, 1300, 1240],
    "rcpaActual": [1080, 1190, 1010, 1240, 1150],
    "cnExp": [40000, 44000, 38000, 47000, 43000],
    "cnSr":  [15000, 17000, 14000, 18000, 16000],
    "cnPd":  [9000, 10000, 8000, 11000, 9500]
  },
  "mix": {
    "dimension": "brandGroup",
    "labels": ["Methycobal Group", "Hapid", "M Inj & Tab", "Others"],
    "disp": [780000, 190000, 140000, 90000],
    "coll": [700000, 175000, 130000, 80000],
    "sec":  [600000, 150000, 110000, 70000],
    "rcpa": [640000, 160000, 120000, 75000]
  }
}
```

Notes:
- `null` for a metric means "not computable" (zero denominator or missing
  source). The frontend renders `—`. Never send `0` for unknown.
- `queryMs` and `cached` are included in every response and shown in a dev-only
  footer. You cannot optimise what you cannot see.
- Panels the tab does not use are omitted entirely, not sent as `null`.

#### Error format

```json
{ "error": { "code": "SCOPE_EMPTY", "message": "No permitted nodes for this user." } }
```

Codes: `BAD_REQUEST`, `UNAUTHORIZED`, `SCOPE_EMPTY`, `NOT_FOUND`,
`UPSTREAM_TIMEOUT`, `INTERNAL`. Messages are user-facing — plain, specific,
and about what to do next. Never leak SQL or stack traces.

### 7.6 Performance requirements

- `mssql` pool: `min: 2, max: 10`. Never open a connection per request.
- Every panel query is parameterized. String-concatenated SQL fails review.
- `Promise.all` for panel queries. Sequential awaits in `tabService` are a bug.
- Fastify response schemas on every route — its schema-based serializer is
  meaningfully faster than `JSON.stringify` for objects this size.
- Brotli compression enabled. Target under 100 KB uncompressed per tab.
- Log slow queries over 200 ms with the panel name and parameters.

### 7.7 Environment

```
PORT=8080
NODE_ENV=development
# Serving database ONLY — never Synapse. See I9.
SERVING_SQL_SERVER=
SERVING_SQL_DATABASE=
SERVING_SQL_USER=
SERVING_SQL_PASSWORD=
SERVING_SQL_ENCRYPT=true
SERVING_SQL_POOL_MAX=10
REDIS_URL=
CACHE_DRIVER=memory            # memory | redis  (redis required from Phase 3)
AZURE_TENANT_ID=
AZURE_API_AUDIENCE=
CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info
```

`config.ts` parses these with zod and throws on startup if any required value is
missing. No `process.env` access anywhere else in the codebase.

### 7.8 Cold starts

These will dominate perceived latency if ignored:

- Serving Azure SQL: **provisioned** tier. If serverless, set auto-pause to
  never. A paused database costs 5–20 seconds on first query.
- App Service: enable Always On, add a warmup ping to `/ready`.
- Redis: `lazyConnect: false` so the connection is warm before first request.
- Synapse pause schedule is irrelevant to user latency by design — but if the
  pool is paused when the load pipeline fires, step 1 of §4.7 must resume it and
  the pipeline timeout must allow 2–5 minutes for that. A pipeline that fails on
  resume leaves the serving tier stale, which users *will* notice as wrong
  numbers rather than as slowness. Alert on pipeline failure, not just on
  latency.

---

## 8. Frontend — `divperf-web`

### 8.1 Stack

```
React 18, TypeScript (strict)
vite
@tanstack/react-query        server state
@tanstack/react-table        Key Brands + stockist tables
echarts + echarts-for-react  all charts
zustand                      filter state only
react-router-dom             tab routing
tailwindcss                  styling
@azure/msal-react            Entra ID auth
```

**ECharts, not Recharts.** Recharts renders through the React tree and gets
sluggish with 14 panels mounted. ECharts renders to canvas, handles the combo
bar+line charts natively, exports to image and Excel out of the box, and its
`dataset` + `series.encode` model maps directly onto the columnar API response
and onto the deferred chart builder.

### 8.2 Structure

```
src/
  main.tsx
  App.tsx                      router + providers
  types/api.ts                 mirrors divperf-api/src/types/api.ts
  lib/
    queryClient.ts             QueryClient defaults
    api.ts                     typed fetch wrapper, aborts, error mapping
    yrmn.ts                    month arithmetic (mirror of backend)
    format.ts                  lakh/crore formatting, pct, em-dash for null
  auth/
    msalConfig.ts
    useSession.ts              user, scopeId, openYrMn
  store/
    filterStore.ts             zustand: from, to, division[], brand[], ...
  queries/
    keys.ts                    query key factory + canonicalizer
    policy.ts                  tiered staleTime by month
    useDashTab.ts
    usePrefetch.ts
    useFilterOptions.ts
    useDataVersion.ts
  tabs/
    registry.ts                tab config: id, label, panels, grain
    TabPage.tsx                generic tab renderer, driven by registry
  components/
    filters/FilterBar.tsx
    filters/MonthRangePicker.tsx
    panels/PrimaryPanel.tsx
    panels/PcpmPanel.tsx
    panels/SecondaryPanel.tsx
    panels/RcpaPanel.tsx
    panels/KeyBrandsTable.tsx
    panels/CreditNotePanel.tsx
    panels/GapRibbon.tsx        the signature element, see §9
    charts/TrendCombo.tsx
    charts/TargetVsActual.tsx
    charts/RcpaPlanActual.tsx
    charts/CreditNoteStack.tsx
    charts/MixDonut.tsx
    charts/chartTheme.ts        shared ECharts theme
    ui/                         Card, Stat, Skeleton, EmptyState, ErrorState
```

### 8.3 QueryClient defaults

TanStack's defaults are tuned for chatty CRUD apps. Override them:

```ts
// lib/queryClient.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});
```

### 8.4 Query keys, freshness, prefetch

**Canonicalize filters or you will get cache misses from array ordering alone.**

```ts
// queries/keys.ts
export type Filters = {
  from: number; to: number;
  division: string[]; brand: string[];
  zone: string[]; region: string[]; hq: string[];
};

export const canon = (f: Filters) => ({
  from: f.from,
  to: f.to,
  division: [...f.division].sort().join(','),
  brand:    [...f.brand].sort().join(','),
  zone:     [...f.zone].sort().join(','),
  region:   [...f.region].sort().join(','),
  hq:       [...f.hq].sort().join(','),
});

export const dashKeys = {
  all: ['dash'] as const,
  tab: (tab: string, scopeId: string, f: Filters) =>
    ['dash', tab, scopeId, canon(f)] as const,
};
```

`scopeId` is in the key for the same reason as I6 — without it, switching
users in the same browser session serves the previous user's numbers from cache.

**Tiered freshness, per I7.** A closed month cannot change, so do not refetch it.

```ts
// queries/policy.ts
const DAY = 86_400_000;

export function policy(to: number, openYrMn: number) {
  return to < openYrMn
    ? { staleTime: DAY, gcTime: DAY, refetchOnWindowFocus: false }
    : { staleTime: 5 * 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: true };
}
```

`openYrMn` comes from the server (`/api/meta/version`), never from the browser
clock — fiscal month close does not follow the calendar and client clocks lie.

**The tab hook.** `placeholderData: keepPreviousData` keeps the previous month's
charts on screen, dimmed, instead of flashing skeletons on every month change.
The `signal` matters: a user clicking through six months fires six requests, and
you want the five stale ones aborted rather than racing to paint.

```ts
// queries/useDashTab.ts
export function useDashTab(tab: string, filters: Filters) {
  const { scopeId, openYrMn } = useSession();
  return useQuery({
    queryKey: dashKeys.tab(tab, scopeId, filters),
    queryFn: ({ signal }) => fetchTab(tab, filters, signal),
    placeholderData: keepPreviousData,
    ...policy(filters.to, openYrMn),
  });
}
```

**Prefetch adjacent months on idle.** Debounced so rapid clicking does not fire
a storm of requests.

```ts
// queries/usePrefetch.ts
export function usePrefetchMonths(tab: string, filters: Filters) {
  const qc = useQueryClient();
  const { scopeId, openYrMn } = useSession();

  useEffect(() => {
    const id = setTimeout(() => {
      for (const to of [prevYrMn(filters.to), nextYrMn(filters.to)]) {
        if (to > openYrMn) continue;
        const f = { ...filters, to };
        qc.prefetchQuery({
          queryKey: dashKeys.tab(tab, scopeId, f),
          queryFn: ({ signal }) => fetchTab(tab, f, signal),
          ...policy(to, openYrMn),
        });
      }
    }, 400);
    return () => clearTimeout(id);
  }, [tab, filters.to, scopeId]);
}
```

Also prefetch the sibling tab on tab-strip hover, same pattern with a 150 ms
delay. A mouseover buys roughly 200 ms of head start, which is usually the
entire request.

**Version-based invalidation.** Poll the cheap version endpoint; when it moves,
invalidate only open-month queries. Closed months survive untouched.

```ts
// queries/useDataVersion.ts
export function useDataVersionSync() {
  const qc = useQueryClient();
  const { openYrMn } = useSession();
  const { data } = useQuery({
    queryKey: ['dataVersion'],
    queryFn: fetchDataVersion,
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!data) return;
    qc.invalidateQueries({
      queryKey: dashKeys.all,
      predicate: (q) => {
        const f = q.queryKey[3] as ReturnType<typeof canon> | undefined;
        return !!f && f.to >= openYrMn;
      },
    });
  }, [data?.dataVersion]);
}
```

**Do not split panels into separate `useQuery` calls.** It is the natural React
instinct and it puts you back at 14 round trips, violating I2. Fetch the tab as
one object and derive panel props with `select`; TanStack's structural sharing
means a panel re-renders only when its own slice actually changed.

```ts
const primary = useDashTab(tab, filters).data?.primary;   // fine
// NOT: usePrimaryPanel(), usePcpmPanel(), ... each with its own fetch
```

### 8.5 Tab registry

One tab engine, config-driven. Adding a tab is a registry entry plus, at most, a
new panel component.

```ts
// tabs/registry.ts
export type TabConfig = {
  id: string;
  label: string;
  grain: 'division' | 'brand' | 'hq';
  panels: PanelId[];
};

export const TABS: TabConfig[] = [
  {
    id: 'division-performance',
    label: 'Division performance',
    grain: 'division',
    panels: ['primary','pcpm','secondary','rcpa','keyBrands','creditNote',
             'trendCombo','targetVsActual','rcpaPlanActual','cnStack','mix'],
  },
  // brand-performance, territory-performance, credit-note
];
```

`TabPage.tsx` reads the config, calls `useDashTab(config.id, filters)` once, and
renders the listed panels. Do not write four page components.

### 8.6 Loading and empty states

Three distinct states, all designed, none an afterthought:

- **First load:** skeleton cards matching final panel dimensions. No layout
  shift when data arrives.
- **Refetch with previous data:** panels stay, opacity 0.55, a thin
  indeterminate progress line at the top of the content area. Never a spinner
  over the whole page.
- **Empty result:** a scope may legitimately have no data for a month. Say so
  plainly and say what to change: "No primary sales recorded for MER2 –
  Hyderabad in Aug-26. Try a wider period."

Errors state what happened and what to do. They do not apologize and they are
never vague.

---

## 9. Design system

The report this replaces is read by managers who have used it for years. The
job is not to reinvent how they read numbers — it is to make the same reading
faster and less error-prone than Excel. Continuity where it aids recognition,
discipline everywhere else.

### 9.1 Palette

The dashboard reproduces the "Division Performance: Sales Dashboard" Excel
report (changed 2026-09-30 at the user's request, from screenshots of it).
Users already read that report in review meetings; matching it costs them
nothing to learn. Tokens live on `:root` in `src/index.css`.

```
--xl-title       #1B9AD6   title bar
--xl-navy        #1F3864   panel headers, table header rows, active tab
--xl-teal        #134F5C   Key Brands / geo / CN panels, section bars
--xl-filter      #E6EDF5   filter panel
--xl-page        #F3F5F8   page background
--xl-grid        #D5DEE9   grid lines;  --xl-zebra #F1F5FB  alternate rows
--xl-text        #1F2D3D   body;        --xl-muted #6B7A8C  captions

--kpi-*          one colour bar per KPI tile (Target, Dispatch, Collection,
                 Ach%, Growth, Secondary, PCPM)

Charts use the Office palette in Excel's series order:
  #4F81BD blue · #C0504D red · #9BBB59 green · #8064A2 purple · #4BACC6 aqua · #F79646 orange

--good / --warn / --bad   achievement thresholds, unchanged
```

### 9.2 Type

```
UI and numerals:  Segoe UI (Calibri, Arial fallback), tabular-nums for figures
KPI value         24px / 700
Tile / field label 11px / 600 / uppercase
Panel header      13px / 700 / uppercase, white on navy or teal
Table body        13px, first column bold
Axis tick         11px
```

Money is shown in ₹ lakhs, as the report does: whole lakhs from 100 L
("4,655"), one decimal below ("9.7"). The exact rupee figure is on hover.

### 9.3 Layout

- Blue title bar, then the light-blue FILTERS ▾ panel (sticky, collapsible),
  then the tab strip.
- Performance tabs, top to bottom: seven KPI tiles, each under a coloured bar;
  PRIMARY PERFORMANCE and SECONDARY • PCPM • RCPA side by side; KEY BRANDS (or
  the geo grid) with a server Total row; CREDIT NOTES & OUTSTANDING beside
  MANPOWER ATTRITION; the SALES TRENDS section (six charts, three per row); the
  BRAND MIX section (four pies: dispatch, collection, secondary, RCPA by brand).
- Panels are square-cornered with a 1px grid border and a faint shadow; tables
  have a navy header row, zebra rows, a hover tint and a bold Total row.
- A chart or panel with no source keeps its slot and says why.
- Density toggle (comfortable / compact) persisted in localStorage. Compact
  drops table rows to 28px, for users who want the whole tab on one screen.
- Charts have fixed heights so a month change never shifts layout.

### 9.4 Signature element: the gap ribbon

A 4px horizontal band under the Ach% on Coll tile's value showing achievement
as a filled proportion, with a 1px notch at the 100% position.

```
Ach% on Coll   87.5%
       ████████████████████▏          │
       ↑ filled to Ach%              ↑ 100% notch
```

The band is `--good` / `--warn` / `--bad` by threshold. Achievement above 100%
extends past the notch in `--good`.

Why this and not a percentage badge: a manager scanning the Division tab has to
read eight numbers and compare each to its target. The ribbon makes that a
single glance across the panel — the gaps line up spatially and the eye finds
the short bar without reading any digits. It encodes something true about the
content, which is the only reason a structural device earns its place.

Keep everything else quiet. This is the one bold element; charts, tables, and
filters stay disciplined.

### 9.5 Number formatting

Indian conventions, because this is an Indian pharma division:

- Lakh/crore grouping: `17,50,000` not `1,750,000`.
- Money in ₹ lakhs under a "(₹ L)" label, as the report shows it: `4,655`
  from 100 L up, `9.7` below. Full rupees in tooltips and exports.
- Percentages: one decimal. Growth direction is carried by ▲ / ▼ and red for
  a fall.
- Null renders as `—` (em dash, `--ink-3`), never `0`, never `N/A`.
- Negative values in `--bad`, with a minus sign, never parentheses.

### 9.6 Quality floor

Meet these without announcing them: responsive to 1024px minimum (this is a
laptop tool, mobile is not a target for v1), visible keyboard focus rings on
every control, `prefers-reduced-motion` respected, all charts keyboard-reachable
with an accessible data table fallback, contrast ratio 4.5:1 minimum on all
text.

---

## 10. Build phases

Work in this order. Each phase ends in something runnable.

### Phase 0 — Scaffold
- Both repos: TypeScript strict, ESLint, Prettier, `.env.example`, README.
- API: fastify boots, `/health` returns 200, `config.ts` validates env.
- Web: Vite boots, Tailwind configured, fonts loaded, design tokens in CSS vars.
- No DB, no auth yet.

### Phase 1 — Contract first, mock data
- Write `types/api.ts` in both repos from §7.5. Identical files.
- API: `GET /api/dashboard/:tab` returns hardcoded mock matching the contract.
- Web: full Division Performance tab rendering from the mock — every panel,
  every chart, the gap ribbon, all three loading states.
- **This phase de-risks the whole build.** The layout, charts, and formatting
  are the bulk of the frontend work and none of it needs the database.

### Phase 2 — Warehouse model + one grain, end to end
- Resolve the `PENDING` items in §4.0, §4.1, §4.3, §5 with the user.
- Provision the serving Azure SQL database.
- Synapse: dimension + `fact_sales_primary` DDL per §4.5 — clustered index and
  `ROUND_ROBIN`, **not** columnstore. Create statistics.
- Synapse: CTAS build for `agg_division_month` only.
- Synapse Pipeline: minimal version of §4.7 — build, validate, copy that one
  table to the serving DB, write `etl_data_version`.
- API: replace the mock for the `primary` panel with real SQL against the
  **serving** database.
- Add `MemoryCache` (`lru-cache`) behind `CacheClient`.
- Measure. Log `queryMs`. Confirm the numbers tie to the Excel report for one
  month before building anything else — reconciliation is cheapest now, and a
  distribution or surrogate-key mistake found here is cheap to fix.

### Phase 3 — All panels, all grains, Redis
- Remaining `agg_*` CTAS builds and copy activities.
- Every panel query. Prior-year window for `Gr%`.
- `GET /api/meta/filters` with cascading options, served from the serving DB.
- Swap `MemoryCache` for `RedisCache` (per I10 — needed here, not later, because
  a single App Service instance is not a safe assumption once real users arrive
  and in-process caches diverge across instances).
- Web: filter bar wired, all panels on real data.

### Phase 4 — Auth and scope
- MSAL on the frontend, JWT validation on the API.
- Scope tables, resolution, and caching.
- Scope predicate in the query builder. `scopeHash` in every cache key.
- Test with at least three users at different levels. Verify an ASM cannot see
  another ASM's numbers by any parameter manipulation.

### Phase 5 — Remaining tabs
- Tab registry entries for Brand, Territory, Credit Note.
- Only build new panel components where a tab genuinely differs.

### Phase 6 — Performance pass
- Prefetch: adjacent months, sibling tab on hover.
- Brotli, fastify response schemas, payload audit against the 100 KB target.
- Cold start config per §7.8.
- Measure p50/p95 for first load, month change, tab switch.

### Phase 7 — Hardening
- ETL failure alerting, `etl_load_log` surfaced in a small admin view.
- Unassigned-row counts visible in the UI footer.
- Row-level security enabled as the second net.
- Excel export on the Key Brands table.

---

## 11. Acceptance checks

Verify before declaring a phase complete.

**Latency (measured on a warm cache, 1024×768 laptop, corporate network):**

| Interaction | Target p95 |
| --- | --- |
| First load, cold cache | < 1200 ms |
| First load, warm cache | < 600 ms |
| Month change, cached | < 80 ms |
| Month change, uncached | < 350 ms |
| Tab switch, prefetched | < 50 ms |
| Filter change (single dimension) | < 300 ms |

**Correctness:**
- Every panel ties to the Excel report for at least two sampled months.
- A division with zero budget renders `—`, not `Infinity` or `NaN`.
- Rows with null dimensions appear under "Unassigned" and the count is
  reported — total value with and without filters must reconcile.
- `Gr%` against a prior year with no data renders `—`.

**Security:**
- No cache key exists without a scope segment. Grep for `dash:v1:` and confirm.
- An ASM requesting `?zone=<other zone>` receives their own scope, not empty and
  not the other zone.
- Revoking a user's scope takes effect within 5 minutes without token reissue.
- No connection string, secret, or SQL text reaches the browser bundle.

**Payload:**
- Every tab response under 100 KB uncompressed.
- No response contains fact-level rows.

**Architecture (per I9):**
- `grep -ri "synapse\|sqlondemand\|\.sql\.azuresynapse" divperf-api/src` returns
  nothing. The API's only connection string points at the serving database.
- The load pipeline is the only thing that authenticates to Synapse.
- A validation query proves `SUM(net_sales)` in `agg_division_month` equals the
  same sum in the source view for every loaded month. Run it after every load,
  fail the pipeline on mismatch — Synapse enforces no constraints, so a double
  load is otherwise invisible until a manager spots doubled numbers in a review.
- Serving DB row counts logged after each copy, alerting on a drop to zero.

---

## 12. Open questions

Status as of 2026-08-11. Resolved items are struck through with the answer.

**Answered by warehouse discovery or by the user:**

1. ~~Definition of `VW_SALES_PRIMARY_ALL_HIST_AZURE`~~ — text not readable (no
   `VIEW DEFINITION` grant), but proven to be a **UNION of five feeds at
   different grains**. See §4.3. That is the answer the ELT needs.
2. ~~Full DDL / column types~~ — captured in §4.1. Note `YR_MN` is
   `nvarchar(24)` and all measures are `DECIMAL(38,18)`.
3. ~~`BUDGET` vs `BUDGET1`~~ — **`BUDGET1`**. §4.3.
4. ~~Disp = `NET_SALES` or `GROSS_SALES`?~~ — **`NET_SALES`** (user). §5.
5. ~~Zone/Region assignment~~ — the tree is Div→Zone→Region→Territory (user),
   but the source violates it in 80+ places. §4.3.
12. ~~Synapse pool type~~ — **dedicated SQL pool** (EngineEdition 6). DWU level
    and pause schedule still unknown; the catalogue view is not granted.
16. ~~Brand groupings for the mix pies~~ — currently a **hardcoded list**
    (Methycobal Group / Hapid / M Inj & Tab / Others) in the mock layer. It must
    become a stored attribute on `dim_brand`; the source has 110 brands and no
    grouping column.

**Still blocking Phase 2:**

6. Source for **TM headcount** by month and territory (the PCPM denominator).
   Nothing in the view carries a headcount. `BUDGET` was the only candidate and
   it is ruled out (§4.3).
7. Source for **secondary** (chemist-level) sales.
8. Source for **RCPA** plan and actual, and its definition.
9. How does the **CN split** Excel arrive, and how should it be ingested?
10. Fiscal year start month (April is assumed), and how "open month" is
    determined at close.
11. Expected concurrent users at peak (sizes the Redis tier and serving DB).
13. **Is a small Azure SQL serving database approved?** Now the single largest
    blocker — see §4.10. The supplied credentials are read-only against Synapse
    and there is no serving tier to write to, so Phase 2 cannot start.
14. Are existing Synapse Pipelines / ADF instances available for the load?
15. Expected fact-table growth rate (the §4.2 guidance flips at ~60M rows).

**New, raised by discovery:**

17. **Why is FY25-26 (202504–202603) absent from the view?** 12 consecutive
    months are missing, which makes every FY26-27 growth figure incomputable.
18. What is `BUDGET`? 209 rows, no dimension keys, non-integral values, ~4–6k
    per month. It is not the target and not a headcount.
19. The geography columns contain product names (`SPASMO PROXYVON PLUS 8C`,
    `DECDAN`) as region and HQ codes. Master-data fix at source?
20. Should the Excel's `Deviation`, `Effort`, `Mktng` and `Attrition` sheets be
    in scope at all? None of their data exists in this view (§1).

---

## 13. Deferred: user-defined charts

Not in v1. Two decisions now keep it cheap later.

**Do not write tab endpoints as bespoke SQL strings.** Route both the tab
endpoints and a future generic `/api/query` through the same `queryBuilder`
over the same star schema. If tab queries are one-off SQL, the chart builder
becomes a second system.

**Expose metadata from the start.** `GET /api/meta/model` returns available
dimensions and measures with types and valid aggregations:

```json
{
  "dimensions": [
    { "id": "brand", "label": "Brand", "table": "dim_brand" },
    { "id": "zone",  "label": "Zone",  "table": "dim_geo" }
  ],
  "measures": [
    { "id": "net_sales", "label": "Dispatch", "agg": "sum", "format": "currency" },
    { "id": "ach_pct",   "label": "Ach%",     "agg": "derived", "format": "percent" }
  ]
}
```

The builder then becomes mostly UI: drag a dimension to an axis, a measure to a
value, hand the result to an ECharts `dataset`. Strictly whitelist dimension and
measure ids against this metadata — user input never reaches SQL — and apply the
scope predicate server-side exactly as the tab endpoints do.
