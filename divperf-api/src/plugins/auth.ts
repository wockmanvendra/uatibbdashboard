/**
 * Session verification.
 *
 * Every route requires a valid session unless it is listed in PUBLIC_ROUTES, so
 * a newly added route is protected by default. The token carries only the
 * person's employee code; whether they are still in the field structure, and
 * what they may see, is read from vw_dashboard_users, never from the token.
 * (§6.2 rule 2)
 */
import jwt from '@fastify/jwt';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { LRUCache } from 'lru-cache';
import { config } from '../config.js';
import { findUserByEmpcode, type UserRecord } from '../users/repo.js';
import { hasTerritory, NO_TERRITORY } from '../services/authService.js';
import { scopeEmpty, unauthorized } from '../lib/errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
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

    const id = req.user.sub;
    let user = users.get(id);
    if (!user) {
      user = (await findUserByEmpcode(id)) ?? undefined;
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
