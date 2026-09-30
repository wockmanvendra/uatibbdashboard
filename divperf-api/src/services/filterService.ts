/**
 * Cascading filter options. (§7.5 GET /api/meta/filters)
 *
 * Each level returns only values reachable given the levels above it AND the
 * user's scope. Options are computed here, never assembled in the browser.
 *
 * Against Synapse this is one DISTINCT query over the hierarchy columns rather
 * than five — a round trip costs about a second, and the hierarchy is small
 * enough (1,476 observed zone/region/HQ combinations) to shape in one pass.
 */
import type { FiltersResponse, FilterOption, MonthOption } from '../types/api.js';
import type { Scope } from '../plugins/scope.js';
import { intersectScope } from '../plugins/scope.js';
import { isClosed, label } from '../lib/yrmn.js';
import { AVAILABLE_MONTHS, BRANDS, DIVISIONS, HQS, OPEN_YR_MN, REGIONS, ZONES } from './mockData.js';
import { config } from '../config.js';
import { getDb } from '../data/db.js';
import { DATE_KEY, DIMENSION, SOURCE, code } from '../data/sqlFragments.js';
import { getDataVersion } from './versionService.js';

export interface FilterSelection {
  division: string[];
  zone: string[];
  region: string[];
}

interface HierarchyRow {
  spart: string | null;
  div_name: string | null;
  zone_code: string | null;
  zone_name: string | null;
  region_code: string | null;
  region_name: string | null;
  hq_code: string | null;
  hq_name: string | null;
}

interface Hierarchy {
  rows: HierarchyRow[];
  brands: string[];
  months: number[];
  at: number;
}

/**
 * The whole hierarchy, cached in process. It changes only when the warehouse
 * reloads, and re-reading it on every filter interaction would add a second to
 * each one.
 */
let hierarchy: Hierarchy | null = null;
const HIERARCHY_TTL_MS = 10 * 60_000;
let inflight: Promise<Hierarchy> | null = null;

async function loadHierarchy(): Promise<Hierarchy> {
  const current = hierarchy;
  if (current && Date.now() - current.at < HIERARCHY_TTL_MS) return current;
  // Collapse concurrent misses into one query.
  inflight ??= fetchHierarchy().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function fetchHierarchy(): Promise<Hierarchy> {
  const db = getDb();
  const { division: div, zone, region, hq, brand } = DIMENSION;
  const [rows, brandRows, monthRows] = await Promise.all([
    db.all<HierarchyRow>(
      `SELECT DISTINCT
    ${code(div.codeCol)}    AS spart,       ${code(div.nameCol)}    AS div_name,
    ${code(zone.codeCol)}   AS zone_code,   ${code(zone.nameCol)}   AS zone_name,
    ${code(region.codeCol)} AS region_code, ${code(region.nameCol)} AS region_name,
    ${code(hq.codeCol)}     AS hq_code,     ${code(hq.nameCol)}     AS hq_name
  FROM ${SOURCE}
  WHERE ${code(div.codeCol)} IS NOT NULL`,
    ),
    db.all<{ brand: string }>(
      `SELECT DISTINCT ${code(brand.codeCol)} AS brand FROM ${SOURCE} WHERE ${code(brand.codeCol)} IS NOT NULL`,
    ),
    db.all<{ yr_mn: number | string }>(`SELECT DISTINCT ${DATE_KEY} AS yr_mn FROM ${SOURCE} ORDER BY 1`),
  ]);

  const loaded: Hierarchy = {
    rows,
    brands: brandRows.map((b) => b.brand).sort((a, b) => a.localeCompare(b)),
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
  if (config.USE_MOCK_DATA) return mockOptions(sel, scope);

  const [h, version] = await Promise.all([loadHierarchy(), getDataVersion()]);

  const permit = (level: Scope['level'], codes: string[]) =>
    scope.level === level ? intersectScope(codes, scope.nodes) : codes;

  const uniq = (pairs: [string, string][]): FilterOption[] => {
    const m = new Map<string, string>();
    // A code appears both with and without a name; keep the name.
    for (const [c, n] of pairs) if (c && (!m.has(c) || (n && m.get(c) === c))) m.set(c, n || c);
    return [...m].map(([code_, name]) => ({ code: code_, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  };

  const divisions = uniq(
    h.rows.filter((r) => r.spart).map((r) => [r.spart!, r.div_name ?? r.spart!]),
  ).filter((d) => permit('DIVISION', [d.code]).length > 0);

  // Each level is filtered by the selections above it, so the lists shrink as
  // the user drills down rather than offering unreachable combinations.
  const inDivision = (r: HierarchyRow) => !sel.division.length || (r.spart !== null && sel.division.includes(r.spart));
  const inZone = (r: HierarchyRow) => !sel.zone.length || (r.zone_code !== null && sel.zone.includes(r.zone_code));
  const inRegion = (r: HierarchyRow) => !sel.region.length || (r.region_code !== null && sel.region.includes(r.region_code));

  const zones = uniq(
    h.rows.filter((r) => inDivision(r) && r.zone_code).map((r) => [r.zone_code!, r.zone_name ?? r.zone_code!]),
  ).filter((z) => permit('ZONE', [z.code]).length > 0);

  const regions = uniq(
    h.rows
      .filter((r) => inDivision(r) && inZone(r) && r.region_code)
      .map((r) => [r.region_code!, r.region_name ?? r.region_code!]),
  ).filter((x) => permit('REGION', [x.code]).length > 0);

  const hqs = uniq(
    h.rows
      .filter((r) => inDivision(r) && inZone(r) && inRegion(r) && r.hq_code)
      .map((r) => [r.hq_code!, r.hq_name ?? r.hq_code!]),
  ).filter((x) => permit('HQ', [x.code]).length > 0);

  const months: MonthOption[] = h.months.map((m) => ({
    yrMn: m,
    label: label(m),
    isClosed: isClosed(m, version.openYrMn),
  }));

  return {
    divisions,
    zones,
    regions,
    hqs,
    brands: h.brands.map((b) => ({ code: b, name: b })),
    months,
  };
}

// ---------------------------------------------------------------------------

function mockOptions(sel: FilterSelection, scope: Scope): FiltersResponse {
  const permit = (level: Scope['level'], codes: string[]) =>
    scope.level === level ? intersectScope(codes, scope.nodes) : codes;

  const divisions = DIVISIONS.filter((d) =>
    permit('DIVISION', DIVISIONS.map((x) => x.code)).includes(d.code),
  );
  const zoneCodes = permit('ZONE', ZONES.map((z) => z.code));
  const zones = ZONES.filter((z) => zoneCodes.includes(z.code));

  const regionPool = REGIONS.filter((r) => !sel.zone.length || sel.zone.includes(r.zone));
  const regionCodes = permit('REGION', regionPool.map((r) => r.code));
  const regions = regionPool
    .filter((r) => regionCodes.includes(r.code))
    .map((r) => ({ code: r.code, name: r.name }));

  const visibleRegions = new Set(regions.map((r) => r.code));
  const hqPool = HQS.filter((h) =>
    sel.region.length ? sel.region.includes(h.region) : visibleRegions.has(h.region),
  );
  const hqCodes = permit('HQ', hqPool.map((h) => h.code));
  const hqs = hqPool.filter((h) => hqCodes.includes(h.code)).map((h) => ({ code: h.code, name: h.name }));

  return {
    divisions,
    zones,
    regions,
    hqs,
    brands: BRANDS.map((b) => ({ code: b, name: b })),
    months: AVAILABLE_MONTHS.map((m) => ({
      yrMn: m,
      label: label(m),
      isClosed: isClosed(m, OPEN_YR_MN),
    })),
  };
}
