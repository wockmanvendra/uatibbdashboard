import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { forgetCachedUsers } from '../plugins/auth.js';
import { resetCentralCaches } from '../services/centralAuth.js';
import { installFakeCentral, MOBILE, tokenFor } from '../test/central.js';
import type {
  ApiError, FiltersResponse, LoginResponse, OtpRequestResponse, SessionUser, TabResponse,
} from '../types/api.js';

const TAB_URL = '/api/dashboard/division-performance?from=202604&to=202608';

let app: FastifyInstance;
let central: ReturnType<typeof installFakeCentral>;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  central = installFakeCentral();
  resetCentralCaches();
  forgetCachedUsers();
});

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const getAs = (token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
const errorOf = (res: { json: <T>() => T }) => res.json<ApiError>().error;

async function signIn(mobile: string): Promise<LoginResponse> {
  expect((await post('/api/auth/otp/request', { mobile })).statusCode).toBe(200);
  const res = await post('/api/auth/otp/verify', { mobile, otp: central.OTP });
  expect(res.statusCode).toBe(200);
  return res.json<LoginResponse>();
}

describe('POST /api/auth/otp/request', () => {
  it('asks the Central User Service to email a code, as this app, and says where it went', async () => {
    const res = await post('/api/auth/otp/request', { mobile: MOBILE.TM });
    expect(res.statusCode).toBe(200);
    expect(res.json<OtpRequestResponse>()).toEqual({ sentTo: 'p***@example.com', expiresInSeconds: 600, resendInSeconds: 30 });

    const call = central.state.calls.find((c) => c.path === '/api/auth/otp/request')!;
    expect(call.body).toMatchObject({ client_id: 'ibb-insights', mobileno: MOBILE.TM });
    expect(call.headers).toMatchObject({ 'x-client-id': 'ibb-insights', 'x-api-key': 'test-api-key' });
  });

  it('passes on the service’s refusal for a mobile it does not know', async () => {
    const res = await post('/api/auth/otp/request', { mobile: '9999999999' });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).message).toMatch(/No active account/);
  });

  it('rejects a malformed mobile number without calling the service', async () => {
    expect((await post('/api/auth/otp/request', { mobile: '12345' })).statusCode).toBe(400);
    expect(central.state.calls).toHaveLength(0);
  });

  it('says so plainly when the service cannot be reached', async () => {
    central.state.down = true;
    const res = await post('/api/auth/otp/request', { mobile: MOBILE.TM });
    expect(res.statusCode).toBe(504);
    expect(errorOf(res).message).toMatch(/login service is not reachable/);
  });
});

describe('POST /api/auth/otp/verify', () => {
  it('exchanges the code for the service’s token and the person’s scope from the field hierarchy', async () => {
    const { token, user } = await signIn(MOBILE.TM);
    expect(token.split('.')).toHaveLength(3);
    expect(user).toMatchObject({ id: 'u-T1', role: 'tm', mobile: MOBILE.TM, effectiveScope: { level: 'HQ', nodes: ['M2HYDP'] } });
  });

  it('passes on a wrong code', async () => {
    const res = await post('/api/auth/otp/verify', { mobile: MOBILE.TM, otp: '000000' });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).message).toMatch(/Invalid OTP/);
  });

  it('refuses someone with no territory, rather than show an empty dashboard', async () => {
    const res = await post('/api/auth/otp/verify', { mobile: MOBILE.NO_TERRITORY, otp: central.OTP });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('SCOPE_EMPTY');
  });
});

describe('sessions', () => {
  it('rejects a dashboard request with no token, in the contract error shape', async () => {
    const res = await app.inject({ method: 'GET', url: TAB_URL });
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiError>()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Sign in to view the dashboard.' } });
  });

  it('rejects garbage, other apps’ tokens, other issuers’, expired ones and tampered ones', async () => {
    const tm = central.user(MOBILE.TM);
    const valid = tokenFor(tm);
    const tampered = valid.replace(/\.[^.]+\./, `.${Buffer.from(JSON.stringify({ ...tm, usertype: 'nsm' })).toString('base64url')}.`);
    for (const token of [
      'not.a.jwt',
      tokenFor(tm, { aud: 'mission-purple' }),
      tokenFor(tm, { iss: 'https://evil.example' }),
      tokenFor(tm, { exp: Math.floor(Date.now() / 1000) - 10 }),
      tampered,
    ]) {
      expect((await getAs(token, TAB_URL)).statusCode, token.slice(0, 20)).toBe(401);
    }
    expect((await getAs(valid, TAB_URL)).statusCode).toBe(200);
  });

  it('cuts off a session once the service deactivates the account', async () => {
    const { token } = await signIn(MOBILE.TM);
    expect((await getAs(token, TAB_URL)).statusCode).toBe(200);
    central.user(MOBILE.TM).active = false;
    resetCentralCaches(); // stands in for the one-minute caches expiring
    forgetCachedUsers();
    expect((await getAs(token, TAB_URL)).statusCode).toBe(401);
  });

  it('keeps a signed-in user working while the service is briefly unreachable', async () => {
    const { token } = await signIn(MOBILE.TM);
    forgetCachedUsers();
    central.state.down = true;
    expect((await getAs(token, TAB_URL)).statusCode).toBe(200);
  });

  it('protects the filter options and version endpoints too, and leaves liveness public', async () => {
    for (const url of ['/api/meta/filters', '/api/meta/version', '/api/meta/model']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('scope comes from the field hierarchy (§6.2)', () => {
  it('narrows a TM to their own HQ', async () => {
    const res = await getAs((await signIn(MOBILE.TM)).token, TAB_URL);
    expect(res.headers.vary).toMatch(/authorization/i);
    expect(res.json<TabResponse>().meta.effectiveScope).toEqual({ level: 'HQ', nodes: ['M2HYDP'] });
  });

  it('serves a TM less than the NSM of their division sees', async () => {
    const tm = (await getAs((await signIn(MOBILE.TM)).token, TAB_URL)).json<TabResponse>();
    const nsm = (await getAs((await signIn(MOBILE.NSM)).token, TAB_URL)).json<TabResponse>();
    expect(nsm.meta.effectiveScope).toEqual({ level: 'DIVISION', nodes: ['78'] });
    expect(tm.primary!.dispatch.value).toBeLessThan(nsm.primary!.dispatch.value!);
  });

  it('answers a request for another HQ with the TM’s own figures, not the other HQ’s', async () => {
    const { token } = await signIn(MOBILE.TM);
    const own = (await getAs(token, TAB_URL)).json<TabResponse>();
    for (const extra of ['&hq=M2DELS', '&hq=M2DELS&hq=M2GURG']) {
      const other = (await getAs(token, `${TAB_URL}${extra}`)).json<TabResponse>();
      expect(other.meta.effectiveScope.nodes).toEqual(['M2HYDP']);
      expect(other.primary!.dispatch.value).toBe(own.primary!.dispatch.value);
    }
  });

  it('offers a TM only their own HQ and division in the filter options', async () => {
    const body = (await getAs((await signIn(MOBILE.TM)).token, '/api/meta/filters')).json<FiltersResponse>();
    expect(body.hqs.map((h) => h.code)).toEqual(['M2HYDP']);
    expect(body.divisions.map((d) => d.code)).toEqual(['78']);
  });

  it('answers a request for another division with the user’s own figures', async () => {
    for (const who of [MOBILE.TM, MOBILE.ZSM]) {
      const { token } = await signIn(who);
      const own = (await getAs(token, TAB_URL)).json<TabResponse>();
      const other = (await getAs(token, `${TAB_URL}&division=85`)).json<TabResponse>();
      expect(other.primary!.dispatch.value).toBe(own.primary!.dispatch.value);
    }
  });

  it('gives each role its level: zone, region(s), division', async () => {
    expect((await signIn(MOBILE.ZSM)).user).toMatchObject({ role: 'zsm', effectiveScope: { level: 'ZONE', nodes: ['JH'] } });
    expect((await signIn(MOBILE.RM)).user).toMatchObject({ role: 'rm', effectiveScope: { level: 'REGION', nodes: ['JHH'] } });
    // Two regions in the hierarchy, though the token carries one SAP code.
    expect((await signIn(MOBILE.RM_TWO_REGIONS)).user.effectiveScope).toEqual({ level: 'REGION', nodes: ['JHX', 'JHY'] });
    expect((await signIn(MOBILE.BU_HEAD)).user).toMatchObject({ role: 'bu-head', effectiveScope: { level: 'DIVISION', nodes: ['78'] } });
  });

  it('shows every division to listed mobiles and to the service’s admins', async () => {
    for (const who of [MOBILE.ALL, MOBILE.SERVICE_ADMIN]) {
      expect((await signIn(who)).user.effectiveScope).toEqual({ level: 'ALL', nodes: [] });
    }
  });
});

describe('a person with several roles', () => {
  const getRole = (token: string, url: string, role?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}`, ...(role ? { 'x-dashboard-role': role } : {}) },
    });

  it('signs in on the main role, and is told the others', async () => {
    const { user } = await signIn(MOBILE.TWO_ROLES);
    expect(user).toMatchObject({ role: 'rm', roleKey: 'rm:78', effectiveScope: { level: 'REGION', nodes: ['JHH'] } });
    expect(user.roles.map((r) => r.key)).toEqual(['rm:78', 'bu-head:A8']);
  });

  it('views the dashboard as the role asked for, with that role\'s scope', async () => {
    const { token, user: rm } = await signIn(MOBILE.TWO_ROLES);
    const res = await getRole(token, '/api/auth/session', 'bu-head:A8');
    expect(res.statusCode).toBe(200);
    const buHead = res.json<SessionUser>();
    expect(buHead).toMatchObject({ role: 'bu-head', roleKey: 'bu-head:A8', effectiveScope: { level: 'DIVISION', nodes: ['A8'] } });
    // Different scope, so different cached views.
    expect(buHead.scopeId).not.toBe(rm.scopeId);
    expect((await getRole(token, TAB_URL, 'bu-head:A8')).statusCode).toBe(200);
  });

  it('ignores a role the token does not list: the main role applies', async () => {
    const { token } = await signIn(MOBILE.TWO_ROLES);
    for (const asked of ['admin:85', 'nsm:A8', 'x'.repeat(200)]) {
      expect((await getRole(token, '/api/auth/session', asked)).json<SessionUser>())
        .toMatchObject({ role: 'rm', effectiveScope: { level: 'REGION', nodes: ['JHH'] } });
    }
    // And someone with one role cannot borrow another's.
    const tm = await signIn(MOBILE.TM);
    expect((await getRole(tm.token, '/api/auth/session', 'bu-head:A8')).json<SessionUser>())
      .toMatchObject({ role: 'tm', roles: [{ key: 'tm:78' }] });
  });

  it('gives a service admin all divisions on the main role, and each extra role its own view', async () => {
    const { token, user } = await signIn(MOBILE.ADMIN_TWO_ROLES);
    expect(user).toMatchObject({ role: 'bu-head', effectiveScope: { level: 'ALL', nodes: [] } });
    expect(user.roles.map((r) => [r.key, r.allDivisions])).toEqual([['bu-head:84', true], ['tm:78', false]]);
    expect((await getRole(token, '/api/auth/session', 'tm:78')).json<SessionUser>())
      .toMatchObject({ role: 'tm', effectiveScope: { level: 'HQ', nodes: ['M2HYDP'] } });
  });

  it('needs a signed-in session to read it', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/session' })).statusCode).toBe(401);
  });
});
