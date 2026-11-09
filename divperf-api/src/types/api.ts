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
  | 'zone-performance'
  | 'region-performance'
  | 'hq-performance'
  | 'credit-note'
  | 'stockist-performance';

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
  /** When these figures were read from the warehouse (ISO 8601). */
  builtAt: string;
  /**
   * The source has changed since `builtAt`: these are the previous figures,
   * served at once while the view is rebuilt. Ask again shortly for the new ones.
   */
  refreshing: boolean;
  /**
   * Prior-year window used for Gr%. Null when that window holds no data, in
   * which case every `gr` field in the response is null.
   */
  priorFrom: YrMn | null;
  priorTo: YrMn | null;
  /**
   * The months every CN% on the page covers: the part of the period the sales
   * table has sales for. Credit notes start a year before the sales, so a
   * period reaching back past them sets only these months' credit notes
   * against the gross sales. Equal to from/to unless the period reaches past
   * the sales; null when no month of it has sales (CN% is then blank).
   */
  cnPctFrom: YrMn | null;
  cnPctTo: YrMn | null;
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
  /** The field budget (BUDGET1). Every `ach` is on it. */
  target: Metric;
  collection: Metric;
  dispatch: Metric;
  /**
   * The division budget (BUDGET), with achievement on it, shown beside the
   * field one. It is set per division and month only: null when the view is
   * narrowed to a zone, region, HQ or brand — always, for TMs, RMs and ZSMs.
   */
  divisionTarget: DivisionTarget | null;
}

export interface DivisionTarget {
  value: number | null;
  /** Collection and dispatch as % of the division budget. */
  collAch: number | null;
  dispAch: number | null;
  /** Against the same months a year earlier. */
  gr: number | null;
}

/**
 * Excel "PCPM" card. Budget TM is the budgeted TMs (Infinity.budgeted_tm);
 * PCPM (Coll) = Collection ÷ TMs in place (Infinity.vw_emp_count) ÷ months.
 */
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
  'dispGrPct',
  'coll',
  'achOnColl',
  'collGrPct',
  'creditNote',
  'cnPct',
  'sec',
  'inventory',
  'rcpa',
  'rcpaPctToSec',
] as const;
export type KeyBrandColumn = (typeof KEY_BRAND_COLUMNS)[number];
export type KeyBrandRow = [
  brand: string,
  tgt: number | null,
  disp: number | null,
  dispGrPct: number | null,
  coll: number | null,
  achOnColl: number | null,
  collGrPct: number | null,
  creditNote: number | null,
  cnPct: number | null,
  sec: number | null,
  inventory: number | null,
  rcpa: number | null,
  rcpaPctToSec: number | null,
];

export interface KeyBrandsPanel {
  columns: readonly KeyBrandColumn[];
  rows: KeyBrandRow[];
  /** The selection's totals — the grid lists the top brands only. */
  total?: KeyBrandRow;
  /** A caveat on the figures, shown under the grid. */
  note?: string;
}

/**
 * Excel "CN and O/S" card. Credit notes come from Infinity.VW_Credit_Note_Details
 * (Exp + SR + PD = total, exactly) and cover the whole period; their % covers
 * meta.cnPctFrom..cnPctTo. O/S and the gross-sales denominator come from
 * Infinity.Infinity_Reports.
 */
export interface CreditNotePanel {
  totalCn: number | null;
  expCn: number | null;
  srCn: number | null;
  pdCn: number | null;
  /** Closing outstanding: the balance in the period's last month, never a sum of months. */
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
  'achOnDisp',
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
  /** Dispatch as % of the target. Last, so the earlier positions keep their meaning. */
  achOnDisp: number | null,
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
 * The "Stockist" grid — primary (dispatch), collection and secondary per
 * stockist in the selection, with growth on the same months a year earlier.
 * The source keeps no target per stockist, so there is no Tgt or Ach%. O/S is
 * the closing outstanding: the value in the period's last month.
 */
export const STOCKIST_COLUMNS = [
  'stockist',
  'code',
  'hq',
  'hqName',
  'disp',
  'dispGrPct',
  'coll',
  'collGrPct',
  'sec',
  'secGrPct',
  'os',
] as const;
export type StockistColumn = (typeof STOCKIST_COLUMNS)[number];
export type StockistRow = [
  stockist: string,
  code: string,
  /** The SAP codes of the HQs it has rows under this period: "94CHEN, WTCHEN". */
  hq: string,
  /** Those HQs' names, each once: "Chennai". */
  hqName: string,
  disp: number | null,
  dispGrPct: number | null,
  coll: number | null,
  collGrPct: number | null,
  sec: number | null,
  secGrPct: number | null,
  os: number | null,
];

export interface StockistTablePanel {
  columns: readonly StockistColumn[];
  /** Largest dispatch first. */
  rows: StockistRow[];
  /** Server-computed, never derived in the client. (I3) */
  total: StockistRow;
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
  /** The division budget by month; omitted for a view below the division. */
  divTgt?: (number | null)[];
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
  /** Chart "Rx, Rxber, P/D": prescriptions and prescribers per month, and their ratio. */
  rxns?: (number | null)[];
  rxber?: (number | null)[];
  rxPd?: (number | null)[];
  /** Chart "Attrition": leavers per month (by DOL), by cadre. */
  leftTm?: (number | null)[];
  leftRm?: (number | null)[];
  leftZsm?: (number | null)[];
}

/** The four mix donuts, all sharing one label set. */
/** One pie: its slices' names and values, largest first. */
export interface MixSeries {
  labels: string[];
  values: (number | null)[];
}

/**
 * The BRAND MIX pies, each with its own slices. Dispatch shows its top brands
 * plus "Others". Secondary and RCPA name brands differently from dispatch
 * (WOSULIN CART, not WOSULIN CTG), so they show every brand they have — or
 * just the brands chosen in the filter.
 */
export interface MixPanel {
  dimension: 'brandGroup' | 'brand' | 'zone' | 'region' | 'hq';
  disp: MixSeries;
  coll: MixSeries;
  sec: MixSeries;
  rcpa: MixSeries;
  /** A caveat on the Collection pie. */
  collNote?: string;
}

/**
 * Credit Note tab: the CN split by HQ (territory) and by SKU (product). The
 * source has no stockist, so the HQ grid stands where the Excel's stockist one
 * did. A SKU's name is its brand; `code` is the product code.
 */
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
  byHq: CnDetailRow[];
  bySku: CnDetailRow[];
}

/** People, by cadre. A count: 0 means none, not "no data". */
export interface CadreCounts {
  tm: number;
  rm: number;
  zsm: number;
}

/** Leavers by tenure at exit, DOL − DOJ. */
export interface TenureCounts {
  under6m: number;
  m6to12: number;
  over1y: number;
}

/**
 * Field-force movement in the period, from Infinity.VW_Exit_Details (leavers,
 * counted in the month of their DOL) and Infinity.VW_Hiring_Details (joiners,
 * in their joining month), by cadre. Division-level only: the views carry a
 * cost centre, not a zone, region or HQ.
 */
/** A figure for the period and its growth on the same months a year earlier. */
export interface ValueGr {
  value: number | null;
  gr: number | null;
}

/**
 * Excel "Rx, Rxber, P/D", from Infinity.Infinity_Reports: prescriptions
 * (RXN_TOT) and prescribers (DR_TOT). Prescribers are counted per SKU, so a
 * doctor writing several SKUs counts once for each.
 */
export interface RxPanel {
  /** Prescriptions in the period. */
  rxns: ValueGr;
  /** Prescribers per month, averaged over the months with Rx data. */
  rxber: ValueGr;
  /** P/D/M = Rxns ÷ Rxber, the two figures above. */
  pdm: ValueGr;
  /** The months of the period that have Rx data; null when none do. */
  from: YrMn | null;
  to: YrMn | null;
}

export interface ManpowerPanel {
  left: CadreCounts;
  joined: CadreCounts;
  leftByTenure: { tm: TenureCounts; rm: TenureCounts; zsm: TenureCounts };
}

/**
 * One period's (or one month's) field effort, from the Infinity effort data's
 * territory rows. Over several months, doctor counts and field days are per
 * month, averaged over the months with effort data; the percentages and Call
 * Avg come from the summed counts.
 */
export interface EffortFigures {
  /** Doctors on the list: all, and by category. A+ has no source. */
  drs: number | null;
  aPlus: number | null;
  a: number | null;
  b: number | null;
  c: number | null;
  /** Doctors met, and as a % of the list. */
  drsMet: number | null;
  coveragePct: number | null;
  /** No source: the data has a right-frequency %, not a count. */
  drsMetRtFrq: number | null;
  /** Doctors met at their right frequency, as a % of the list. */
  rtFrqCoveragePct: number | null;
  /** Doctor calls per field day. */
  callAvg: number | null;
  /** No source yet. */
  drsMissed: number | null;
  missedRtFrq: number | null;
  /** Field days per working territory. */
  fieldDays: number | null;
}

export interface EffortMonth extends EffortFigures {
  yrMn: YrMn;
  label: string;
}

/** The "Effort Dashboard" block. */
export interface EffortPanel {
  total: EffortFigures;
  /** Each month of the period that has effort data, oldest first. */
  months: EffortMonth[];
  /**
   * Missed doctors (visit summary, tmVisitCounts = 0) by category — A, B, C
   * first, then the rest. Null when the period has no visit data.
   */
  missedByCategory?: { labels: string[]; values: number[] } | null;
}

// ---------------------------------------------------------------------------
// Hospital coverage & tier mix (RESEARCH)
// ---------------------------------------------------------------------------

/** One column of the HML table: a tier, or the total. */
export interface HospitalTierFigures {
  label: string;
  /** Hospitals in the master list. */
  count: number;
  /** No source yet: visits are not recorded per hospital. */
  covered: number | null;
  coveredPct: number | null;
  missed: number | null;
}

/** Hospitals covered and missed in a month, from the effort data's per-territory counts. */
export interface HospitalMonth {
  yrMn: YrMn;
  label: string;
  /** Hospitals on the territories' lists. */
  total: number | null;
  covered: number | null;
  missed: number | null;
  coveragePct: number | null;
}

/**
 * The "Hospital Coverage & Tier Mix" block, from the hospital master list
 * (Infinity.Hospital_List). Shown for RESEARCH only; null for other views.
 */
export interface HospitalPanel {
  total: HospitalTierFigures;
  /** Tier I – IV. */
  tiers: HospitalTierFigures[];
  /** Hospitals with no tier: in the total, in no tier column. */
  untiered: number;
  /** Each month of the period with hospital lists in the effort data. */
  months: HospitalMonth[];
}

// ---------------------------------------------------------------------------
// Detail lists — GET /api/details/:list
// ---------------------------------------------------------------------------

/**
 * The lists behind clickable figures, opened in the side panel:
 *   doctors       visit summary; status all | met | missed (tmVisitCounts = 0)
 *   leavers       SAP HR exits (division level)
 *   joiners       SAP HR hires (division level)
 *   tm-effort     effort data, one row per territory and month
 *   hq-headcount  budgeted TMs, TMs in place, collection and PCPM per HQ
 *   hospitals     the hospital master list (RESEARCH)
 */
export type DetailListId = 'doctors' | 'leavers' | 'joiners' | 'tm-effort' | 'hq-headcount' | 'hospitals';

/** How a column's values are shown: money in lakhs, months as Mon-YY, dates as DD-Mon-YYYY. */
export type DetailFormat = 'text' | 'number' | 'decimal' | 'percent' | 'money' | 'month' | 'date';

export interface DetailColumn {
  key: string;
  label: string;
  format: DetailFormat;
}

/** A group of filter chips; the chosen value goes back as the query parameter `key`. */
export interface DetailFacet {
  key: string;
  label: string;
  /** The first option is the default. */
  options: { value: string; label: string }[];
}

export interface DetailListResponse {
  title: string;
  columns: DetailColumn[];
  facets: DetailFacet[];
  rows: Record<string, string | number | null>[];
  /** Rows matching the filters, search and facets — every page together. */
  total: number;
  page: number;
  pageSize: number;
  /** A caveat shown above the list. */
  note?: string;
  /** Why this view cannot show the list; the rows are then empty. */
  unavailable?: string;
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
  | 'cnDetail'
  | 'manpower'
  | 'rx'
  | 'effort'
  | 'hospitals'
  | 'stockistTable';

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
  /** Null when the tab has the panel but this view cannot fill it — see meta.unavailable. */
  manpower?: ManpowerPanel | null;
  rx?: RxPanel;
  /** Null when the tab has the panel but this view cannot fill it — see meta.unavailable. */
  effort?: EffortPanel | null;
  /** Null when the view is not RESEARCH: the section is not shown. */
  hospitals?: HospitalPanel | null;
  stockistTable?: StockistTablePanel;
}

// ---------------------------------------------------------------------------
// Auth — mobile number + one-time password, through the Central User Service
// ---------------------------------------------------------------------------

/**
 * A display label only: what a user sees is their scope. (§6.1) Field force
 * (tm…nsm) and division staff (bu-head, admin), all from the Central User
 * Service.
 */
export type UserRole = 'tm' | 'rm' | 'zsm' | 'nsm' | 'bu-head' | 'admin';

export interface OtpRequestBody {
  mobile: string;
}

export interface OtpRequestResponse {
  /** Where the code was emailed, masked — e.g. "r***@wockhardt.com". */
  sentTo: string;
  expiresInSeconds: number;
  resendInSeconds: number;
}

export interface OtpVerifyBody {
  mobile: string;
  otp: string;
}

export interface SessionUser {
  id: string;
  name: string;
  /** The role this session is in. */
  role: UserRole;
  mobile: string;
  scopeId: string;
  effectiveScope: EffectiveScope;
  /**
   * The person's roles in this dashboard, main role first (Central User Service: the
   * account's role and the extra roles ticked for IBB Insights). With more than one they
   * choose, and can switch.
   */
  roles: SessionRole[];
  /** The active role's key — sent back as the X-Dashboard-Role header. */
  roleKey: string;
}

export interface SessionRole {
  /** "<usertype>:<division>", e.g. "rm:78". */
  key: string;
  role: UserRole;
  division: string | null;
  divisionName: string | null;
  /** This role shows every division (a service admin's or listed mobile's main role). */
  allDivisions: boolean;
}

/** `token` is the Central User Service's session token, sent back as "Bearer". */
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
  | 'FORBIDDEN'
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
