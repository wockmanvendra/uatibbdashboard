/**
 * The Central User Service (config CENTRAL_USER_SERVICE_URL,
 * users.wockregenerative.com): who may sign in, the OTP, and the session
 * token. The only module that talks to it.
 *
 *   Sign-in      POST /api/auth/otp/request, /api/auth/otp/verify — the service
 *                emails the OTP and returns an RS256 token for this app
 *                (aud = CENTRAL_CLIENT_ID, iss = CENTRAL_ISSUER).
 *   Each request the token is checked here with the service's public key
 *                (/.well-known/jwks.json, cached an hour), and the account is
 *                confirmed still active (POST /api/v1/token/introspect, cached
 *                a minute per token; trusted while the service is unreachable).
 *   Scope        GET /api/v1/hierarchy — one row per territory with its TM, RM
 *                and ZSM — gives each person's HQs, regions or zones.
 *   Warmer       GET /api/v1/users — the senior users whose views are pre-built.
 *
 * Calls other than the public key send the app's X-Client-Id and X-Api-Key.
 */
import { createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto';
import { config } from '../config.js';
import {
  AppError, badRequest, forbidden, notFound, tooManyRequests, unauthorized, upstreamUnavailable,
} from '../lib/errors.js';

/** The user in the service's token and API answers. */
export interface CentralUser {
  /** The service's user id — the token's `sub`. */
  sub: string;
  empcode: string | null;
  name: string;
  usertype: string;
  division_code: string | null;
  division_name?: string | null;
  mobileno: string;
  email: string | null;
  location?: string | null;
  sap_code?: string | null;
  /** Present once the service puts it in tokens: may use the service's admin page. */
  is_service_admin?: boolean;
}

export interface TokenClaims extends CentralUser {
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
}

/** One territory and the people above it (the service's vw_tm_hierarchy). */
export interface HierarchyRow {
  division_code: string;
  tm_empcode: string | null;
  tm_sapcode: string | null;
  rm_empcode: string | null;
  rm_sapcode: string | null;
  zsm_empcode: string | null;
  zsm_sapcode: string | null;
  nsm_empcode: string | null;
}

const UNREACHABLE = 'The login service is not reachable. Please try again shortly.';
const TIMEOUT_MS = 20_000;

const appHeaders = () => ({ 'X-Client-Id': config.CENTRAL_CLIENT_ID, 'X-Api-Key': config.CENTRAL_API_KEY });

/**
 * Calls the service. Its refusals keep their status and message (they are
 * written for users: "No active account is registered with this mobile
 * number…"); an unreachable service is a 504.
 */
async function call<T>(method: 'GET' | 'POST', path: string, { body, app = true }: { body?: object; app?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.CENTRAL_USER_SERVICE_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(app ? appHeaders() : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw upstreamUnavailable(UNREACHABLE, err);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.ok) return data as T;

  const message = typeof data.error === 'string' && data.error ? data.error : `Login service error (${res.status}).`;
  switch (res.status) {
    case 400: throw badRequest(message);
    case 401: throw unauthorized(message);
    case 403: throw forbidden(message);
    case 404: throw notFound(message);
    case 429: throw tooManyRequests(message);
    default: throw upstreamUnavailable(res.status >= 500 ? message : UNREACHABLE, { status: res.status, message });
  }
}

// ── Sign-in ────────────────────────────────────────────────────────────────

export async function requestOtp(mobile: string, ip: string) {
  const r = await call<{ email: string; expires_in_minutes: number; resend_in_seconds: number }>(
    'POST',
    '/api/auth/otp/request',
    { body: { client_id: config.CENTRAL_CLIENT_ID, mobileno: mobile, end_user_ip: ip } },
  );
  return {
    sentTo: r.email,
    expiresInSeconds: Math.round(r.expires_in_minutes * 60),
    resendInSeconds: r.resend_in_seconds,
  };
}

/** The OTP for the session token, already checked here. */
export async function verifyOtp(mobile: string, otp: string, ip: string): Promise<{ token: string; claims: TokenClaims }> {
  const r = await call<{ token: string }>('POST', '/api/auth/otp/verify', {
    body: { client_id: config.CENTRAL_CLIENT_ID, mobileno: mobile, otp, end_user_ip: ip },
  });
  return { token: r.token, claims: await verifyToken(r.token) };
}

// ── The session token ──────────────────────────────────────────────────────

/** Why a token was refused: no session, or a session that ran out. */
export class TokenError extends Error {
  constructor(readonly reason: 'invalid' | 'expired') {
    super(reason === 'expired' ? 'Session expired' : 'Invalid token');
    this.name = 'TokenError';
  }
}

const KEYS_TTL_MS = 60 * 60_000;
let keys = new Map<string, KeyObject>();
let keysAt = 0;

async function publicKey(kid: string | undefined): Promise<KeyObject> {
  const fresh = Date.now() - keysAt < KEYS_TTL_MS;
  // An unknown key id re-reads the set: the service may have rotated its key.
  if (!fresh || !kid || !keys.has(kid)) {
    const { keys: list } = await call<{ keys: (JsonWebKey & { kid?: string })[] }>('GET', '/.well-known/jwks.json', { app: false });
    keys = new Map(list.map((k) => [k.kid ?? '', createPublicKey({ key: k, format: 'jwk' })]));
    keysAt = Date.now();
  }
  const key = keys.get(kid ?? '') ?? (keys.size === 1 && !kid ? [...keys.values()][0] : undefined);
  if (!key) throw new TokenError('invalid');
  return key;
}

const part = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>;

/** Signature (RS256, the service's key), issuer, audience and expiry. */
export async function verifyToken(token: string): Promise<TokenClaims> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new TokenError('invalid');
  let header: Record<string, unknown>;
  let claims: TokenClaims;
  try {
    header = part(h);
    claims = part(p) as unknown as TokenClaims;
  } catch {
    throw new TokenError('invalid');
  }
  if (header.alg !== 'RS256') throw new TokenError('invalid');

  const key = await publicKey(typeof header.kid === 'string' ? header.kid : undefined);
  if (!verifySignature('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) {
    throw new TokenError('invalid');
  }

  const now = Date.now() / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== config.CENTRAL_ISSUER || !audiences.includes(config.CENTRAL_CLIENT_ID) || typeof claims.sub !== 'string') {
    throw new TokenError('invalid');
  }
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) throw new TokenError('invalid');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new TokenError('expired');
  return claims;
}

const ACTIVE_TTL_MS = 60_000;
const active = new Map<string, { active: boolean; at: number }>();

/**
 * Whether the account behind a token is still active and allowed this app.
 * While the service is unreachable a signed, unexpired token is trusted, so
 * an outage there does not sign everyone out here.
 */
export async function stillActive(token: string): Promise<boolean> {
  const hit = active.get(token);
  if (hit && Date.now() - hit.at < ACTIVE_TTL_MS) return hit.active;
  let ok: boolean;
  try {
    ok = !!(await call<{ active: boolean }>('POST', '/api/v1/token/introspect', { body: { token } })).active;
  } catch (err) {
    if (err instanceof AppError && err.code === 'UPSTREAM_TIMEOUT') return hit?.active ?? true;
    throw err;
  }
  if (active.size > 5000) active.clear();
  active.set(token, { active: ok, at: Date.now() });
  return ok;
}

// ── Scope and the warmer ───────────────────────────────────────────────────

const HIERARCHY_TTL_MS = 60 * 60_000;
const hierarchies = new Map<string, { at: number; rows: Promise<HierarchyRow[]> }>();

/** A division's territories with their TM, RM and ZSM — cached an hour. */
export function hierarchy(division: string): Promise<HierarchyRow[]> {
  const hit = hierarchies.get(division);
  if (hit && Date.now() - hit.at < HIERARCHY_TTL_MS) return hit.rows;
  const rows = call<{ rows: HierarchyRow[] }>('GET', `/api/v1/hierarchy?division_code=${encodeURIComponent(division)}`)
    .then((r) => r.rows);
  hierarchies.set(division, { at: Date.now(), rows });
  // A failed read must not be served for an hour.
  rows.catch(() => hierarchies.delete(division));
  return rows;
}

/** Active users of one role, as the service shows them to this app. */
export async function listUsers(usertype: string): Promise<CentralUser[]> {
  const r = await call<{ users: (Omit<CentralUser, 'sub'> & { id: string })[] }>(
    'GET',
    `/api/v1/users?usertype=${encodeURIComponent(usertype)}&limit=2000`,
  );
  return r.users.map(({ id, ...u }) => ({ ...u, sub: id }));
}

/** Clears every cache — for tests. */
export function resetCentralCaches(): void {
  keys = new Map();
  keysAt = 0;
  active.clear();
  hierarchies.clear();
}
