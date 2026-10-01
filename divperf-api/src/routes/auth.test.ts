import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { forgetCachedUsers } from '../plugins/auth.js';
import { OTP_MAX_ATTEMPTS } from '../services/authService.js';
import { userDb } from '../users/db.js';
import { HIERARCHY, loadFieldStructure, location, resetUsers } from '../test/users.js';
import type {
  ApiError,
  FiltersResponse,
  LoginResponse,
  OtpRequestResponse,
  TabResponse,
} from '../types/api.js';

const TM = '9000000002';
const ZSM = '9000000004';
const NSM = '9000000005';
const TAB_URL = '/api/dashboard/division-performance?from=202604&to=202608';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetUsers();
  forgetCachedUsers();
  await loadFieldStructure();
});

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const getAs = (token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
const errorOf = (res: { json: <T>() => T }) => res.json<ApiError>().error;
const withoutTm = () => HIERARCHY.filter((r) => r.empCode !== 'T1');

async function requestCode(mobile: string): Promise<string> {
  const res = await post('/api/auth/otp/request', { mobile });
  expect(res.statusCode).toBe(200);
  return res.json<OtpRequestResponse>().devOtp!;
}

async function signIn(mobile: string): Promise<LoginResponse> {
  const otp = await requestCode(mobile);
  const res = await post('/api/auth/otp/verify', { mobile, otp });
  expect(res.statusCode).toBe(200);
  return res.json<LoginResponse>();
}

const wrong = (otp: string) => (otp === '000000' ? '111111' : '000000');

async function otpRow(empcode: string) {
  const { rows } = await userDb().query(
    `SELECT otp_hash, otp_attempts, last_login_at FROM login_otp WHERE empcode = $1`,
    [empcode],
  );
  return rows[0] as { otp_hash: string | null; otp_attempts: number; last_login_at: Date | null };
}

describe('POST /api/auth/otp/request', () => {
  it('issues a 6-digit code to a mobile in the field structure and stores only its hash', async () => {
    const otp = await requestCode(TM);
    expect(otp).toMatch(/^\d{6}$/);
    const row = await otpRow('T1');
    expect(row.otp_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.otp_hash).not.toContain(otp);
  });

  it('says so when the mobile is not in the field structure, and records the attempt', async () => {
    const res = await post('/api/auth/otp/request', { mobile: '9876543210' });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).message).toMatch(/not registered/i);
    const { rows } = await userDb().query(`SELECT status, failure_reason FROM login_history`);
    expect(rows).toEqual([{ status: 'failed', failure_reason: 'Not registered' }]);
  });

  it('treats someone who has left the field structure as not registered', async () => {
    await loadFieldStructure(withoutTm());
    expect((await post('/api/auth/otp/request', { mobile: TM })).statusCode).toBe(404);
  });

  it('refuses a mobile listed against two people, rather than guess', async () => {
    await loadFieldStructure([
      ...HIERARCHY,
      location({ id: 'L-T2', type: 'Territory', empCode: 'T2', mobile: TM, sapCode: 'M2BGLP', manager1: ['R1', 'JHH'], manager2: ['Z1', 'JH'] }),
    ]);
    const res = await post('/api/auth/otp/request', { mobile: TM });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).message).toMatch(/more than one person/i);
  });

  it('refuses someone with no territory before sending a code', async () => {
    await loadFieldStructure(
      HIERARCHY.map((r) => (r.empCode === 'T1' ? { ...r, sapCode: null } : r)),
    );
    const res = await post('/api/auth/otp/request', { mobile: TM });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('SCOPE_EMPTY');
    expect(await otpRow('T1')).toBeUndefined();
  });

  it('rejects a malformed mobile number', async () => {
    expect((await post('/api/auth/otp/request', { mobile: '12345' })).statusCode).toBe(400);
  });

  it('enforces the resend cooldown', async () => {
    await requestCode(TM);
    const again = await post('/api/auth/otp/request', { mobile: TM });
    expect(again.statusCode).toBe(429);
    expect(errorOf(again)).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(errorOf(again).message).toMatch(/Wait \d+s/);
  });
});

describe('POST /api/auth/otp/verify', () => {
  it('exchanges a correct code for a token and the person’s scope from the field structure', async () => {
    const { token, user } = await signIn(TM);
    expect(token).toBeTruthy();
    expect(user).toMatchObject({
      id: 'T1',
      name: 'Field Rep',
      role: 'tm',
      mobile: TM,
      effectiveScope: { level: 'HQ', nodes: ['M2HYDP'] },
    });
    const row = await otpRow('T1');
    expect(row.otp_hash).toBeNull();
    expect(row.last_login_at).not.toBeNull();
  });

  it('does not accept the same code twice', async () => {
    const otp = await requestCode(TM);
    expect((await post('/api/auth/otp/verify', { mobile: TM, otp })).statusCode).toBe(200);
    expect((await post('/api/auth/otp/verify', { mobile: TM, otp })).statusCode).toBe(401);
  });

  it('lets exactly one of two simultaneous correct guesses through', async () => {
    const otp = await requestCode(TM);
    const results = await Promise.all([
      post('/api/auth/otp/verify', { mobile: TM, otp }),
      post('/api/auth/otp/verify', { mobile: TM, otp }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });

  it('counts down wrong guesses, then refuses even the right code', async () => {
    const otp = await requestCode(TM);
    const first = await post('/api/auth/otp/verify', { mobile: TM, otp: wrong(otp) });
    expect(first.statusCode).toBe(401);
    expect(errorOf(first).message).toBe(`Incorrect OTP. ${OTP_MAX_ATTEMPTS - 1} attempt(s) left.`);

    for (let i = 2; i < OTP_MAX_ATTEMPTS; i++) await post('/api/auth/otp/verify', { mobile: TM, otp: wrong(otp) });
    expect((await post('/api/auth/otp/verify', { mobile: TM, otp: wrong(otp) })).statusCode).toBe(429);
    expect((await post('/api/auth/otp/verify', { mobile: TM, otp })).statusCode).toBe(429);
  });

  it('refuses an expired code', async () => {
    const otp = await requestCode(TM);
    await userDb().query(`UPDATE login_otp SET otp_expires_at = NOW() - INTERVAL '1 second' WHERE empcode = 'T1'`);
    const res = await post('/api/auth/otp/verify', { mobile: TM, otp });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).message).toMatch(/expired/i);
  });

  it('refuses a code when none was requested', async () => {
    expect((await post('/api/auth/otp/verify', { mobile: TM, otp: '123456' })).statusCode).toBe(401);
  });

  it('records successes and failures in login_history', async () => {
    const otp = await requestCode(TM);
    await post('/api/auth/otp/verify', { mobile: TM, otp: wrong(otp) });
    await post('/api/auth/otp/verify', { mobile: TM, otp });
    const { rows } = await userDb().query(
      `SELECT status, failure_reason, user_id FROM login_history ORDER BY logged_in_at`,
    );
    expect(rows).toEqual([
      { status: 'failed', failure_reason: 'Invalid OTP', user_id: 'T1' },
      { status: 'success', failure_reason: null, user_id: 'T1' },
    ]);
  });
});

describe('sessions', () => {
  it('rejects a dashboard request with no token, in the contract error shape', async () => {
    const res = await app.inject({ method: 'GET', url: TAB_URL });
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiError>()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Sign in to view the dashboard.' },
    });
  });

  it('rejects forged tokens and tokens for people not in the field structure', async () => {
    expect((await getAs('not.a.jwt', TAB_URL)).statusCode).toBe(401);
    expect((await getAs(app.jwt.sign({ sub: 'NOBODY' }), TAB_URL)).statusCode).toBe(401);
  });

  it('cuts off a session once the person leaves the field structure', async () => {
    const { token } = await signIn(TM);
    expect((await getAs(token, TAB_URL)).statusCode).toBe(200);
    await loadFieldStructure(withoutTm());
    forgetCachedUsers(); // stands in for the one-minute cache expiring
    expect((await getAs(token, TAB_URL)).statusCode).toBe(401);
  });

  it('protects the filter options and version endpoints too', async () => {
    for (const url of ['/api/meta/filters', '/api/meta/version', '/api/meta/model']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
  });

  it('leaves liveness public', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('scope comes from the field structure (§6.2)', () => {
  it('narrows a TM to their own HQ', async () => {
    const { token } = await signIn(TM);
    const res = await getAs(token, TAB_URL);
    expect(res.headers.vary).toMatch(/authorization/i);
    expect(res.json<TabResponse>().meta.effectiveScope).toEqual({ level: 'HQ', nodes: ['M2HYDP'] });
  });

  it('serves a TM less than the NSM of their division sees', async () => {
    const tm = (await getAs((await signIn(TM)).token, TAB_URL)).json<TabResponse>();
    const nsm = (await getAs((await signIn(NSM)).token, TAB_URL)).json<TabResponse>();
    expect(nsm.meta.effectiveScope).toEqual({ level: 'DIVISION', nodes: ['78'] });
    expect(tm.primary!.dispatch.value).toBeLessThan(nsm.primary!.dispatch.value!);
  });

  it('answers a request for another HQ with the TM’s own figures, not the other HQ’s', async () => {
    const { token } = await signIn(TM);
    const own = (await getAs(token, TAB_URL)).json<TabResponse>();
    // Asking only for out-of-scope nodes must not fall through to "no filter".
    for (const extra of ['&hq=M2DELS', '&hq=M2DELS&hq=M2GURG']) {
      const other = (await getAs(token, `${TAB_URL}${extra}`)).json<TabResponse>();
      expect(other.meta.effectiveScope.nodes).toEqual(['M2HYDP']);
      expect(other.primary!.dispatch.value).toBe(own.primary!.dispatch.value);
    }
  });

  it('offers a TM only their own HQ in the filter options', async () => {
    const { token } = await signIn(TM);
    const body = (await getAs(token, '/api/meta/filters')).json<FiltersResponse>();
    expect(body.hqs.map((h) => h.code)).toEqual(['M2HYDP']);
  });

  it('offers a TM only their own division, and only its brands', async () => {
    const { token } = await signIn(TM);
    const body = (await getAs(token, '/api/meta/filters')).json<FiltersResponse>();
    expect(body.divisions.map((d) => d.code)).toEqual(['78']);
    expect(body.brands.length).toBeGreaterThan(0);
    expect(body.brands.map((b) => b.code)).not.toContain('WOSULIN'); // a DIABETES (85) brand
    expect(body.zones.map((z) => z.code)).toEqual(['JH']);
  });

  it('answers a request for another division with the user’s own figures', async () => {
    for (const who of [TM, ZSM]) {
      const { token } = await signIn(who);
      const own = (await getAs(token, TAB_URL)).json<TabResponse>();
      const other = (await getAs(token, `${TAB_URL}&division=85`)).json<TabResponse>();
      expect(other.primary!.dispatch.value).toBe(own.primary!.dispatch.value);
    }
  });

  it('gives a zonal manager their zone', async () => {
    const { user } = await signIn(ZSM);
    expect(user).toMatchObject({ role: 'zsm', effectiveScope: { level: 'ZONE', nodes: ['JH'] } });
  });
});
