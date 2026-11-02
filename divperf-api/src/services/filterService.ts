/**
 * Cascading filter options. (§7.5 GET /api/meta/filters)
 *
 * Division lists only the signed-in user's own division(s). Below it, each list
 * holds only what the selections above it reach, within the user's scope:
 *
 *   Division ─┬─ Brand
 *             └─ Zone ── Region ── HQ
 *
 * Options are computed here, never assembled in the browser.
 *
 * Against Synapse the hierarchy is one DISTINCT query over the hierarchy
 * columns rather than five — a round trip costs about a second, and the
 * hierarchy is small enough (1,476 observed zone/region/HQ combinations) to
 * shape in one pass. The mock data is shaped by the same function.
 */
import type { FiltersResponse, FilterOption, MonthOption } from '../types/api.js';
import { permittedFor, type Scope, type ScopedDimension } from '../plugins/scope.js';
import { isClosed, label } from '../lib/yrmn.js';
import { AVAILABLE_MONTHS, BRANDS, DIVISIONS, HQS, OPEN_YR_MN, REGIONS, ZONES } from './mockData.js';
import { config } from '../config.js';
import { getDb } from '../data/db.js';
import { DATE_KEY, DIMENSION, SOURCE, code, divisionCode, divisionName } from '../data/sqlFragments.js';
import { getDataVersion } from './versionService.js';

export interface FilterSelection {
  division: string[];
  zone: string[];
  region: string[];
}

export interface HierarchyRow {
  spart: string | null;
  div_name: string | null;
  zone_code: string | null;
  zone_name: string | null;
  region_code: string | null;
  region_name: string | null;
  hq_code: string | null;
  hq_name: string | null;
}

export interface Hierarchy {
  rows: HierarchyRow[];
  /** Every brand, with each division that sells it. */
  brands: { spart: string; brand: string }[];
  months: number[];
}

/**
 * The whole hierarchy, cached in process. It changes only when the warehouse
 * reloads, and re-reading it on every filter interaction would add a second to
 * each one.
 */
let hierarchy: (Hierarchy & { at: number }) | null = null;
const HIERARCHY_TTL_MS = 10 * 60_000;
let inflight: Promise<Hierarchy & { at: number }> | null = null;

async function loadHierarchy(): Promise<Hierarchy> {
  const current = hierarchy;
  if (current && Date.now() - current.at < HIERARCHY_TTL_MS) return current;
  // Collapse concurrent misses into one query.
  inflight ??= fetchHierarchy().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function fetchHierarchy(): Promise<Hierarchy & { at: number }> {
  const db = getDb();
  const { division: div, zone, region, hq, brand } = DIMENSION;
  const [rows, brandRows, monthRows] = await Promise.all([
    db.all<HierarchyRow>(
      `SELECT DISTINCT
    ${divisionCode(div.codeCol)} AS spart, ${divisionName(divisionCode(div.codeCol), code(div.nameCol))} AS div_name,
    ${code(zone.codeCol)}   AS zone_code,   ${code(zone.nameCol)}   AS zone_name,
    ${code(region.codeCol)} AS region_code, ${code(region.nameCol)} AS region_name,
    ${code(hq.codeCol)}     AS hq_code,     ${code(hq.nameCol)}     AS hq_name
  FROM ${SOURCE}
  WHERE ${code(div.codeCol)} IS NOT NULL`,
    ),
    db.all<{ spart: string; brand: string }>(
      `SELECT DISTINCT ${divisionCode(div.codeCol)} AS spart, ${code(brand.codeCol)} AS brand
  FROM ${SOURCE}
  WHERE ${code(div.codeCol)} IS NOT NULL AND ${code(brand.codeCol)} IS NOT NULL`,
    ),
    db.all<{ yr_mn: number | string }>(`SELECT DISTINCT ${DATE_KEY} AS yr_mn FROM ${SOURCE} ORDER BY 1`),
  ]);

  const loaded = {
    rows,
    brands: brandRows,
    months: monthRows.map((m) => Number(m.yr_mn)).sort((a, b) => a - b),
    at: Date.now(),
  };
  hierarchy = loaded;
  return loaded;
}

export function resetFilterCache(): void {
  hierarchy = null;
}

export async function getFilterOptions(
  sel: FilterSelection,
  scope: Scope,
): Promise<FiltersResponse> {
  if (config.USE_MOCK_DATA) return shapeOptions(mockHierarchy(), sel, scope, OPEN_YR_MN);

  const [h, version] = await Promise.all([loadHierarchy(), getDataVersion()]);
  return shapeOptions(h, sel, scope, version.openYrMn);
}

/** Options sorted by name; a code seen both with and without a name keeps the name. */
function uniq(pairs: [string, string][]): FilterOption[] {
  const m = new Map<string, string>();
  for (const [c, n] of pairs) if (c && (!m.has(c) || (n && m.get(c) === c))) m.set(c, n || c);
  return [...m].map(([code_, name]) => ({ code: code_, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Shapes the option lists from a hierarchy. Pure, so the cascade and the scope
 * rules are tested without a warehouse.
 */
export function shapeOptions(
  h: Hierarchy,
  sel: FilterSelection,
  scope: Scope,
  openYrMn: number,
): FiltersResponse {
  // First, only the rows this user may see at all: their own divisions, and
  // their own nodes at their scope's level. Every list below is built from
  // these, so a TM's Division list is their division, a ZSM's Zone list is
  // their zone, and nothing above or beside it leaks into the lists.
  const allowed = (dim: ScopedDimension) => {
    const p = permittedFor(dim, scope);
    return p === null ? null : new Set(p);
  };
  const limits = {
    spart: allowed('division'),
    zone_code: allowed('zone'),
    region_code: allowed('region'),
    hq_code: allowed('hq'),
  } as const;
  const visible = h.rows.filter((r) =>
    (Object.keys(limits) as (keyof typeof limits)[]).every((col) => {
      const set = limits[col];
      return set === null || (r[col] !== null && set.has(r[col]!));
    }),
  );

  // Then each level is narrowed by the selections above it, so the lists
  // shrink as the user drills down rather than offering unreachable pairs.
  const picked = (values: string[], v: string | null) => values.length === 0 || (v !== null && values.includes(v));
  const inDivision = (r: HierarchyRow) => picked(sel.division, r.spart);
  const inZone = (r: HierarchyRow) => picked(sel.zone, r.zone_code);
  const inRegion = (r: HierarchyRow) => picked(sel.region, r.region_code);

  const divisions = uniq(visible.filter((r) => r.spart).map((r) => [r.spart!, r.div_name ?? r.spart!]));

  const zones = uniq(
    visible.filter((r) => inDivision(r) && r.zone_code).map((r) => [r.zone_code!, r.zone_name ?? r.zone_code!]),
  );

  const regions = uniq(
    visible
      .filter((r) => inDivision(r) && inZone(r) && r.region_code)
      .map((r) => [r.region_code!, r.region_name ?? r.region_code!]),
  );

  const hqs = uniq(
    visible
      .filter((r) => inDivision(r) && inZone(r) && inRegion(r) && r.hq_code)
      .map((r) => [r.hq_code!, r.hq_name ?? r.hq_code!]),
  );

  // Brands follow the division: those sold in the chosen divisions, or in all
  // of the user's divisions when none is chosen.
  const brandDivisions = new Set(divisions.map((d) => d.code).filter((d) => picked(sel.division, d)));
  const brands = uniq(h.brands.filter((b) => brandDivisions.has(b.spart)).map((b) => [b.brand, b.brand]));

  const months: MonthOption[] = h.months.map((m) => ({
    yrMn: m,
    label: label(m),
    isClosed: isClosed(m, openYrMn),
  }));

  return { divisions, zones, regions, hqs, brands, months };
}

// ---------------------------------------------------------------------------

/**
 * The mock geography as a hierarchy: the MER2 zones (J*) are MERIND, the MC
 * zones (F*) DIABETES, and the brands split between the two, so the cascade
 * behaves in development and tests as it does against the warehouse.
 */
const MOCK_DIVISION_OF_ZONE = (zone: string) => (zone.startsWith('J') ? '78' : '85');
const MOCK_DIABETES_BRANDS = new Set([
  'GLARITUS', 'EMROK', 'WOSULIN', 'WOSULIN CTG', 'WOSULIN VIAL', 'WEPOX PFS', 'GLIMADAY', 'INOGLA', 'TERITIDE',
]);

let mock: Hierarchy | null = null;

function mockHierarchy(): Hierarchy {
  if (mock) return mock;
  const divName = (c: string) => DIVISIONS.find((d) => d.code === c)?.name ?? c;
  const zoneOf = (c: string) => ZONES.find((z) => z.code === c)!;
  const regionOf = (c: string) => REGIONS.find((r) => r.code === c)!;

  const rows: HierarchyRow[] = HQS.map((hq) => {
    const region = regionOf(hq.region);
    const zone = zoneOf(region.zone);
    const spart = MOCK_DIVISION_OF_ZONE(zone.code);
    return {
      spart, div_name: divName(spart),
      zone_code: zone.code, zone_name: zone.name,
      region_code: region.code, region_name: region.name,
      hq_code: hq.code, hq_name: hq.name,
    };
  });
  // Zones with no regions in the mock still belong to a division.
  for (const zone of ZONES.filter((z) => !REGIONS.some((r) => r.zone === z.code))) {
    const spart = MOCK_DIVISION_OF_ZONE(zone.code);
    rows.push({
      spart, div_name: divName(spart),
      zone_code: zone.code, zone_name: zone.name,
      region_code: null, region_name: null, hq_code: null, hq_name: null,
    });
  }

  mock = {
    rows,
    brands: BRANDS.map((brand) => ({ spart: MOCK_DIABETES_BRANDS.has(brand) ? '85' : '78', brand })),
    months: [...AVAILABLE_MONTHS],
  };
  return mock;
}
