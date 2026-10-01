/**
 * Scope resolution. (§6)
 *
 * A user's access is a level plus a set of node ids at that level. An RSM and
 * an ASM run identical code and differ only in which nodes they own — roles are
 * never encoded as behaviour.
 *
 * The scope is the signed-in user's scope_level / scope_nodes, which the auth
 * plugin reads from the user database — never from token claims. (§6.2 rule 2)
 *
 * It also carries the user's own divisions. An HQ, region or zone code is not
 * unique across divisions (59 HQ codes recur in the source), so the level's
 * nodes alone would let a TM see another division's figures for the same code.
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
  /** The user's divisions; every query is held to them. Empty means no limit. */
  divisions: string[];
  /** Stable hash of the permitted node set. Mandatory in every cache key. (I6) */
  hash: string;
  /** Identifies the scope in frontend query keys, so switching users misses. */
  scopeId: string;
}

export function makeScope(level: ScopeLevel, nodes: string[], divisions: string[] = []): Scope {
  const sorted = [...nodes].sort();
  // A division-level scope's divisions are its nodes.
  const divs = [...new Set(level === 'DIVISION' ? [...sorted, ...divisions] : divisions)].sort();
  const hash = createHash('sha256')
    .update(`${level}:${sorted.join(',')}|${divs.join(',')}`)
    .digest('hex')
    .slice(0, 16);
  return {
    level,
    nodes: sorted,
    divisions: level === 'ALL' ? [] : divs,
    hash,
    scopeId: `${level.toLowerCase()}-${hash.slice(0, 8)}`,
  };
}

const ALL_SCOPE = makeScope('ALL', []);

export function scopeFor(user: Pick<UserRecord, 'scopeLevel' | 'scopeNodes' | 'divisions'>): Scope {
  return user.scopeLevel === 'ALL'
    ? ALL_SCOPE
    : makeScope(user.scopeLevel, user.scopeNodes, user.divisions ?? []);
}

export type ScopedDimension = 'division' | 'zone' | 'region' | 'hq';

/** Which filter dimension each scope level constrains. */
const LEVEL_DIMENSION: Record<Exclude<ScopeLevel, 'ALL'>, ScopedDimension> = {
  DIVISION: 'division',
  ZONE: 'zone',
  REGION: 'region',
  HQ: 'hq',
};

/**
 * The codes a scope permits on one dimension, or null where it sets no limit.
 * The single definition used by the data layer, the tab service and the filter
 * options, so the three cannot disagree about what a user may see.
 */
export function permittedFor(dimension: ScopedDimension | 'brand', scope: Scope): string[] | null {
  if (scope.level === 'ALL') return null;
  if (dimension === LEVEL_DIMENSION[scope.level]) return scope.nodes;
  if (dimension === 'division' && scope.divisions.length > 0) return scope.divisions;
  return null;
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
