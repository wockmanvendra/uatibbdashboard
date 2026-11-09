/**
 * Session verification.
 *
 * Every route requires a valid session unless it is listed in PUBLIC_ROUTES, so
 * a newly added route is protected by default.
 *
 * The session is the Central User Service's token ("Authorization: Bearer").
 * Each request checks its signature, issuer, audience and expiry against the
 * service's public key, confirms the account is still active, and works out
 * what the person may see from the service's field hierarchy
 * (users/sessionUser.ts) — never from anything the browser sends. (§6.2 rule 2)
 * The browser only picks which of the token's roles to view as (X-Dashboard-Role);
 * a role the token does not list is ignored.
 * The result is cached a minute per token, so a deactivation or a move in the
 * field structure takes effect within that.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { LRUCache } from 'lru-cache';
import { stillActive, TokenError, verifyToken } from '../services/centralAuth.js';
import { hasTerritory, NO_TERRITORY, sessionUser, type UserRecord } from '../users/sessionUser.js';
import { scopeEmpty, unauthorized } from '../lib/errors.js';

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

const sessions = new LRUCache<string, UserRecord>({ max: 5000, ttl: 60_000 });

export function forgetCachedUsers(): void {
  sessions.clear();
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('appUser', null);

  app.addHook('onRequest', async (req, reply) => {
    if (isPublic(req)) return;

    // Responses differ per user, so a browser cache must never hand one
    // user's cached tab to the next person who signs in on the same machine.
    reply.header('vary', 'Authorization, X-Dashboard-Role');

    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw unauthorized('Sign in to view the dashboard.');
    const token = header.slice(7).trim();

    const asked = req.headers['x-dashboard-role'];
    const roleKey = typeof asked === 'string' && asked.length <= 80 ? asked.trim() : null;
    const sessionKey = `${token}|${roleKey ?? ''}`;

    let user = sessions.get(sessionKey);
    if (!user) {
      let claims;
      try {
        claims = await verifyToken(token);
      } catch (err) {
        if (err instanceof TokenError) throw unauthorized('Your session has expired. Sign in again.', err);
        throw err;
      }
      if (!(await stillActive(token))) {
        throw unauthorized('Your account no longer has dashboard access. Contact your administrator.');
      }
      user = await sessionUser(claims, roleKey);
      sessions.set(sessionKey, user);
    }
    if (!hasTerritory(user)) throw scopeEmpty(NO_TERRITORY);
    req.appUser = user;
  });
};

export const authPlugin = fp(plugin, { name: 'auth' });
