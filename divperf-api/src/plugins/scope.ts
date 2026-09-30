/**
 * Scope resolution. (§6)
 *
 * A user's access is a level plus a set of node ids at that level. An RSM and
 * an ASM run identical code and differ only in which nodes they own — roles are
 * never encoded as behaviour.
 *
 * The scope is the signed-in user's scope_level / scope_nodes, which the auth
 * plugin reads from the user database — never from token claims. (§6.2 rule 2)
 */
import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { ScopeLevel } from '../types/api.js';
import type { UserRecord } from '../users/repo.js';

export interface Scope {
  level: ScopeLevel;
  /** Permitted node codes at `level`. Empty at level ALL means "everything". */
  nodes: string[];
  /** Stable hash of the permitted node set. Mandatory in every cache key. (I6) */
  hash: string;
  /** Identifies the scope in frontend query keys, so switching users misses. */
  scopeId: string;
}

export function makeScope(level: ScopeLevel, nodes: string[]): Scope {
  const sorted = [...nodes].sort();
  const hash = createHash('sha256')
    .update(`${level}:${sorted.join(',')}`)
    .digest('hex')
    .slice(0, 16);
  return { level, nodes: sorted, hash, scopeId: `${level.toLowerCase()}-${hash.slice(0, 8)}` };
}

const ALL_SCOPE = makeScope('ALL', []);

export function scopeFor(user: Pick<UserRecord, 'scopeLevel' | 'scopeNodes'>): Scope {
  return user.scopeLevel === 'ALL' ? ALL_SCOPE : makeScope(user.scopeLevel, user.scopeNodes);
}

/**
 * Intersect a requested filter with the permitted node set.
 *
 * Per §6.2 rule 6 the request is narrowed, not rejected: a ZSM asking for "all
 * regions" gets their regions. A request can never widen its own scope through
 * any parameter.
 */
export function intersectScope(requested: string[], permitted: string[]): string[] {
  if (permitted.length === 0) return requested; // ALL scope
  if (requested.length === 0) return permitted;
  const allowed = new Set(permitted);
  return requested.filter((r) => allowed.has(r));
}

declare module 'fastify' {
  interface FastifyRequest {
    scope: Scope;
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('scope', null as unknown as Scope);

  // Public routes have no user and are left without a scope, so a route that
  // reads one without being protected fails loudly instead of seeing everything.
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (req.appUser) req.scope = scopeFor(req.appUser);
  });
};

export const scopePlugin = fp(plugin, { name: 'scope', dependencies: ['auth'] });
