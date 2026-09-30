import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { closeUserDb, userDb } from './db.js';
import { syncDivision } from './infinitySync.js';
import { DIVISION, HIERARCHY, location, resetUsers } from '../test/users.js';

const DIV = { divisionCode: DIVISION, infinityDivisionCode: 'test-division' };

beforeEach(resetUsers);
afterAll(closeUserDb);

async function sync(records: unknown[] | Error, force = false) {
  const client: pg.PoolClient = await userDb().connect();
  try {
    return await syncDivision(client, DIV, {
      force,
      fetchRecords: async () => {
        if (records instanceof Error) throw records;
        return records;
      },
    });
  } finally {
    client.release();
  }
}

const count = async () =>
  (await userDb().query<{ n: number }>('SELECT COUNT(*)::int AS n FROM field_structure_infinity')).rows[0]!.n;

const territories = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    location({ id: `L${i}`, type: 'Territory', empCode: `E${i}`, mobile: `90000${String(i).padStart(5, '0')}`, sapCode: `HQ${i}` }),
  );

describe('syncDivision', () => {
  it('loads what Infinity returns, and the views turn it into sign-in identities', async () => {
    expect(await sync(HIERARCHY)).toMatchObject({ status: 'success', rowCount: 4, skipped: 0 });
    const { rows } = await userDb().query(
      `SELECT empcode, usertype, mobileno, scope_level, scope_nodes FROM vw_dashboard_users ORDER BY empcode`,
    );
    expect(rows).toEqual([
      { empcode: 'N1', usertype: 'nsm', mobileno: '9000000005', scope_level: 'DIVISION', scope_nodes: ['78'] },
      { empcode: 'R1', usertype: 'rm', mobileno: '9000000003', scope_level: 'REGION', scope_nodes: ['JHH'] },
      { empcode: 'T1', usertype: 'tm', mobileno: '9000000002', scope_level: 'HQ', scope_nodes: ['M2HYDP'] },
      { empcode: 'Z1', usertype: 'zsm', mobileno: '9000000004', scope_level: 'ZONE', scope_nodes: ['JH'] },
    ]);
  });

  it('replaces the division, so people Infinity no longer lists disappear', async () => {
    await sync(territories(5));
    await sync(territories(3), true);
    expect(await count()).toBe(3);
  });

  it('keeps the existing rows when Infinity fails, and logs the failure', async () => {
    await sync(HIERARCHY);
    expect(await sync(new Error('Infinity field-structure API answered 503'))).toMatchObject({ status: 'error' });
    expect(await count()).toBe(4);
    const { rows } = await userDb().query(`SELECT status, error_message FROM infinity_sync_log ORDER BY synced_at`);
    expect(rows.map((r) => r.status)).toEqual(['success', 'error']);
    expect(rows[1].error_message).toMatch(/503/);
  });

  it('refuses an empty response rather than sign the division out', async () => {
    await sync(HIERARCHY);
    expect(await sync([])).toMatchObject({ status: 'error' });
    expect(await count()).toBe(4);
  });

  it('refuses a division shrinking by half unless forced', async () => {
    await sync(territories(30));
    expect(await sync(territories(10))).toMatchObject({ status: 'error' });
    expect(await count()).toBe(30);
    expect(await sync(territories(10), true)).toMatchObject({ status: 'success' });
    expect(await count()).toBe(10);
  });

  it('skips records without a location id, and repeats of one', async () => {
    const [first] = territories(1);
    const result = await sync([first, { ...first }, { ...first, tmLocationId: null }, ...territories(3).slice(1)]);
    expect(result).toMatchObject({ status: 'success', rowCount: 3, skipped: 2 });
  });

  it('trims values and cuts them to the column width', async () => {
    await sync([{ ...territories(1)[0], empName: '  Padded Name  ', mirrorHq: 'ABCDEFGHIJKLMNOP' }]);
    const { rows } = await userDb().query(`SELECT emp_name, mirror_hq FROM field_structure_infinity`);
    expect(rows[0]).toEqual({ emp_name: 'Padded Name', mirror_hq: 'ABCDEFGHIJ' });
  });

  it('scopes a manager of several nodes to all of them', async () => {
    await sync([
      ...HIERARCHY,
      location({ id: 'L-T9', type: 'Territory', empCode: 'T9', mobile: '9000000099', sapCode: 'M2BGLP', manager1: ['R1', 'JEB'], manager2: ['Z1', 'JH'] }),
    ]);
    const { rows } = await userDb().query(`SELECT scope_nodes FROM vw_dashboard_users WHERE empcode = 'R1'`);
    expect(rows[0].scope_nodes).toEqual(['JEB', 'JHH']);
  });
});
