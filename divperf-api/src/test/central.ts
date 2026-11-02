/**
 * A stand-in Central User Service for tests: the endpoints this API calls,
 * answered in-process through a stubbed `fetch`, with real RS256 tokens signed
 * by a key made for the test run.
 *
 * The people mirror a small field structure in division 78 (the mock data's):
 * a TM on HQ M2HYDP under RM R1 (region JHH), ZSM Z1 (zone JH) and NSM N1; an
 * RM holding two regions; a BU head; someone listed in ALL_DIVISION_MOBILES;
 * and a service admin.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { vi } from 'vitest';
import { config } from '../config.js';
import type { HierarchyRow } from '../services/centralAuth.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key';

export interface FakeUser {
  sub: string;
  empcode: string | null;
  name: string;
  usertype: string;
  division_code: string | null;
  mobileno: string;
  email: string | null;
  sap_code: string | null;
  is_service_admin?: boolean;
  active: boolean;
}

const person = (sub: string, usertype: string, mobileno: string, empcode: string | null, sap: string | null, division: string | null = '78'): FakeUser => ({
  sub, empcode, name: `Person ${sub}`, usertype, division_code: division, mobileno,
  email: `${sub.toLowerCase()}@example.com`, sap_code: sap, active: true,
});

export const MOBILE = {
  TM: '9000000002',
  RM: '9000000003',
  ZSM: '9000000004',
  NSM: '9000000005',
  RM_TWO_REGIONS: '9000000006',
  BU_HEAD: '9000000007',
  /** In ALL_DIVISION_MOBILES (vitest.config.ts). */
  ALL: '9000000009',
  SERVICE_ADMIN: '9000000010',
  NO_TERRITORY: '9000000011',
} as const;

function freshUsers(): Map<string, FakeUser> {
  const list = [
    person('u-T1', 'tm', MOBILE.TM, 'T1', 'M2HYDP'),
    person('u-R1', 'rm', MOBILE.RM, 'R1', 'JHH'),
    person('u-Z1', 'zsm', MOBILE.ZSM, 'Z1', 'JH'),
    person('u-N1', 'nsm', MOBILE.NSM, 'N1', 'MNAT'),
    person('u-R2', 'rm', MOBILE.RM_TWO_REGIONS, 'R2', 'JHX'),
    person('u-B1', 'bu-head', MOBILE.BU_HEAD, null, null),
    person('u-A1', 'nsm', MOBILE.ALL, 'A1', 'MNAT', '85'),
    { ...person('u-S1', 'admin', MOBILE.SERVICE_ADMIN, null, null, '85'), is_service_admin: true },
    person('u-T9', 'tm', MOBILE.NO_TERRITORY, 'T9', null),
  ];
  return new Map(list.map((u) => [u.mobileno, u]));
}

const row = (tm: string | null, tmSap: string, rm: string, rmSap: string): HierarchyRow => ({
  division_code: '78', tm_empcode: tm, tm_sapcode: tmSap, rm_empcode: rm, rm_sapcode: rmSap,
  zsm_empcode: 'Z1', zsm_sapcode: 'JH', nsm_empcode: 'N1',
});

/** Territories of division 78: R2 manages two regions, kept by the service as one "JHX,JHY". */
export const HIERARCHY_78: HierarchyRow[] = [
  row('T1', 'M2HYDP', 'R1', 'JHH'),
  row(null, 'M2DELS', 'R2', 'JHX,JHY'),
  row(null, 'M2GURG', 'R2', 'JHY,JHX'),
];

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** A token as the service signs it; `over` changes any claim (aud, iss, exp…). */
export function tokenFor(u: FakeUser, over: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const { active: _a, ...claims } = u;
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: KID });
  const payload = b64({ ...claims, iss: config.CENTRAL_ISSUER, aud: config.CENTRAL_CLIENT_ID, iat: now, exp: now + 3600, ...over });
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const OTP = '123456';

export function installFakeCentral() {
  const state = {
    users: freshUsers(),
    hierarchy: HIERARCHY_78,
    down: false,
    calls: [] as { method: string; path: string; body: Record<string, unknown>; headers: Record<string, string> }[],
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!url.href.startsWith(config.CENTRAL_USER_SERVICE_URL)) throw new Error(`Unexpected fetch: ${url.href}`);
    if (state.down) throw new TypeError('fetch failed');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    state.calls.push({ method: init?.method ?? 'GET', path: url.pathname + url.search, body, headers });
    const appOk = headers['x-client-id'] === config.CENTRAL_CLIENT_ID && headers['x-api-key'] === config.CENTRAL_API_KEY;

    switch (url.pathname) {
      case '/.well-known/jwks.json':
        return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] });
      case '/api/auth/otp/request': {
        const u = state.users.get(String(body.mobileno));
        if (!u || !u.active) return json(404, { error: 'No active account is registered with this mobile number. Contact your administrator.' });
        return json(200, { sent: true, channel: 'email', email: 'p***@example.com', expires_in_minutes: 10, resend_in_seconds: 30 });
      }
      case '/api/auth/otp/verify': {
        const u = state.users.get(String(body.mobileno));
        if (!u || !u.active) return json(404, { error: 'No active account is registered with this mobile number.' });
        if (body.otp !== OTP) return json(401, { error: 'Invalid OTP. 4 attempt(s) left.' });
        return json(200, { token: tokenFor(u), token_type: 'Bearer' });
      }
      case '/api/v1/token/introspect': {
        if (!appOk) return json(401, { error: 'Invalid API key' });
        const sub = JSON.parse(Buffer.from(String(body.token).split('.')[1] ?? '', 'base64url').toString() || '{}').sub;
        const u = [...state.users.values()].find((x) => x.sub === sub);
        return json(200, { active: !!u?.active });
      }
      case '/api/v1/hierarchy':
        if (!appOk) return json(401, { error: 'Invalid API key' });
        return json(200, { rows: state.hierarchy.filter((r) => r.division_code === url.searchParams.get('division_code')) });
      case '/api/v1/users': {
        if (!appOk) return json(401, { error: 'Invalid API key' });
        const type = url.searchParams.get('usertype');
        const users = [...state.users.values()].filter((u) => u.active && (!type || u.usertype === type))
          .map(({ sub, active: _a, ...u }) => ({ ...u, id: sub }));
        return json(200, { total: users.length, users });
      }
      default:
        return json(404, { error: 'Not found' });
    }
  };

  vi.stubGlobal('fetch', vi.fn(handler));
  return { state, OTP, user: (mobile: string) => state.users.get(mobile)! };
}
