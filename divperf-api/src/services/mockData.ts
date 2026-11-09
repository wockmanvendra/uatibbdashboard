/**
 * Phase 1 mock data. (§10 Phase 1 — "contract first, mock data")
 *
 * The serving database described in §4.8 does not exist yet, so this module
 * produces a response that satisfies the contract exactly. It is the ONLY
 * place mock values are produced; panels, routes, and the frontend never know
 * they are looking at a mock.
 *
 * Values are anchored to real figures read from the warehouse during discovery
 * (division names, brand names, geo names, month coverage, and the order of
 * magnitude of each measure) so the layout is exercised with realistic data.
 * Generation is seeded and therefore deterministic: the same filters always
 * produce the same numbers, which keeps tests and screenshots stable.
 *
 * Delete this file at Phase 2 once data/panels/* query the serving database.
 */
import type {
  CadreCounts,
  CnDetailRow,
  CreditNotePanel,
  EffortFigures,
  EffortMonth,
  EffortPanel,
  GeoRow,
  KeyBrandRow,
  ManpowerPanel,
  MixPanel,
  RxPanel,
  StockistRow,
  StockistTablePanel,
  TabResponse,
  TrendsPanel,
  YrMn,
} from '../types/api.js';
import { GEO_COLUMNS, KEY_BRAND_COLUMNS, CN_DETAIL_COLUMNS, STOCKIST_COLUMNS } from '../types/api.js';
import { getTab } from '../tabs/registry.js';
import * as M from '../lib/metrics.js';
import { label, monthCount, monthRange, priorYear } from '../lib/yrmn.js';

// ---------------------------------------------------------------------------
// Real reference data, read from eflash.VW_SALES_PRIMARY_ALL_HIST_AZURE
// ---------------------------------------------------------------------------

export const DIVISIONS = [
  { code: '83', name: 'PHARMA' },
  { code: '85', name: 'DIABETES' },
  { code: '91', name: 'INST. SALES' },
  { code: '78', name: 'MERIND' },
  { code: '02', name: 'RESEARCH' },
  { code: '22', name: 'BIOTECH' },
  { code: 'A8', name: 'AESTHETICS' },
  { code: 'A7', name: 'SPECIALITY' },
  { code: '84', name: 'CRITICAL CARE' },
];

export const ZONES = [
  { code: 'JH', name: 'MER2 - HYDERABAD' },
  { code: 'JK', name: 'MER2 - KOLKATTA' },
  { code: 'JE', name: 'MER2 - CHENNAI' },
  { code: 'JM', name: 'MER2 - MUMBAI' },
  { code: 'JD', name: 'MER2 - DELHI' },
  { code: 'JA', name: 'MER2 - AHMEDABAD' },
  { code: 'JG', name: 'MER2 - GUWAHATI' },
  { code: 'FW', name: 'MC - WEST' },
  { code: 'FE', name: 'MC - EAST' },
  { code: 'FS', name: 'MC - SOUTH' },
  { code: 'FN', name: 'MC - NORTH' },
];

export const REGIONS = [
  { code: 'JHH', name: 'MER2 - HYDERABAD', zone: 'JH' },
  { code: 'JEB', name: 'BANGALORE', zone: 'JE' },
  { code: 'JEC', name: 'MER2 - CHENNAI', zone: 'JE' },
  { code: 'JEO', name: 'MER2 - COIMBATORE', zone: 'JE' },
  { code: 'JKK', name: 'MER2 - KOLKATTA', zone: 'JK' },
  { code: 'JKB', name: 'MER2 - BURDWAN', zone: 'JK' },
  { code: 'JKH', name: 'MER2 - HOWRAH', zone: 'JK' },
  { code: 'JM1', name: 'MER2 - MUMBAI 1', zone: 'JM' },
  { code: 'JM2', name: 'MER2 - MUMBAI 2', zone: 'JM' },
  { code: 'JMP', name: 'PUNE', zone: 'JM' },
  { code: 'JD1', name: 'MER2 - DELHI 1', zone: 'JD' },
  { code: 'JD2', name: 'MER2 - DELHI 2', zone: 'JD' },
  { code: 'JDC', name: 'CHANDIGARH', zone: 'JD' },
  { code: 'JAA', name: 'MER2 - AHMEDABD', zone: 'JA' },
  { code: 'JAB', name: 'MER2 - BHOPAL', zone: 'JA' },
  { code: 'JAS', name: 'MER2 - SURAT', zone: 'JA' },
  { code: 'JGG', name: 'MER2 - GUWAHATI', zone: 'JG' },
  { code: 'JGP', name: 'PATNA', zone: 'JG' },
];

export const HQS = [
  { code: 'M2HYDP', name: 'MER HYDERABAD POOL', region: 'JHH' },
  { code: 'M2BGLP', name: 'MER BANGALORE POOL', region: 'JEB' },
  { code: 'M2CHEP', name: 'MER CHENNAI POOL', region: 'JEC' },
  { code: 'M2COMP', name: 'MER COIMBATORE POOL', region: 'JEO' },
  { code: 'M2MADP', name: 'MER MADURAI POOL', region: 'JEO' },
  { code: 'M2KOLP', name: 'MER KOLKATA POOL', region: 'JKK' },
  { code: 'M2ASNP', name: 'MER ASANSOL POOL', region: 'JKB' },
  { code: 'M2BURP', name: 'MER BURDWAN POOL', region: 'JKB' },
  { code: 'M2MDNP', name: 'MER MIDNAPORE POOL', region: 'JKH' },
  { code: 'M2HOWP', name: 'MER HOWRAH POOL', region: 'JKH' },
  { code: 'M2GHAT', name: 'MER GHATKOPAR', region: 'JM1' },
  { code: 'M2THAN', name: 'MER THANE', region: 'JM1' },
  { code: 'M2DADW', name: 'MER DADAR WEST', region: 'JM2' },
  { code: 'M2BORI', name: 'MER - BORIVLI', region: 'JM2' },
  { code: 'M2ANDE', name: 'MER ANDHERI EAST', region: 'JM2' },
  { code: 'M2PUN1', name: 'MER PUNE-1', region: 'JMP' },
  { code: 'M2DELS', name: 'MER - SOUTH DELHI', region: 'JD1' },
  { code: 'M2DELE', name: 'MER - EAST DELHI', region: 'JD1' },
  { code: 'M2DELN', name: 'MER - NORTH DELHI', region: 'JD2' },
  { code: 'M2DELW', name: 'MER - WEST DELHI', region: 'JD2' },
  { code: 'M2GURG', name: 'MER GURGAON', region: 'JD2' },
  { code: 'M2ANDH', name: 'MER CHANDIGARH', region: 'JDC' },
  { code: 'M2AMBA', name: 'MER AMBALA', region: 'JDC' },
  { code: 'M2AHMP', name: 'MER AHMEDABAD POOL', region: 'JAA' },
  { code: 'M2BPLP', name: 'MER BHOPAL POOL', region: 'JAB' },
  { code: 'M2UJJN', name: 'MER UJJAIN', region: 'JAB' },
  { code: 'M2SRTP', name: 'MER SURAT POOL', region: 'JAS' },
  { code: 'M2GUWP', name: 'MER GUWAHATI POOL', region: 'JGG' },
  { code: 'M2PATP', name: 'MER PATNA POOL', region: 'JGP' },
];

export const BRANDS = [
  'SPASMO PLUS', 'GLARITUS', 'EMROK', 'WOSULIN', 'SPASMO T+', 'WOSULIN CTG',
  'METHYCOBAL TAB', 'METHYCOBAL INJ', 'DECDAN TAB', 'DECDAN INJ', 'METHYCOBAL-D',
  'WEPOX PFS', 'WOSULIN VIAL', 'HAPID', 'TNH', 'DECDAN B', 'GLIMADAY',
  'FOLLIRICH', 'NUWOK', 'INOGLA', 'TERITIDE', 'SPASMO FORTE',
];

/**
 * Mix-pie groupings, taken from the Excel "Graph" sheet.
 * §12 Q16 asks whether this is a stored attribute or a hardcoded list; it is
 * hardcoded here and must move to dim_brand once confirmed.
 */
export const BRAND_GROUPS = ['Methycobal Group', 'Hapid', 'M Inj & Tab', 'Others'];

/** Months actually present in the warehouse (24 in FY23-25, then a 12-month gap). */
export const AVAILABLE_MONTHS: YrMn[] = [
  202304, 202305, 202306, 202307, 202308, 202309, 202310, 202311, 202312,
  202401, 202402, 202403, 202404, 202405, 202406, 202407, 202408, 202409,
  202410, 202411, 202412, 202501, 202502, 202503,
  202604, 202605, 202606, 202607, 202608,
];

export const OPEN_YR_MN: YrMn = 202608;
export const DATA_VERSION = 'mock-a3f9c1';

/**
 * HQs and SKUs for the Credit Note tab detail grids, shaped as the live ones
 * are: an HQ by territory code and name, a SKU by product code and its brand.
 */
const CN_HQS = HQS.slice(0, 8).map((h) => [h.code, h.name] as const);

const SKUS = [
  ['503868', 'METHYCOBAL TAB'],
  ['404845', 'WOSULIN'],
  ['501122', 'SPASMO PLUS'],
  ['502341', 'GLARITUS'],
  ['505590', 'EMROK'],
  ['500713', 'DECDAN TAB'],
  ['506612', 'HAPID'],
  ['503001', 'METHYCOBAL INJ'],
] as const;

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/** FNV-1a — small, fast, and stable across runs and platforms. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — a seeded PRNG, so the same filters always give the same numbers. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value that varies around `base` by +/- `spread` fraction, deterministically. */
const jitter = (r: () => number, base: number, spread = 0.25) =>
  base * (1 - spread + r() * spread * 2);

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Filter shape
// ---------------------------------------------------------------------------

export interface MockFilters {
  from: YrMn;
  to: YrMn;
  division: string[];
  brand: string[];
  zone: string[];
  region: string[];
  hq: string[];
}

/**
 * A scale factor so that narrowing filters shrinks the numbers the way real
 * data would. Without this, drilling into one HQ shows national totals and the
 * layout is never tested against small values.
 */
function scaleFor(f: MockFilters): number {
  let s = 1;
  if (f.division.length) s *= Math.min(1, f.division.length / DIVISIONS.length + 0.08);
  if (f.zone.length) s *= Math.min(1, f.zone.length / ZONES.length + 0.06);
  if (f.region.length) s *= Math.min(1, f.region.length / REGIONS.length + 0.05);
  if (f.hq.length) s *= Math.min(1, f.hq.length / HQS.length + 0.04);
  if (f.brand.length) s *= Math.min(1, f.brand.length / BRANDS.length + 0.05);
  return s;
}

/**
 * Monthly base magnitudes, in rupees, taken from the real MERIND figures for
 * 202604–202608 (tgt 32.6 Cr, disp 21.1 Cr, coll 19.1 Cr, CN 0.97 Cr over five
 * months) and scaled to a per-month figure.
 */
const BASE = {
  tgt: 65_000_000,
  disp: 52_000_000,
  coll: 46_000_000,
  cn: 2_100_000,
  os: 97_000_000,
  stock: 31_000_000,
  git: 2_400_000,
  sec: 38_000_000,
  rcpaActual: 43_000_000,
  rcpaPlan: 48_000_000,
  tmCount: 420,
};

/** Per-month figures for one month key, deterministic in (month, filters). */
function monthFigures(m: YrMn, f: MockFilters, salt: string) {
  const r = rng(hash(`${salt}|${m}|${f.division.join()}|${f.zone.join()}|${f.region.join()}|${f.hq.join()}|${f.brand.join()}`));
  const s = scaleFor(f);

  // Months in the 12-month gap (202504–202603) genuinely have no data.
  if (!AVAILABLE_MONTHS.includes(m)) return null;

  // The open month is only partly loaded — 202608 holds ~1/3 of a normal month.
  const partial = m === OPEN_YR_MN ? 0.11 : 1;

  const tgt = round2(jitter(r, BASE.tgt) * s * partial);
  const disp = round2(jitter(r, BASE.disp) * s * partial);
  const coll = round2(jitter(r, BASE.coll) * s * partial);
  const cn = round2(jitter(r, BASE.cn, 0.4) * s * partial);
  return {
    tgt,
    disp,
    coll,
    cn,
    gross: round2(disp + cn),
    os: round2(jitter(r, BASE.os) * s),
    stock: round2(jitter(r, BASE.stock) * s),
    git: round2(jitter(r, BASE.git, 0.5) * s),
    sec: round2(jitter(r, BASE.sec) * s * partial),
    rcpaActual: round2(jitter(r, BASE.rcpaActual) * s * partial),
    rcpaPlan: round2(jitter(r, BASE.rcpaPlan) * s * partial),
    tmCount: Math.max(1, Math.round(BASE.tmCount * s)),
    // DUMMY: CN split has no source. Apportioned Exp 62% / SR 24% / PD 14%.
    cnExp: round2(cn * 0.62),
    cnSr: round2(cn * 0.24),
    cnPd: round2(cn * 0.14),
  };
}

type Figures = NonNullable<ReturnType<typeof monthFigures>>;

/** Sum a month range. All aggregation is over generated months, never in a route. */
function rollup(from: YrMn, to: YrMn, f: MockFilters, salt = 'base') {
  const months = monthRange(from, to);
  const per = months.map((m) => monthFigures(m, f, salt));
  const present = per.filter((x): x is Figures => x !== null);
  if (present.length === 0) return null;

  const sum = (k: keyof Figures) => round2(present.reduce((a, x) => a + x[k], 0));
  return {
    months,
    per,
    presentCount: present.length,
    tgt: sum('tgt'),
    disp: sum('disp'),
    coll: sum('coll'),
    cn: sum('cn'),
    gross: sum('gross'),
    os: sum('os'),
    stock: sum('stock'),
    git: sum('git'),
    sec: sum('sec'),
    rcpaActual: sum('rcpaActual'),
    rcpaPlan: sum('rcpaPlan'),
    cnExp: sum('cnExp'),
    cnSr: sum('cnSr'),
    cnPd: sum('cnPd'),
    // Headcount is a point-in-time figure, not additive: take the last month.
    tmCount: present[present.length - 1]!.tmCount,
  };
}

// ---------------------------------------------------------------------------
// Panel builders
// ---------------------------------------------------------------------------

function buildKeyBrands(f: MockFilters, total: NonNullable<ReturnType<typeof rollup>>): KeyBrandRow[] {
  const pool = f.brand.length ? BRANDS.filter((b) => f.brand.includes(b)) : BRANDS;
  const chosen = pool.slice(0, 12);
  const r = rng(hash(`brands|${f.from}|${f.to}|${f.division.join()}`));

  // Weight brands so the table has a realistic long tail, then normalise to
  // the division total: the rows must add up to what the KPI band shows.
  const weights = chosen.map(() => 0.2 + r() * 1.8);
  const wSum = weights.reduce((a, b) => a + b, 0);

  return chosen.map((brand, i) => {
    const w = weights[i]! / wSum;
    const tgt = round2(total.tgt * w);
    const disp = round2(total.disp * w * (0.85 + r() * 0.3));
    // DUMMY: collection has no brand grain in the source (it is customer-level).
    // Apportioned by dispatch share so the column renders; replace when a
    // brand-level collection feed exists.
    const coll = round2(total.coll * w * (0.85 + r() * 0.3));
    const sec = round2(total.sec * w * (0.8 + r() * 0.4)); // DUMMY: no source
    const inv = round2((total.stock + total.git) * w);
    const rcpa = round2(total.rcpaActual * w * (0.8 + r() * 0.4)); // DUMMY: no source
    const priorColl = coll / (1 + (r() * 0.4 - 0.12));
    const priorDisp = disp / (1 + (r() * 0.4 - 0.12));
    const cn = round2(total.cn * w);
    return [
      brand,
      tgt,
      disp,
      M.grPct(disp, priorDisp),
      coll,
      M.achPct(coll, tgt),
      M.grPct(coll, priorColl),
      cn,
      M.cnPct(cn, round2(total.gross * w)),
      sec,
      inv,
      rcpa,
      M.rcpaPctToSec(rcpa, sec),
    ] as KeyBrandRow;
  });
}

/** One invented stockist per HQ in the selection, with that HQ's figures. */
function buildStockistTable(f: MockFilters): StockistTablePanel {
  const hqs = HQS.filter((h) => {
    if (f.hq.length) return f.hq.includes(h.code);
    if (f.region.length) return f.region.includes(h.region);
    if (f.zone.length) return f.zone.includes(REGIONS.find((x) => x.code === h.region)?.zone ?? '');
    return true;
  });
  const rows: StockistRow[] = [];
  let growing = 0;
  let degrowing = 0;
  const acc = { disp: 0, coll: 0, sec: 0, os: 0, pDisp: 0, pColl: 0, pSec: 0 };
  hqs.forEach((h, i) => {
    const nf: MockFilters = { ...f, hq: [h.code] };
    const cur = rollup(f.from, f.to, nf, 'stockist');
    if (!cur) return;
    const prior = rollup(priorYear(f.from), priorYear(f.to), nf, 'stockist');
    const dispGr = M.grPct(cur.disp, prior?.disp ?? null);
    if (dispGr !== null && dispGr > 0) growing++;
    if (dispGr !== null && dispGr < 0) degrowing++;
    acc.disp += cur.disp; acc.coll += cur.coll; acc.sec += cur.sec; acc.os += cur.os;
    acc.pDisp += prior?.disp ?? 0; acc.pColl += prior?.coll ?? 0; acc.pSec += prior?.sec ?? 0;
    rows.push([
      `${h.name} Distributors`, String(20000 + i), h.code, h.name,
      cur.disp, dispGr, cur.coll, M.grPct(cur.coll, prior?.coll ?? null),
      cur.sec, M.grPct(cur.sec, prior?.sec ?? null), cur.os,
    ]);
  });
  rows.sort((a, b) => (b[4] ?? 0) - (a[4] ?? 0));
  return {
    columns: STOCKIST_COLUMNS,
    rows,
    total: [
      'Total', '', '', '', acc.disp, M.grPct(acc.disp, acc.pDisp || null), acc.coll, M.grPct(acc.coll, acc.pColl || null),
      acc.sec, M.grPct(acc.sec, acc.pSec || null), acc.os,
    ],
    growingCount: growing,
    degrowingCount: degrowing,
  };
}

function buildGeoTable(grain: 'zone' | 'region' | 'hq', f: MockFilters, months: number) {
  const source =
    grain === 'zone'
      ? ZONES.map((z) => ({ code: z.code, name: z.name }))
      : grain === 'region'
        ? REGIONS.filter((x) => !f.zone.length || f.zone.includes(x.zone)).map((x) => ({ code: x.code, name: x.name }))
        : HQS.filter((h) => {
            if (!f.region.length && !f.zone.length) return true;
            if (f.region.length && f.region.includes(h.region)) return true;
            const reg = REGIONS.find((x) => x.code === h.region);
            return !!reg && f.zone.includes(reg.zone);
          }).map((h) => ({ code: h.code, name: h.name }));

  const nodes = source.length ? source : [{ code: 'UNASSIGNED', name: 'Unassigned' }];

  const rows: GeoRow[] = [];
  const codes: string[] = [];
  let onTarget = 0;
  let growing = 0;
  let degrowing = 0;

  const acc = { tgt: 0, disp: 0, coll: 0, cn: 0, gross: 0, sec: 0, inv: 0, rcpa: 0, tm: 0 };

  for (const node of nodes) {
    const nf: MockFilters = { ...f, [grain]: [node.code] } as MockFilters;
    const cur = rollup(f.from, f.to, nf, `geo|${grain}`);
    const prior = rollup(priorYear(f.from), priorYear(f.to), nf, `geo|${grain}`);
    if (!cur) continue;

    const inv = M.inventory(cur.stock, cur.git)!;
    const dispGr = M.grPct(cur.disp, prior?.disp ?? null);
    const collGr = M.grPct(cur.coll, prior?.coll ?? null);
    const achColl = M.achPct(cur.coll, cur.tgt);

    if (achColl !== null && achColl >= 100) onTarget++;
    if (dispGr !== null && dispGr > 0) growing++;
    if (dispGr !== null && dispGr < 0) degrowing++;

    acc.tgt += cur.tgt;
    acc.disp += cur.disp;
    acc.coll += cur.coll;
    acc.cn += cur.cn;
    acc.gross += cur.gross;
    acc.sec += cur.sec;
    acc.inv += inv;
    acc.rcpa += cur.rcpaActual;
    acc.tm += cur.tmCount;

    codes.push(node.code);
    rows.push([
      node.name,
      cur.tgt,
      cur.disp,
      dispGr,
      cur.coll,
      achColl,
      collGr,
      M.pcpm(cur.coll, cur.tmCount, months),
      cur.cn,
      M.cnPct(cur.cn, cur.gross),
      cur.sec,
      inv,
      cur.rcpaActual,
      M.rcpaPctToSec(cur.rcpaActual, cur.sec),
      M.achPct(cur.disp, cur.tgt),
    ]);
  }

  // Ratios on the Total row are recomputed from the summed numerators and
  // denominators. Averaging the per-row percentages would be wrong. (I4)
  const priorAll = rollup(priorYear(f.from), priorYear(f.to), f, `geo|${grain}|total`);
  const total: GeoRow = [
    'Total',
    round2(acc.tgt),
    round2(acc.disp),
    M.grPct(acc.disp, priorAll?.disp ?? null),
    round2(acc.coll),
    M.achPct(acc.coll, acc.tgt),
    M.grPct(acc.coll, priorAll?.coll ?? null),
    M.pcpm(acc.coll, acc.tm, months),
    round2(acc.cn),
    M.cnPct(acc.cn, acc.gross),
    round2(acc.sec),
    round2(acc.inv),
    round2(acc.rcpa),
    M.rcpaPctToSec(acc.rcpa, acc.sec),
    M.achPct(acc.disp, acc.tgt),
  ];

  return {
    grain,
    columns: GEO_COLUMNS,
    codes,
    rows,
    total,
    onTargetCount: onTarget,
    growingCount: growing,
    degrowingCount: degrowing,
  };
}

function buildTrends(f: MockFilters, series: string[]): TrendsPanel {
  const months = monthRange(f.from, f.to);
  const per = months.map((m) => monthFigures(m, f, 'base'));
  const want = new Set(series);
  const pick = (fn: (x: Figures) => number | null) =>
    per.map((x) => (x === null ? null : fn(x)));

  const out: TrendsPanel = { months, labels: months.map(label) };
  if (want.has('disp')) out.disp = pick((x) => x.disp);
  if (want.has('sec')) out.sec = pick((x) => x.sec);
  if (want.has('rcpa')) out.rcpa = pick((x) => x.rcpaActual);
  if (want.has('pcpm')) out.pcpm = pick((x) => M.pcpm(x.coll, x.tmCount, 1));
  if (want.has('tgt')) out.tgt = pick((x) => x.tgt);
  if (want.has('coll')) out.coll = pick((x) => x.coll);
  if (want.has('achPct')) out.achPct = pick((x) => M.achPct(x.coll, x.tgt));
  if (want.has('grPct')) {
    out.grPct = months.map((m, i) => {
      const c = per[i];
      const p = monthFigures(priorYear(m), f, 'base');
      return c && p ? M.grPct(c.disp, p.disp) : null;
    });
  }
  if (want.has('rcpaPlan')) out.rcpaPlan = pick((x) => x.rcpaPlan);
  if (want.has('rcpaActual')) out.rcpaActual = pick((x) => x.rcpaActual);
  // DUMMY: "Value / Dr. Actual" — RCPA per doctor. No doctor-count source.
  if (want.has('valuePerDr')) out.valuePerDr = pick((x) => round2(x.rcpaActual / 4_800_000));
  if (want.has('cnExp')) out.cnExp = pick((x) => x.cnExp);
  if (want.has('cnSr')) out.cnSr = pick((x) => x.cnSr);
  if (want.has('cnPd')) out.cnPd = pick((x) => x.cnPd);
  if (want.has('cnPct')) out.cnPct = pick((x) => M.cnPct(x.cn, x.gross));
  if (want.has('rxns')) out.rxns = months.map((m) => mockRx(m).rxns);
  if (want.has('rxber')) out.rxber = months.map((m) => mockRx(m).rxber);
  if (want.has('rxPd')) out.rxPd = months.map((m) => M.perPrescriber(mockRx(m).rxns, mockRx(m).rxber));
  if (want.has('leftTm')) out.leftTm = months.map((m) => mockLeft(m).tm);
  if (want.has('leftRm')) out.leftRm = months.map((m) => mockLeft(m).rm);
  if (want.has('leftZsm')) out.leftZsm = months.map((m) => mockLeft(m).zsm);
  return out;
}

/** Prescriptions and prescribers in a month: about 1,500 Rx from 280 doctors. */
function mockRx(m: number): { rxns: number; rxber: number } {
  const r = rng(hash(`rx|${m}`));
  return { rxns: Math.round(1_350 + r() * 350), rxber: Math.round(240 + r() * 90) };
}

function buildRx(f: MockFilters): RxPanel {
  const months = monthRange(f.from, f.to);
  const sum = (ms: number[], k: 'rxns' | 'rxber') => ms.reduce((a, m) => a + mockRx(m)[k], 0);
  const figures = (ms: number[]) => {
    const rxns = sum(ms, 'rxns');
    const rxber = sum(ms, 'rxber');
    const perMonth = M.prescribersPerMonth(rxber, ms.length);
    return { rxns, rxber: perMonth, pdm: M.perPrescriber(rxns, perMonth) };
  };
  const cur = figures(months);
  const prior = figures(months.map(priorYear));
  return {
    rxns: { value: cur.rxns, gr: M.grPct(cur.rxns, prior.rxns) },
    rxber: { value: cur.rxber, gr: M.grPct(cur.rxber, prior.rxber) },
    pdm: { value: cur.pdm, gr: M.grPct(cur.pdm, prior.pdm) },
    from: months[0] ?? null,
    to: months[months.length - 1] ?? null,
  };
}

/** Leavers in a month, by cadre: a handful of TMs, the odd RM or ZSM. */
function mockLeft(m: number): CadreCounts {
  const r = rng(hash(`left|${m}`));
  return { tm: Math.floor(r() * 5), rm: Math.floor(r() * 2.4), zsm: Math.floor(r() * 1.4) };
}

function buildManpower(f: MockFilters): ManpowerPanel {
  const months = monthRange(f.from, f.to);
  const left: CadreCounts = { tm: 0, rm: 0, zsm: 0 };
  for (const m of months) {
    const l = mockLeft(m);
    left.tm += l.tm;
    left.rm += l.rm;
    left.zsm += l.zsm;
  }
  const r = rng(hash(`joined|${f.from}|${f.to}`));
  const joined: CadreCounts = {
    tm: left.tm + Math.floor(r() * 4),
    rm: Math.max(0, left.rm + Math.floor(r() * 3) - 1),
    zsm: Math.floor(r() * 2),
  };
  // Split each cadre's leavers across the three tenure bands.
  const tenure = (n: number) => {
    const under6m = Math.round(n * 0.35);
    const m6to12 = Math.round(n * 0.25);
    return { under6m, m6to12, over1y: n - under6m - m6to12 };
  };
  return {
    left,
    joined,
    leftByTenure: { tm: tenure(left.tm), rm: tenure(left.rm), zsm: tenure(left.zsm) },
  };
}

/** A month's effort sums: about 170 territories, 21,000 doctors on the lists. */
function mockEffort(m: number) {
  const r = rng(hash(`effort|${m}`));
  const tc = 21_000;
  const met = Math.round(tc * (0.78 + r() * 0.1));
  const fd = Math.round(3_600 + r() * 200);
  return { tc, a: 3_500, b: 8_700, met, fcovW: tc * (60 + r() * 15), calls: Math.round(fd * (9 + r())), fd, fdTerr: 162 };
}

function buildEffort(f: MockFilters): EffortPanel {
  const figures = (ms: number[]): EffortFigures => {
    const s = ms.map(mockEffort).reduce(
      (a, e) => ({
        tc: a.tc + e.tc, a: a.a + e.a, b: a.b + e.b, met: a.met + e.met, fcovW: a.fcovW + e.fcovW,
        calls: a.calls + e.calls, fd: a.fd + e.fd, fdTerr: a.fdTerr + e.fdTerr,
      }),
      { tc: 0, a: 0, b: 0, met: 0, fcovW: 0, calls: 0, fd: 0, fdTerr: 0 },
    );
    return {
      drs: M.perMonth(s.tc, ms.length),
      aPlus: null,
      a: M.perMonth(s.a, ms.length),
      b: M.perMonth(s.b, ms.length),
      c: M.perMonth(s.tc - s.a - s.b, ms.length),
      drsMet: M.perMonth(s.met, ms.length),
      coveragePct: M.pct(s.met, s.tc),
      drsMetRtFrq: null,
      rtFrqCoveragePct: M.ratio(s.fcovW, s.tc),
      callAvg: M.callAverage(s.calls, s.fd),
      drsMissed: null,
      missedRtFrq: null,
      fieldDays: M.ratio(s.fd, s.fdTerr),
    };
  };
  // Missed doctors: 6 HQs x 4 doctors a month, as the missed-doctor list has them.
  const months = monthRange(f.from, f.to);
  const missedPerMonth = 24;
  return {
    total: { ...figures(months), drsMissed: missedPerMonth * months.length },
    months: months.map((m): EffortMonth => ({ yrMn: m, label: label(m), ...figures([m]), drsMissed: missedPerMonth })),
    missedByCategory: {
      labels: ['A', 'B', 'C'],
      values: [6, 12, 6].map((n) => n * months.length),
    },
  };
}

function buildMix(f: MockFilters, dimension: MixPanel['dimension']): MixPanel {
  const labels =
    dimension === 'brandGroup'
      ? BRAND_GROUPS
      : dimension === 'brand'
        ? BRANDS.slice(0, 6)
        : dimension === 'zone'
          ? ZONES.slice(0, 6).map((z) => z.name)
          : dimension === 'region'
            ? REGIONS.slice(0, 6).map((z) => z.name)
            : HQS.slice(0, 6).map((z) => z.name);

  const total = rollup(f.from, f.to, f, 'base');
  const r = rng(hash(`mix|${dimension}|${f.from}|${f.to}|${f.division.join()}`));
  const weights = labels.map(() => 0.3 + r() * 1.7);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const share = (base: number, i: number, wobble: number) =>
    round2(base * (weights[i]! / wSum) * wobble);

  // Secondary and RCPA: every mock brand, largest first, as the live feed has them.
  const everyBrand = (base: number) => {
    const w = BRANDS.map(() => 0.2 + r() * 1.8);
    const sum = w.reduce((a, b) => a + b, 0);
    const slices = BRANDS.map((b, i) => ({ label: b, value: round2(base * (w[i]! / sum)) }))
      .sort((a, b) => b.value - a.value);
    return { labels: slices.map((s) => s.label), values: slices.map((s) => s.value) };
  };

  return {
    dimension,
    disp: { labels, values: labels.map((_, i) => share(total?.disp ?? 0, i, 1)) },
    // DUMMY: coll has no brand grain in the source. See §4.4.
    coll: { labels, values: labels.map((_, i) => share(total?.coll ?? 0, i, 0.9 + r() * 0.2)) },
    sec: everyBrand(total?.sec ?? 0),
    rcpa: everyBrand(total?.rcpaActual ?? 0),
  };
}

function buildCreditNote(total: NonNullable<ReturnType<typeof rollup>>): CreditNotePanel {
  return {
    totalCn: total.cn,
    expCn: total.cnExp,
    srCn: total.cnSr,
    pdCn: total.cnPd,
    totalOs: total.os,
    cnPct: M.cnPct(total.cn, total.gross),
    expCnPct: M.cnPct(total.cnExp, total.gross),
    srCnPct: M.cnPct(total.cnSr, total.gross),
    pdCnPct: M.cnPct(total.cnPd, total.gross),
    osPct: M.cnPct(total.os, total.gross),
  };
}

function buildCnDetail(f: MockFilters, total: NonNullable<ReturnType<typeof rollup>>) {
  const make = (entries: readonly (readonly [string, string])[], salt: string): CnDetailRow[] => {
    const r = rng(hash(`${salt}|${f.from}|${f.to}`));
    const weights = entries.map(() => 0.2 + r() * 1.8);
    const wSum = weights.reduce((a, b) => a + b, 0);
    return entries.map(([code, name], i) => {
      const w = weights[i]! / wSum;
      const exp = round2(total.cnExp * w);
      const sr = round2(total.cnSr * w);
      const pd = round2(total.cnPd * w);
      const tot = round2(exp + sr + pd);
      return [name, code, exp, sr, pd, tot, M.cnPct(tot, total.gross * w)] as CnDetailRow;
    });
  };
  return {
    columns: CN_DETAIL_COLUMNS,
    byHq: make(CN_HQS, 'hq'),
    bySku: make(SKUS, 'sku'),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildMockTab(tabId: string, f: MockFilters): TabResponse {
  const tab = getTab(tabId);
  if (!tab) throw new Error(`Unknown tab ${tabId}`);

  const t0 = performance.now();
  const months = monthCount(f.from, f.to);
  const cur = rollup(f.from, f.to, f, 'base');
  const priorFrom = priorYear(f.from);
  const priorTo = priorYear(f.to);
  const prior = rollup(priorFrom, priorTo, f, 'base');

  // An empty range is legitimate — the 12-month gap in the source guarantees
  // some selections have no data. Return the shape with nulls, not an error.
  const empty = cur === null;
  const c = cur ?? {
    months: monthRange(f.from, f.to), per: [], presentCount: 0,
    tgt: 0, disp: 0, coll: 0, cn: 0, gross: 0, os: 0, stock: 0, git: 0,
    sec: 0, rcpaActual: 0, rcpaPlan: 0, cnExp: 0, cnSr: 0, cnPd: 0, tmCount: 0,
  };

  const has = (p: string) => tab.panels.includes(p as never);
  const res: TabResponse = {
    meta: {
      tab: tab.id,
      dataVersion: DATA_VERSION,
      from: f.from,
      to: f.to,
      monthCount: months,
      effectiveScope: { level: 'ALL', nodes: [] },
      unassignedRows: 0,
      cached: false,
      queryMs: 0,
      builtAt: new Date().toISOString(),
      refreshing: false,
      priorFrom: prior ? priorFrom : null,
      priorTo: prior ? priorTo : null,
      // The mock invents sales for every month, so CN% covers the whole period.
      cnPctFrom: f.from,
      cnPctTo: f.to,
      // The mock invents every panel, so nothing is reported as unavailable.
      // That is precisely the difference between this and the live path.
      unavailable: [],
    },
  };

  if (has('primary')) {
    res.primary = {
      target: { value: empty ? null : c.tgt, ach: null, gr: M.grPct(empty ? null : c.tgt, prior?.tgt ?? null) },
      collection: {
        value: empty ? null : c.coll,
        ach: empty ? null : M.achPct(c.coll, c.tgt),
        gr: M.grPct(empty ? null : c.coll, prior?.coll ?? null),
      },
      dispatch: {
        value: empty ? null : c.disp,
        ach: empty ? null : M.achPct(c.disp, c.tgt),
        gr: M.grPct(empty ? null : c.disp, prior?.disp ?? null),
      },
      divisionTarget:
        empty || f.zone.length || f.region.length || f.hq.length || f.brand.length
          ? null
          : {
              value: round2(c.tgt * 1.03),
              collAch: M.achPct(c.coll, c.tgt * 1.03),
              dispAch: M.achPct(c.disp, c.tgt * 1.03),
              gr: null,
            },
    };
  }
  if (has('pcpm')) {
    res.pcpm = {
      budgetTm: empty ? null : c.tmCount,
      pcpmCollection: empty ? null : M.pcpm(c.coll, c.tmCount, months),
    };
  }
  if (has('secondary')) {
    res.secondary = {
      value: empty ? null : c.sec,
      grPct: M.grPct(empty ? null : c.sec, prior?.sec ?? null),
    };
  }
  if (has('rcpa')) {
    res.rcpa = {
      plan: empty ? null : c.rcpaPlan,
      actual: empty ? null : c.rcpaActual,
      achPct: empty ? null : M.achPct(c.rcpaActual, c.rcpaPlan),
      grPct: M.grPct(empty ? null : c.rcpaActual, prior?.rcpaActual ?? null),
    };
  }
  if (has('inventory')) {
    res.inventory = { value: empty ? null : M.inventory(c.stock, c.git) };
  }
  if (has('keyBrands')) {
    res.keyBrands = {
      columns: KEY_BRAND_COLUMNS,
      rows: empty ? [] : buildKeyBrands(f, c),
    };
  }
  if (has('creditNote')) {
    res.creditNote = empty
      ? { totalCn: null, expCn: null, srCn: null, pdCn: null, totalOs: null,
          cnPct: null, expCnPct: null, srCnPct: null, pdCnPct: null, osPct: null }
      : buildCreditNote(c);
  }
  if (has('geoTable')) {
    res.geoTable = buildGeoTable(tab.grain as 'zone' | 'region' | 'hq', f, months);
  }
  if (has('trends')) {
    res.trends = buildTrends(f, tab.trendSeries);
  }
  if (has('mix')) {
    res.mix = buildMix(f, tab.mixDimension);
  }
  if (has('manpower')) {
    res.manpower = empty ? null : buildManpower(f);
  }
  if (has('rx') && !empty) {
    res.rx = buildRx(f);
  }
  if (has('effort')) {
    res.effort = empty ? null : buildEffort(f);
  }
  if (has('hospitals')) {
    // RESEARCH only, as live: shown when division 84 is chosen.
    res.hospitals = f.division.includes('84')
      ? {
          total: { label: 'Total', count: 1607, covered: null, coveredPct: null, missed: null },
          tiers: [['Tier I', 149], ['Tier II', 406], ['Tier III', 224], ['Tier IV', 102]].map(([label, count]) => ({
            label: label as string, count: count as number, covered: null, coveredPct: null, missed: null,
          })),
          untiered: 726,
          months: [],
        }
      : null;
  }
  if (has('stockistTable')) {
    res.stockistTable = buildStockistTable(f);
  }
  if (has('cnDetail')) {
    res.cnDetail = empty
      ? { columns: CN_DETAIL_COLUMNS, byHq: [], bySku: [] }
      : buildCnDetail(f, c);
  }

  res.meta.queryMs = Math.round((performance.now() - t0) * 100) / 100;
  return res;
}
