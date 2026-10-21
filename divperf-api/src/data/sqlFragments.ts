/**
 * SQL building blocks. Every measure definition and every dimension expression
 * lives here exactly once, so a definition change is one edit rather than a
 * hunt through the panel files.
 *
 * Two sources:
 *
 * Infinity.Infinity_Reports (config DASHBOARD_TABLE) — sales, target,
 * collection, outstanding, stock, secondary and RCPA, by division / zone /
 * region / HQ / brand / month.
 *
 *   Tgt   = BUDGET1                 BUDGET is zero throughout
 *   Disp  = NET_SALES
 *   Coll  = -COLLECTION             stored as a credit: almost every row is negative
 *   Brand Coll = -COLLECTION_MATERIAL  collection split by product, on rows that
 *                                   carry the brand — COLLECTION itself has
 *                                   none. Net of GST: about 5% below Coll.
 *   Gross = GROSS_SALES             equals NET_SALES + CR_NOTES row for row
 *   O/S   = OS                      a balance: the period's closing value
 *   Inv   = STOCK + GIT             a balance: the period's closing value
 *   Sec   = secondary
 *   RCPA  = RCPA_VALUE
 *   Rxns  = RXN_TOT                 prescriptions
 *   Rxber = DR_TOT                  prescribers — per SKU, so a doctor writing
 *                                   several SKUs counts once for each; there is
 *                                   no doctor id to de-duplicate on
 *
 * Infinity.VW_Credit_Note_Details (config CN_TABLE) — every credit-note figure,
 * by division / territory / product / month:
 *
 *   Exp CN = Breakage_Expiry
 *   SRCN   = SalesReturn_CreditNote
 *   PD CN  = PriceDifference_CreditNote
 *   CN     = Total_CreditNote       always Exp + SR + PD exactly
 *
 * The view carries no zone, region or brand. Zone and region come from the
 * territory lookup below (each division + territory sits in exactly one zone
 * and region), and a brand filter matches the products that carry that brand.
 * CR_NOTES in Infinity_Reports is a different, sales-side credit-note figure
 * and is not shown.
 *
 * The table is zero-filled: a month a measure has no data for still has rows,
 * with 0. So every measure is NULL — rendered as an em dash — when the window
 * holds no non-zero value for it; a plain SUM would report 0, which reads as
 * "nothing sold" rather than "no data".
 *
 * Hierarchy codes are blank strings as well as nulls, so everything goes
 * through `code()`.
 */
import { config } from '../config.js';

/** The table every panel reads. */
export const SOURCE = config.DASHBOARD_TABLE;

/** The month column: nvarchar 'YYYYMM', compared as text and cast to int once. (I8) */
export const MONTH_COL = 'yearMonth';
export const DATE_KEY = `CAST(${MONTH_COL} AS INT)`;

export const UNASSIGNED = 'Unassigned';

const DEC = 'DECIMAL(38,6)';

/** Normalises a hierarchy code: trims, folds blank to null. */
export const code = (col: string) => `NULLIF(LTRIM(RTRIM(${col})), '')`;

/** Same, but with the display fallback applied — safe to GROUP BY and return. */
export const codeOrUnassigned = (col: string) =>
  `COALESCE(${code(col)}, '${UNASSIGNED}')`;

/** `expr`, or NULL when none of `cols` has a non-zero value in the group. */
const whenPresent = (expr: string, ...cols: string[]) =>
  `CASE WHEN ${cols.map((c) => `COUNT(NULLIF(${c}, 0))`).join(' + ')} = 0 THEN NULL ELSE ${expr} END`;

const sum = (col: string) => `SUM(CAST(${col} AS ${DEC}))`;

/** Additive measures — monthly flows. Ratios are never stored and never summed. (I4) */
export const MEASURES = {
  tgt: whenPresent(sum('BUDGET1'), 'BUDGET1'),
  disp: whenPresent(sum('NET_SALES'), 'NET_SALES'),
  gross: whenPresent(sum('GROSS_SALES'), 'GROSS_SALES'),
  coll: whenPresent(`-${sum('COLLECTION')}`, 'COLLECTION'),
  collMat: whenPresent(`-${sum('COLLECTION_MATERIAL')}`, 'COLLECTION_MATERIAL'),
  sec: whenPresent(sum('secondary'), 'secondary'),
  rcpa: whenPresent(sum('RCPA_VALUE'), 'RCPA_VALUE'),
  rxns: whenPresent(sum('RXN_TOT'), 'RXN_TOT'),
  rxber: whenPresent(sum('DR_TOT'), 'DR_TOT'),
  /** Months with any prescriber count — Rxber's per-month divisor. */
  rxMonths: `COUNT(DISTINCT CASE WHEN DR_TOT <> 0 THEN ${MONTH_COL} END)`,
  rows: 'COUNT_BIG(*)',
} as const;

/** Rounded to paise so the wire format does not carry float noise. */
const R = (e: string) => `CAST(${e} AS DECIMAL(38,2))`;

/**
 * The measure list every panel selects. Kept identical across panels so the
 * row shape is one TypeScript type.
 */
export const MEASURE_SELECT = [
  `${R(MEASURES.tgt)} AS tgt`,
  `${R(MEASURES.disp)} AS disp`,
  `${R(MEASURES.gross)} AS gross`,
  `${R(MEASURES.coll)} AS coll`,
  `${R(MEASURES.collMat)} AS coll_mat`,
  `${R(MEASURES.sec)} AS sec`,
  `${R(MEASURES.rcpa)} AS rcpa`,
  `${R(MEASURES.rxns)} AS rxns`,
  `${R(MEASURES.rxber)} AS rxber`,
  `${MEASURES.rxMonths} AS rx_months`,
  `${MEASURES.rows} AS src_rows`,
].join(',\n    ');

/** The shape every panel query returns for its measures. */
export interface MeasureRow {
  tgt: string | number | null;
  disp: string | number | null;
  gross: string | number | null;
  coll: string | number | null;
  coll_mat: string | number | null;
  sec: string | number | null;
  rcpa: string | number | null;
  rxns: string | number | null;
  rxber: string | number | null;
  rx_months: string | number | null;
  src_rows: string | number | null;
}

/**
 * Balances — outstanding, stock and goods in transit — are month-end
 * positions, not monthly flows: Sep-2026, with a day of sales, carries 2,727 L
 * of stock and 823 L of O/S for division 85. Summed over a period they count
 * the same money once per month, so a period's balance is its closing one —
 * the value in its last month, bound as @closeMonth (`closingMonth()`). NULL
 * when that month holds no non-zero value.
 */
const closing = (expr: string, ...cols: string[]) => {
  const inMonth = `${MONTH_COL} = @closeMonth`;
  const present = cols.map((c) => `${c} <> 0`).join(' OR ');
  return `CASE WHEN COUNT(CASE WHEN ${inMonth} AND (${present}) THEN 1 END) = 0 THEN NULL
      ELSE SUM(CASE WHEN ${inMonth} THEN ${expr} END) END`;
};

export const BALANCE_SELECT = [
  `${R(closing(`CAST(OS AS ${DEC})`, 'OS'))} AS os`,
  `${R(closing(`CAST(STOCK AS ${DEC}) + CAST(GIT AS ${DEC})`, 'STOCK', 'GIT'))} AS inventory`,
].join(',\n    ');

export interface BalanceRow {
  os: string | number | null;
  inventory: string | number | null;
}

/** The parameter BALANCE_SELECT reads: the period's last month. */
export const closingMonth = (to: number) => ({ closeMonth: String(to) });

/**
 * `mssql` returns DECIMAL as a string to avoid precision loss. Convert once,
 * here, so no panel has to remember. An absent value stays null rather than
 * becoming 0 — the frontend renders an em dash. (§7.5)
 */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Hierarchy columns, by the grain the dashboard groups on. The HQ is the SAP
 * territory code — the same code a TM's Infinity field structure carries.
 * TERRITORY_NAME is filled only where the territory is mapped to a region, so
 * an HQ without it is shown by its code.
 */
export const DIMENSION = {
  division: { codeCol: 'Division_Code', nameCol: 'Div_Name' },
  zone: { codeCol: 'ZONE_CODE', nameCol: 'ZONE_NAME' },
  region: { codeCol: 'REGION_CODE', nameCol: 'REGION_NAME' },
  hq: { codeCol: 'SAP_Code', nameCol: 'TERRITORY_NAME' },
  brand: { codeCol: 'Brand', nameCol: 'Brand' },
} as const;

export type DimensionName = keyof typeof DIMENSION;


// ---------------------------------------------------------------------------
// Credit notes

/** The credit-note view, always read under this alias. */
export const CN_SOURCE = config.CN_TABLE;
export const CN_ALIAS = 'c';
/** The territory lookup, joined to the credit notes under this alias. */
export const TERRITORY_ALIAS = 't';

const cnCol = (col: string) => `${CN_ALIAS}.${col}`;

/** Credit-note measures, each NULL when the window holds no non-zero value. */
export const CN_MEASURES = {
  exp: whenPresent(sum(cnCol('Breakage_Expiry')), cnCol('Breakage_Expiry')),
  sr: whenPresent(sum(cnCol('SalesReturn_CreditNote')), cnCol('SalesReturn_CreditNote')),
  pd: whenPresent(sum(cnCol('PriceDifference_CreditNote')), cnCol('PriceDifference_CreditNote')),
  total: whenPresent(sum(cnCol('Total_CreditNote')), cnCol('Total_CreditNote')),
} as const;

/**
 * The same amount over only the months the sales table has sales for, bound as
 * @gFrom..@gTo — CN%'s numerator. Credit notes run from Apr-2025 but sales from
 * Apr-2026, so a period reaching back before the sales would otherwise set a
 * year of credit notes against a few months of sales.
 */
const inSalesMonths = (col: string) =>
  `SUM(CASE WHEN ${MONTH_COL} BETWEEN @gFrom AND @gTo THEN CAST(${col} AS ${DEC}) ELSE 0 END)`;

const CN_COLS = {
  exp: cnCol('Breakage_Expiry'),
  sr: cnCol('SalesReturn_CreditNote'),
  pd: cnCol('PriceDifference_CreditNote'),
  total: cnCol('Total_CreditNote'),
} as const;

/**
 * Every credit-note query's measures: each amount over the whole period, and
 * (`_p` columns) over its months with sales. With `salesMonths` false — no
 * month of the period has sales — the `_p` columns are NULL and CN% is blank.
 */
export const cnMeasureSelect = (salesMonths: boolean) =>
  (Object.keys(CN_COLS) as (keyof typeof CN_COLS)[])
    .flatMap((k) => [
      `${R(CN_MEASURES[k])} AS cn_${k}`,
      salesMonths ? `${R(inSalesMonths(CN_COLS[k]))} AS cn_${k}_p` : `CAST(NULL AS DECIMAL(38,2)) AS cn_${k}_p`,
    ])
    .join(',\n    ');

export interface CnMeasureRow {
  cn_exp: string | number | null;
  cn_sr: string | number | null;
  cn_pd: string | number | null;
  cn_total: string | number | null;
  cn_exp_p: string | number | null;
  cn_sr_p: string | number | null;
  cn_pd_p: string | number | null;
  cn_total_p: string | number | null;
}

/** The view's columns for the dimensions it carries itself. */
export const CN_COLUMN = {
  division: cnCol('Division_Code'),
  hq: cnCol('TERRITORY_CODE'),
  product: cnCol('Product_code'),
} as const;

/**
 * Zone and region (and display names) for each division + territory, from the
 * sales table — the only place the hierarchy lives. Grouped so the join can
 * never fan a row out into two, even if a territory were ever realigned
 * mid-history (today each has exactly one zone and region). `divisionExpr`
 * and `hqExpr` are the joining source's normalised division and HQ codes.
 */
export const territoryJoin = (divisionExpr: string, hqExpr: string, kind = 'LEFT JOIN') => `${kind} (
    SELECT ${code(DIMENSION.division.codeCol)} AS div_code,
           ${code(DIMENSION.hq.codeCol)} AS hq_code,
           MAX(${code(DIMENSION.zone.codeCol)}) AS zone_code,
           MAX(${code(DIMENSION.zone.nameCol)}) AS zone_name,
           MAX(${code(DIMENSION.region.codeCol)}) AS region_code,
           MAX(${code(DIMENSION.region.nameCol)}) AS region_name,
           MAX(${code(DIMENSION.hq.nameCol)}) AS hq_name
      FROM ${SOURCE}
     WHERE ${code(DIMENSION.hq.codeCol)} IS NOT NULL
     GROUP BY ${code(DIMENSION.division.codeCol)}, ${code(DIMENSION.hq.codeCol)}
  ) ${TERRITORY_ALIAS}
    ON ${TERRITORY_ALIAS}.div_code = ${divisionExpr}
   AND ${TERRITORY_ALIAS}.hq_code = ${hqExpr}`;

/** The credit notes' territory lookup. */
export const TERRITORY_JOIN = territoryJoin(code(CN_COLUMN.division), code(CN_COLUMN.hq));

/** The sales table's product code as the view's integer key. */
export const PRODUCT_KEY = `TRY_CAST(${code('Product_code')} AS INT)`;

// ---------------------------------------------------------------------------
// Field force (SAP HR): leavers and joiners, one row per person. See
// panels/manpower.ts for how they are counted.

export const HR_EXIT_SOURCE = config.HR_EXIT_TABLE;
export const HR_HIRING_SOURCE = config.HR_HIRING_TABLE;

// ---------------------------------------------------------------------------
// Doctor coverage and call effort (config EFFORT_TABLE). See panels/effort.ts.

export const EFFORT_SOURCE = config.EFFORT_TABLE;
/** The effort rows, read through a derived table under this alias. */
export const EFFORT_ALIAS = 'ef';

// ---------------------------------------------------------------------------
// Headcount: budgeted TMs and TMs in place, by division and HQ, no month. See
// panels/headcount.ts.

export const BUDGET_TM_SOURCE = config.BUDGET_TM_TABLE;
export const EMP_COUNT_SOURCE = config.EMP_COUNT_TABLE;

// ---------------------------------------------------------------------------
// Doctor visits (config VISIT_SUMMARY_TABLE): one row per doctor, territory and
// month. See panels/missedDoctors.ts.

export const VISIT_SOURCE = config.VISIT_SUMMARY_TABLE;
