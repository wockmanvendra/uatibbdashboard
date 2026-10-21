import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { forgetCachedUsers } from '../plugins/auth.js';
import { userDb } from '../users/db.js';
import { createAccount } from '../users/accounts.js';
import { hashPassword } from '../services/passwordAuth.js';
import { resetUsers } from '../test/users.js';
import type {
  ApiError, ForgotPasswordResponse, ForgotPasswordVerifyResponse, LoginResponse, PasswordLoginResponse, TabResponse,
} from '../types/api.js';

const BU = '9100000001';
const TEMP = 'Temp#Pass1';
const MINE = 'Mine@2026x';
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
});

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const getAs = (token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
const errorOf = (res: { json: <T>() => T }) => res.json<ApiError>().error;

/** A BU head for division 78 with password `password`, last changed `changedAt` (null: never). */
async function addBuHead(password = TEMP, changedAt: string | null = null, email: string | null = 'bu.head@wockhardt.com') {
  const a = await createAccount({
    name: 'Test BU Head', mobileno: BU, email, empcode: 'B1', divisionCodes: ['78'],
    passwordHash: await hashPassword(password),
  });
  if (changedAt) {
    await userDb().query(`UPDATE dashboard_accounts SET password_changed_at = ${changedAt} WHERE id = $1`, [a.id]);
  }
  return a;
}

const login = (password: string) => post('/api/auth/password', { mobile: BU, password });

async function changeTokenFor(password = TEMP): Promise<string> {
  const res = await login(password);
  expect(res.statusCode).toBe(200);
  const body = res.json<PasswordLoginResponse>();
  expect(body).toMatchObject({ mustChangePassword: true });
  return (body as { changeToken: string }).changeToken;
}

describe('BU head password sign-in', () => {
  it('makes a new BU head choose a password, then signs them in to their division', async () => {
    await addBuHead();
    const changeToken = await changeTokenFor();

    // The change token is not a session.
    expect((await getAs(changeToken, TAB_URL)).statusCode).toBe(401);

    const weak = await post('/api/auth/password/change', { changeToken, newPassword: 'password' });
    expect(weak.statusCode).toBe(400);
    expect(errorOf(weak).message).toMatch(/uppercase/);

    const changed = await post('/api/auth/password/change', { changeToken, newPassword: MINE });
    expect(changed.statusCode).toBe(200);
    const session = changed.json<LoginResponse>();
    expect(session.user).toMatchObject({
      name: 'Test BU Head', role: 'bu-head', effectiveScope: { level: 'DIVISION', nodes: ['78'] },
    });

    const tab = await getAs(session.token, TAB_URL);
    expect(tab.statusCode).toBe(200);
    expect(tab.json<TabResponse>().meta.effectiveScope).toEqual({ level: 'DIVISION', nodes: ['78'] });

    // From now on the chosen password signs straight in.
    const again = await login(MINE);
    expect(again.json<LoginResponse>().user.role).toBe('bu-head');
  });

  it('uses a change token once only', async () => {
    await addBuHead();
    const changeToken = await changeTokenFor();
    expect((await post('/api/auth/password/change', { changeToken, newPassword: MINE })).statusCode).toBe(200);
    const replay = await post('/api/auth/password/change', { changeToken, newPassword: 'Other#Pass9' });
    expect(replay.statusCode).toBe(401);
    expect((await login('Other#Pass9')).statusCode).toBe(401);
  });

  it('asks for a new password once the current one is 90 days old', async () => {
    await addBuHead(MINE, `NOW() - INTERVAL '91 days'`);
    expect((await login(MINE)).json<PasswordLoginResponse>()).toMatchObject({ mustChangePassword: true });
  });

  it('refuses to keep the same password', async () => {
    await addBuHead(MINE, `NOW() - INTERVAL '91 days'`);
    const changeToken = await changeTokenFor(MINE);
    const same = await post('/api/auth/password/change', { changeToken, newPassword: MINE });
    expect(same.statusCode).toBe(400);
  });

  it('locks the account at the third wrong password, and records each attempt', async () => {
    await addBuHead(MINE, 'NOW()');
    const first = await login('Wrong#1pass');
    expect(first.statusCode).toBe(401);
    expect(errorOf(first).message).toMatch(/2 attempt\(s\) left/);
    expect(errorOf(await login('Wrong#1pass')).message).toMatch(/1 attempt\(s\) left/);

    const third = await login('Wrong#1pass');
    expect(third.statusCode).toBe(403);
    expect(errorOf(third).code).toBe('FORBIDDEN');

    // Locked: even the right password is refused.
    const right = await login(MINE);
    expect(right.statusCode).toBe(403);
    expect(errorOf(right).message).toMatch(/locked/i);

    const { rows } = await userDb().query(
      `SELECT status, failure_reason, login_method FROM login_history WHERE mobileno = $1 ORDER BY logged_in_at`,
      [BU],
    );
    expect(rows.map((r) => r.failure_reason)).toEqual(['Invalid password', 'Invalid password', 'Invalid password', 'Account locked']);
    expect(rows.every((r) => r.login_method === 'password')).toBe(true);
  });

  it('says so for a mobile with no BU head account', async () => {
    const res = await post('/api/auth/password', { mobile: '9876543210', password: MINE });
    expect(res.statusCode).toBe(404);
  });

  it('ends a disabled account, and its open sessions', async () => {
    await addBuHead(MINE, 'NOW()');
    const { token } = (await login(MINE)).json<LoginResponse>();
    expect((await getAs(token, TAB_URL)).statusCode).toBe(200);

    await userDb().query(`UPDATE dashboard_accounts SET is_active = FALSE WHERE mobileno = $1`, [BU]);
    forgetCachedUsers(); // stands in for the one-minute cache expiring
    expect((await getAs(token, TAB_URL)).statusCode).toBe(401);
    expect((await login(MINE)).statusCode).toBe(404);
  });
});

describe('forgot password', () => {
  it('resets a locked account through a code, and signs in', async () => {
    await addBuHead(MINE, 'NOW()');
    for (let i = 0; i < 3; i++) await login('Wrong#1pass');
    expect((await login(MINE)).statusCode).toBe(403);

    const sent = await post('/api/auth/password/forgot', { mobile: BU });
    expect(sent.statusCode).toBe(200);
    const body = sent.json<ForgotPasswordResponse>();
    expect(body.sentTo).toBe('b***@wockhardt.com');
    expect(body.devOtp).toMatch(/^\d{6}$/);

    const wrongCode = body.devOtp === '000000' ? '111111' : '000000';
    const bad = await post('/api/auth/password/forgot/verify', { mobile: BU, otp: wrongCode });
    expect(bad.statusCode).toBe(401);

    const ok = await post('/api/auth/password/forgot/verify', { mobile: BU, otp: body.devOtp });
    expect(ok.statusCode).toBe(200);
    const { changeToken } = ok.json<ForgotPasswordVerifyResponse>();

    const changed = await post('/api/auth/password/change', { changeToken, newPassword: 'Fresh#2026' });
    expect(changed.statusCode).toBe(200);
    expect((await login('Fresh#2026')).json<LoginResponse>().user.role).toBe('bu-head');
  });

  it('waits before sending another code', async () => {
    await addBuHead(MINE, 'NOW()');
    expect((await post('/api/auth/password/forgot', { mobile: BU })).statusCode).toBe(200);
    const again = await post('/api/auth/password/forgot', { mobile: BU });
    expect(again.statusCode).toBe(429);
  });
});
