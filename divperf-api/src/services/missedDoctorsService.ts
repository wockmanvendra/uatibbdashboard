/**
 * The missed-doctor list behind the Effort Dashboard's "Drs Missed".
 *
 * Narrows the request to the user's scope exactly as a tab does (applyScope),
 * then reads the visit summary — or, with USE_MOCK_DATA, a generated list. Not
 * cached: it is paged and searched, and read only when the drawer opens.
 */
import type { Scope } from '../plugins/scope.js';
import type { MissedDoctorRow, MissedDoctorsResponse, YrMn } from '../types/api.js';
import { config } from '../config.js';
import { getDb } from '../data/db.js';
import { fetchMissedDoctors, type MissedListOptions } from '../data/panels/missedDoctors.js';
import { applyScope } from './tabService.js';
import { HQS, REGIONS, ZONES } from './mockData.js';
import { monthRange } from '../lib/yrmn.js';

export interface MissedDoctorsRequest {
  from: YrMn;
  to: YrMn;
  division: string[];
  brand: string[];
  zone: string[];
  region: string[];
  hq: string[];
}

export async function getMissedDoctors(
  req: MissedDoctorsRequest,
  options: MissedListOptions,
  scope: Scope,
): Promise<MissedDoctorsResponse> {
  const filters = applyScope(req, scope);
  if (config.USE_MOCK_DATA) return mockMissed(filters, options);
  return fetchMissedDoctors(getDb(), scope, filters, options);
}

/** A small, stable generated list, filtered and paged like the real one. */
function mockMissed(f: MissedDoctorsRequest, { page, pageSize, search, categories }: MissedListOptions): MissedDoctorsResponse {
  const all: MissedDoctorRow[] = [];
  for (const month of monthRange(f.from, f.to)) {
    HQS.slice(0, 6).forEach((hq, h) => {
      const region = REGIONS.find((r) => r.code === hq.region);
      const zone = ZONES.find((z) => z.code === region?.zone);
      for (let d = 0; d < 4; d++) {
        all.push({
          month,
          zone: zone?.name ?? null,
          region: region?.name ?? null,
          hq: hq.name,
          hqCode: hq.code,
          tmName: d === 3 ? null : `TM ${h + 1}`,
          tmCode: d === 3 ? null : `83${h}00${d}`,
          doctorCode: `D${month}${h}${d}`,
          doctorName: `Dr. Doctor ${h * 4 + d + 1}`,
          speciality: ['Physician', 'Diabetologist', 'Cardiologist', 'Surgeon'][d]!,
          category: ['A', 'B', 'C', 'B'][d]!,
          rmVisits: d === 1 ? 1 : 0,
          zsmVisits: 0,
        });
      }
    });
  }
  const term = search?.trim().toLowerCase();
  const rows = all.filter(
    (r) =>
      (!term || [r.doctorName, r.doctorCode, r.hq, r.tmName, r.speciality].some((v) => v?.toLowerCase().includes(term))) &&
      (!categories?.length || categories.includes(r.category ?? 'Unclassified')),
  );
  return {
    total: rows.length,
    page,
    pageSize,
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
  };
}
