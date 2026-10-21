/**
 * Session verification.
 *
 * Every route requires a valid session unless it is listed in PUBLIC_ROUTES, so
 * a newly added route is protected by default. The token carries only who the
 * person is — an employee code (field force) or `acct:<id>` (a BU head's
 * password account); whether they still have access, and what they may see, is
 * read from vw_dashboard_users or dashboard_accounts, never from the token.
 * (§6.2 rule 2) A password-change token is not a session and is refused here.
 */
import jwt from '@fastify/jwt';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { LRUCache } from 'lru-cache';
import { config } from '../config.js';
import { findUserByEmpcode, type UserRecord } from '../users/repo.js';
import { ACCOUNT_PREFIX, accountUser, findAccountById } from '../users/accounts.js';
import { hasTerritory, NO_TERRITORY } from '../services/authService.js';
import { scopeEmpty, unauthorized } from '../lib/errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    /** `scope` set: a password-change token (with the password version `pv`), not a session. */
    payload: { sub: string; scope?: 'change-password'; pv?: number };
    user: { sub: string; scope?: 'change-password'; pv?: number };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    appUser: UserRecord | null;
  }
}

/** Matched against the route pattern, not the raw URL, so path tricks cannot reach it. */
const PUBLIC_ROUTES = new Set([
  '/health',
  '/ready',
  '/api/auth/otp/request',
  '/api/auth/otp/verify',
  '/api/auth/password',
  '/api/auth/password/change',
  '/api/auth/password/forgot',
  '/api/auth/password/forgot/verify',
  // Called by the load pipeline, which has no user session.
  '/api/meta/flush',
]);

function isPublic(req: FastifyRequest): boolean {
  const route = req.routeOptions.url;
  // No matched route: the 404 handler answers, and it reads nothing.
  return route === undefined || PUBLIC_ROUTES.has(route);
}

// Leaving the field structure, or moving within it, takes effect within a
// minute of the next sync, with no new sign-in.
const users = new LRUCache<string, UserRecord>({ max: 5000, ttl: 60_000 });

export function forgetCachedUsers(): void {
  users.clear();
}

/** A field-force person by employee code, or a password account by `acct:<id>`. */
async function findSessionUser(id: string): Promise<UserRecord | null> {
  if (id.startsWith(ACCOUNT_PREFIX)) {
    const account = await findAccountById(id.slice(ACCOUNT_PREFIX.length));
    return account ? accountUser(account) : null;
  }
  return findUserByEmpcode(id);
}

const plugin: FastifyPluginAsync = async (app) => {
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: `${config.SESSION_MAX_HOURS}h` },
  });

  app.decorateRequest('appUser', null);

  app.addHook('onRequest', async (req, reply) => {
    if (isPublic(req)) return;

    // Responses differ per user, so a browser cache must never hand one
    // user's cached tab to the next person who signs in on the same machine.
    reply.header('vary', 'Authorization');

    if (!req.headers.authorization) {
      throw unauthorized('Sign in to view the dashboard.');
    }
    try {
      await req.jwtVerify();
    } catch (err) {
      throw unauthorized('Your session has expired. Sign in again.', err);
    }

    if (req.user.scope) throw unauthorized('Sign in to view the dashboard.');

    const id = req.user.sub;
    let user = users.get(id);
    if (!user) {
      user = (await findSessionUser(id)) ?? undefined;
      if (user) users.set(id, user);
    }
    if (!user) {
      throw unauthorized('Your account no longer has dashboard access. Contact your administrator.');
    }
    if (!hasTerritory(user)) throw scopeEmpty(NO_TERRITORY);
    req.appUser = user;
  });
};

export const authPlugin = fp(plugin, { name: 'auth' });
