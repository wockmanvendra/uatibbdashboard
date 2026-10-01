/**
 * SQL building blocks. Every measure definition and every dimension expression
 * lives here exactly once, so a definition change is one edit rather than a
 * hunt through the panel files.
 *
 * Everything the dashboard shows comes from ONE table, Infinity.Infinity_Reports
 * (config DASHBOARD_TABLE): sales, target, collection, credit notes,
 * outstanding, stock, secondary and RCPA, by division / zone / region / HQ /
 * brand / month.
 *
 *   Tgt   = BUDGET1                 BUDGET is zero throughout
 *   Disp  = NET_SALES
 *   Coll  = -COLLECTION             stored as a credit: almost every row is negative
 *   Gross = NET_SALES + CR_NOTES
 *   Inv   = STOCK + GIT
 *   Sec   = secondary
 *   RCPA  = RCPA_VALUE
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

/** Additive measures. Ratios are never stored and never summed. (I4) */
export const MEASURES = {
  tgt: whenPresent(sum('BUDGET1'), 'BUDGET1'),
  disp: whenPresent(sum('NET_SALES'), 'NET_SALES'),
  gross: whenPresent(`${sum('NET_SALES')} + ${sum('CR_NOTES')}`, 'NET_SALES', 'CR_NOTES'),
  coll: whenPresent(`-${sum('COLLECTION')}`, 'COLLECTION'),
  cn: whenPresent(sum('CR_NOTES'), 'CR_NOTES'),
  os: whenPresent(sum('OS'), 'OS'),
  inventory: whenPresent(`${sum('STOCK')} + ${sum('GIT')}`, 'STOCK', 'GIT'),
  sec: whenPresent(sum('secondary'), 'secondary'),
  rcpa: whenPresent(sum('RCPA_VALUE'), 'RCPA_VALUE'),
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
  `${R(MEASURES.cn)} AS cn`,
  `${R(MEASURES.os)} AS os`,
  `${R(MEASURES.inventory)} AS inventory`,
  `${R(MEASURES.sec)} AS sec`,
  `${R(MEASURES.rcpa)} AS rcpa`,
  `${MEASURES.rows} AS src_rows`,
].join(',\n    ');

/** The shape every panel query returns for its measures. */
export interface MeasureRow {
  tgt: string | number | null;
  disp: string | number | null;
  gross: string | number | null;
  coll: string | number | null;
  cn: string | number | null;
  os: string | number | null;
  inventory: string | number | null;
  sec: string | number | null;
  rcpa: string | number | null;
  src_rows: string | number | null;
}

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

