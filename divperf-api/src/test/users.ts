/**
 * Test fixtures for the sign-in database: field-structure records shaped like
 * the Infinity API's, loaded through the real sync code.
 */
import { userDb } from '../users/db.js';
import { config } from '../config.js';
import { syncDivision } from '../users/infinitySync.js';
import { assertTestDb } from './testDb.js';

export const DIVISION = '78';

export async function resetUsers(): Promise<void> {
  assertTestDb(config.USER_DATABASE_URL);
  await userDb().query('TRUNCATE field_structure_infinity, login_otp, login_history, infinity_sync_log');
}

type Rec = Record<string, string | null>;

/** One field location, as the Infinity field-structure API returns it. */
export function location(r: {
  id: string;
  type: 'Territory' | 'Region' | 'Zone' | 'Sales Area';
  empCode: string | null;
  name?: string;
  mobile?: string | null;
  sapCode?: string | null;
  manager1?: [code: string, sapCode: string | null];
  manager2?: [code: string, sapCode: string | null];
}): Rec {
  return {
    tmLocationId: r.id,
    division: 'MERIND',
    divisionCode: DIVISION,
    empCode: r.empCode,
    empName: r.name ?? `Person ${r.empCode}`,
    empLocation: `${r.type} ${r.id}`,
    empLocationType: r.type,
    sapCode: r.sapCode ?? null,
    mobile: r.mobile ?? null,
    email: r.empCode ? `${r.empCode.toLowerCase()}@example.com` : null,
    manager1Code: r.manager1?.[0] ?? null,
    manager1Name: r.manager1 ? `Person ${r.manager1[0]}` : null,
    manager1Location: r.manager1 ? 'Manager 1 location' : null,
    manager1SapCode: r.manager1?.[1] ?? null,
    manager2Code: r.manager2?.[0] ?? null,
    manager2Name: r.manager2 ? `Person ${r.manager2[0]}` : null,
    manager2Location: r.manager2 ? 'Manager 2 location' : null,
    manager2SapCode: r.manager2?.[1] ?? null,
  };
}

/**
 * A TM (HQ M2HYDP) under an RM (region JHH), a ZSM (zone JH) and an NSM
 * (division 78) — each with their own location row, which is where the views
 * find their mobile numbers.
 */
export const HIERARCHY: Rec[] = [
  location({ id: 'L-N1', type: 'Sales Area', empCode: 'N1', mobile: '9000000005', sapCode: 'MNAT' }),
  location({ id: 'L-Z1', type: 'Zone', empCode: 'Z1', mobile: '9000000004', sapCode: 'JH', manager1: ['N1', 'MNAT'] }),
  location({ id: 'L-R1', type: 'Region', empCode: 'R1', mobile: '9000000003', sapCode: 'JHH', manager1: ['Z1', 'JH'] }),
  location({
    id: 'L-T1',
    type: 'Territory',
    empCode: 'T1',
    name: 'Field Rep',
    mobile: '+91 90000 00002',
    sapCode: 'M2HYDP',
    manager1: ['R1', 'JHH'],
    manager2: ['Z1', 'JH'],
  }),
];

/** Replaces the division's field structure with `records`, via the real sync. */
export async function loadFieldStructure(records: Rec[] = HIERARCHY): Promise<void> {
  const client = await userDb().connect();
  try {
    const result = await syncDivision(
      client,
      { divisionCode: DIVISION, infinityDivisionCode: 'test-division' },
      { fetchRecords: async () => records, force: true },
    );
    if (result.status !== 'success') throw new Error(`fixture sync failed: ${result.error}`);
  } finally {
    client.release();
  }
}
