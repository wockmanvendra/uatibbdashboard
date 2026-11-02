/**
 * RESEARCH is division 02 in the sales data and 84 in the visits, hospitals,
 * people and user service: DIVISION_ALIASES (84:02) makes it one division.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalDivisionCode, config } from '../config.js';
import { TERRITORY_JOIN, canonicalDivision, divisionCode, territoryJoin } from './sqlFragments.js';
import { CN_MATCH, FACT_MATCH, grainSelect } from './queryBuilder.js';
import { filterQuery } from '../routes/params.js';
import { sessionUser } from '../users/sessionUser.js';
import { resetCentralCaches, type CentralUser, type HierarchyRow } from '../services/centralAuth.js';
import { installFakeCentral } from '../test/central.js';

const ALIASED = "CASE NULLIF(LTRIM(RTRIM(Division_Code)), '') WHEN '84' THEN '02'";

describe('division aliases', () => {
  it('reads 84 as 02, by default', () => {
    expect(config.DIVISION_ALIASES).toEqual({ '84': '02' });
    expect(canonicalDivisionCode('84')).toBe('02');
    expect(canonicalDivisionCode('85')).toBe('85');
    expect(canonicalDivision('x')).toBe("CASE x WHEN '84' THEN '02' ELSE x END");
  });

  it('holds the hospital and effort settings to the division, not its alias', () => {
    expect(config.HOSPITAL_DIVISIONS).toEqual(['02']);
    expect(config.EFFORT_DIVISIONS['02']).toBe('RESEARCH');
    expect(config.EFFORT_DIVISIONS['84']).toBeUndefined();
  });

  it('matches and groups every source on the division', () => {
    expect(divisionCode('Division_Code')).toContain(ALIASED);
    expect(FACT_MATCH.division('(@p0)')).toBe(`${divisionCode('Division_Code')} IN (@p0)`);
    expect(CN_MATCH.division('(@c0)')).toBe(`${divisionCode('c.Division_Code')} IN (@c0)`);
    expect(territoryJoin('a.div_code', 'a.hq_code')).toContain(`SELECT ${divisionCode('Division_Code')} AS div_code`);
    expect(TERRITORY_JOIN).toContain(`= ${divisionCode('c.Division_Code')}`);
  });

  it('names 02 RESEARCH, whatever its 84 rows say', () => {
    const { select, groupBy } = grainSelect('division');
    expect(groupBy).toContain(ALIASED);
    expect(select).toMatch(/COALESCE\(CASE .* WHEN '02' THEN 'RESEARCH' END, MAX\(/);
  });

  it('takes a division filter of 84 as 02', () => {
    const q = filterQuery.parse({ from: '202604', to: '202609', division: '84,02,85' });
    expect(q.division).toEqual(['02', '85']);
  });
});

describe('a user of division 84', () => {
  let central: ReturnType<typeof installFakeCentral>;
  beforeEach(() => {
    central = installFakeCentral();
    resetCentralCaches();
  });

  const user = (over: Partial<CentralUser>): CentralUser => ({
    sub: 'u-R', empcode: null, name: 'Research person', usertype: 'bu-head', division_code: '84',
    mobileno: '9000000099', email: null, sap_code: null, ...over,
  });

  it('heads division 02', async () => {
    expect(await sessionUser(user({}))).toMatchObject({ scopeLevel: 'DIVISION', scopeNodes: ['02'], divisions: ['02'] });
  });

  it('holds their territories, read from the service as 84', async () => {
    const row: HierarchyRow = {
      division_code: '84', tm_empcode: 'T84', tm_sapcode: '6HYD', rm_empcode: 'R84', rm_sapcode: '6HR',
      zsm_empcode: 'Z84', zsm_sapcode: '6SZ', nsm_empcode: 'N84',
    };
    central.state.hierarchy = [row];
    const tm = await sessionUser(user({ usertype: 'tm', empcode: 'T84' }));
    expect(tm).toMatchObject({ scopeLevel: 'HQ', scopeNodes: ['6HYD'], divisions: ['02'] });
    expect(central.state.calls.some((c) => c.path === '/api/v1/hierarchy?division_code=84')).toBe(true);
  });
});
