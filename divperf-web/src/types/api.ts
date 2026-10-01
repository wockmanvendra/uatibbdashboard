/**
 * API response contract.
 *
 * THIS FILE IS MIRRORED BYTE-FOR-BYTE IN divperf-web/src/types/api.ts.
 * Per §2 the two repos duplicate it by hand in v1. If you change it here,
 * change it there in the same commit.
 *
 * Conventions:
 *  - `null` means "not computable" (zero denominator, or the source is missing).
 *    The frontend renders an em dash. Never send 0 for unknown. (§7.5)
 *  - Money is a full-precision number in rupees. Rounding is a render concern.
 *  - Percentages are already multiplied by 100 (87.5 means 87.5%).
 *  - Series are columnar: parallel arrays of primitives, not arrays of objects.
 */

/** Month key, e.g. 202608. The month key everywhere — state, params, cache. (I8) */
export type YrMn = number;

export type ScopeLevel = 'ALL' | 'DIVISION' | 'ZONE' | 'REGION' | 'HQ';

export type TabId =
  | 'division-performance'
  | 'brand-performance'
  | 'zone-performance'
  | 'region-performance'
  | 'hq-performance'
  | 'credit-note';

export type Grain = 'division' | 'brand' | 'zone' | 'region' | 'hq';

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export interface VersionResponse {
  dataVersion: string;
  openYrMn: YrMn;
  updatedAt: string;
}

export interface FilterOption {
  code: string;
  name: string;
}

export interface MonthOption {
  yrMn: YrMn;
  label: string;
  isClosed: boolean;
}

export interface FiltersResponse {
  divisions: FilterOption[];
  zones: FilterOption[];
  regions: FilterOption[];
  hqs: FilterOption[];
  brands: FilterOption[];
  months: MonthOption[];
}

export interface EffectiveScope {
  level: ScopeLevel;
  nodes: string[];
}

/**
 * A panel or column the source cannot populate, and why.
 *
 * The difference between "zero" and "we have no feed for this" is the whole
 * point: a panel rendering em dashes with no explanation reads as a bug, and a
 * manager will report it as one. The API knows the reason, so it says it.
 */
export interface Unavailable {
  /** Panel or field id, e.g. "pcpm", "keyBrands.coll", "trends.rcpa". */
  key: string;
  /** What is missing, in the user's vocabulary. */
  label: string;
  /** Why, in one sentence. */
  reason: string;
}

export interface TabMeta {
  tab: TabId;
  dataVersion: string;
  from: YrMn;
  to: YrMn;
  /** Months in the selected range taken from dim_date, not `to - from`. (§5) */
  monthCount: number;
  effectiveScope: EffectiveScope;
  /** Fact rows whose dimension resolved to the reserved -1 "Unassigned" key. (§4.3) */
  unassignedRows: number;
  cached: boolean;
  queryMs: number;
  /**
   * Prior-year window used for Gr%. Null when that window holds no data, in
   * which case every `gr` field in the response is null.
   */
  priorFrom: YrMn | null;
  priorTo: YrMn | null;
  /**
   * Panels and columns this tab cannot fill from the current source.
   * Empty once every feed in §4.4 exists.
   */
  unavailable: Unavailable[];
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/** One KPI: an additive value plus the two derived ratios computed at read time. */
export interface Metric {
  value: number | null;
  /** actual / budget * 100 */
  ach: number | null;
  /** vs the same month range one year earlier, * 100 */
  gr: number | null;
}

/** Excel "Primary" card: rows Tgt / Coll / Disp x columns Value / Ach% / Gr%. */
export interface PrimaryPanel {
  target: Metric;
  collection: Metric;
  dispatch: Metric;
}

/** Excel "PCPM" card. PCPM = Collection / Budgeted TMs / Months. (§5) */
export interface PcpmPanel {
  budgetTm: number | null;
  pcpmCollection: number | null;
}

/** Excel "Secondary" card, which also carries Inventory. */
export interface SecondaryPanel {
  value: number | null;
  grPct: number | null;
}

/** Excel "RCPA Value" card: Plan / Actual / Ach% / Gr%. */
export interface RcpaPanel {
  plan: number | null;
  actual: number | null;
  achPct: number | null;
  grPct: number | null;
}

/** Inventory = stock + GIT. (§5) */
export interface InventoryPanel {
  value: number | null;
}

/**
 * Excel "Key Brands Performance" table.
 * Columnar to keep the payload small and to feed ECharts datasets directly.
 */
export const KEY_BRAND_COLUMNS = [
  'brand',
  'tgt',
  'disp',
  'coll',
  'achOnColl',
  'grPct',
  'sec',
  'inventory',
  'rcpa',
] as const;
export type KeyBrandColumn = (typeof KEY_BRAND_COLUMNS)[number];
export type KeyBrandRow = [
  brand: string,
  tgt: number | null,
  disp: number | null,
  coll: number | null,
  achOnColl: number | null,
  grPct: number | null,
  sec: number | null,
  inventory: number | null,
  rcpa: number | null,
];

export interface KeyBrandsPanel {
  columns: readonly KeyBrandColumn[];
  rows: KeyBrandRow[];
}

/** Excel "CN and O/S" card. */
export interface CreditNotePanel {
  totalCn: number | null;
  expCn: number | null;
  srCn: number | null;
  pdCn: number | null;
  totalOs: number | null;
  /** CN as % of gross sales. */
  cnPct: number | null;
  /** Each CN type as % of gross sales, index-parallel to the fields above. */
  expCnPct: number | null;
  srCnPct: number | null;
  pdCnPct: number | null;
  osPct: number | null;
}

/**
 * Excel "Zonal / Regional / HQ Performance" grid — one row per geo node at the
 * tab's grain, plus a Total row served separately so the client never sums.
 */
export const GEO_COLUMNS = [
  'name',
  'tgt',
  'disp',
  'dispGrPct',
  'coll',
  'achOnColl',
  'collGrPct',
  'pcpmColl',
  'creditNote',
  'cnPct',
  'sec',
  'inventoryValue',
  'rcpa',
  'rcpaPctToSec',
] as const;
export type GeoColumn = (typeof GEO_COLUMNS)[number];
export type GeoRow = [
  name: string,
  tgt: number | null,
  disp: number | null,
  dispGrPct: number | null,
  coll: number | null,
  achOnColl: number | null,
  collGrPct: number | null,
  pcpmColl: number | null,
  creditNote: number | null,
  cnPct: number | null,
  sec: number | null,
  inventoryValue: number | null,
  rcpa: number | null,
  rcpaPctToSec: number | null,
];

export interface GeoTablePanel {
  grain: Grain;
  columns: readonly GeoColumn[];
  /** Codes parallel to `rows`, for drill-down and filter round-tripping. */
  codes: string[];
  rows: GeoRow[];
  /** Server-computed, never derived in the client. (I3) */
  total: GeoRow;
  /** Header chips: "Zones on Tgt (xx)", "Growing (xx)", "Degrowing (xx)". */
  onTargetCount: number;
  growingCount: number;
  degrowingCount: number;
}

/**
 * All trend series for the tab, in one object.
 * Every array is parallel to `months`/`labels`. A series the tab does not use
 * is omitted, not sent as an array of nulls.
 */
export interface TrendsPanel {
  months: YrMn[];
  labels: string[];
  /** Chart "Disp, Sec, RCPA, PCPM" — three bars plus a PCPM line on axis 2. */
  disp?: (number | null)[];
  sec?: (number | null)[];
  rcpa?: (number | null)[];
  pcpm?: (number | null)[];
  /** Chart "Tgt vs. Disp vs. Coll". */
  tgt?: (number | null)[];
  coll?: (number | null)[];
  /** Chart "Target vs Ach% & Gr%": collection achievement, and dispatch growth
   *  against the same month a year earlier. */
  achPct?: (number | null)[];
  grPct?: (number | null)[];
  /** Chart "RCPA Plan vs. Actual" — bars plus a Value/Dr line on axis 2. */
  rcpaPlan?: (number | null)[];
  rcpaActual?: (number | null)[];
  valuePerDr?: (number | null)[];
  /** Chart "Credit Note" — stacked bars plus a CN% line on axis 2. */
  cnExp?: (number | null)[];
  cnSr?: (number | null)[];
  cnPd?: (number | null)[];
  cnPct?: (number | null)[];
}

/** The four mix donuts, all sharing one label set. */
export interface MixPanel {
  dimension: 'brandGroup' | 'brand' | 'zone' | 'region' | 'hq';
  labels: string[];
  disp: (number | null)[];
  coll: (number | null)[];
  sec: (number | null)[];
  rcpa: (number | null)[];
}

/** Credit Note tab: CN split by stockist and by SKU. */
export const CN_DETAIL_COLUMNS = ['name', 'code', 'expCn', 'srCn', 'pdCn', 'totalCn', 'cnPct'] as const;
export type CnDetailColumn = (typeof CN_DETAIL_COLUMNS)[number];
export type CnDetailRow = [
  name: string,
  code: string,
  expCn: number | null,
  srCn: number | null,
  pdCn: number | null,
  totalCn: number | null,
  cnPct: number | null,
];

export interface CnDetailPanel {
  columns: readonly CnDetailColumn[];
  byStockist: CnDetailRow[];
  bySku: CnDetailRow[];
}

// ---------------------------------------------------------------------------
// Tab response
// ---------------------------------------------------------------------------

/** Panels a tab may declare. Kept in sync with the tab registry in both repos. */
export type PanelId =
  | 'primary'
  | 'pcpm'
  | 'secondary'
  | 'rcpa'
  | 'inventory'
  | 'keyBrands'
  | 'creditNote'
  | 'geoTable'
  | 'trends'
  | 'mix'
  | 'cnDetail';

/**
 * One request per tab, every panel in one object. (I2)
 * Panels the tab does not use are omitted entirely, not sent as null. (§7.5)
 */
export interface TabResponse {
  meta: TabMeta;
  primary?: PrimaryPanel;
  pcpm?: PcpmPanel;
  secondary?: SecondaryPanel;
  rcpa?: RcpaPanel;
  inventory?: InventoryPanel;
  keyBrands?: KeyBrandsPanel;
  creditNote?: CreditNotePanel;
  geoTable?: GeoTablePanel;
  trends?: TrendsPanel;
  mix?: MixPanel;
  cnDetail?: CnDetailPanel;
}

// ---------------------------------------------------------------------------
// Auth — mobile number + one-time password
// ---------------------------------------------------------------------------

/** A display label only: what a user sees is their scope. (§6.1) */
export type UserRole = 'tm' | 'rm' | 'zsm' | 'nsm';

export interface OtpRequestBody {
  mobile: string;
}

export interface OtpRequestResponse {
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Outside production only; the login screen shows it, for testing. */
  devOtp?: string;
}

export interface OtpVerifyBody {
  mobile: string;
  otp: string;
}

export interface SessionUser {
  id: string;
  name: string;
  role: UserRole;
  mobile: string;
  scopeId: string;
  effectiveScope: EffectiveScope;
}

export interface LoginResponse {
  token: string;
  user: SessionUser;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'SCOPE_EMPTY'
  | 'NOT_FOUND'
  | 'TOO_MANY_REQUESTS'
  | 'UPSTREAM_TIMEOUT'
  | 'INTERNAL';

export interface ApiError {
  error: {
    code: ErrorCode;
    /** User-facing: plain, specific, and about what to do next. Never SQL. */
    message: string;
  };
}
