/**
 * Sign-in, through the Central User Service:
 *   POST /api/auth/otp/request   — the service emails a one-time password
 *   POST /api/auth/otp/verify    — exchange it for the service's session token
 *
 * The service decides who may sign in (an active account allowed this app);
 * this API adds what they may see. Rate-limited per IP, as the D2D portal's
 * auth routes are.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type { LoginResponse, OtpRequestResponse, SessionUser } from '../types/api.js';
import { requestOtp, verifyOtp } from '../services/centralAuth.js';
import { hasTerritory, NO_TERRITORY, sessionUser, type UserRecord } from '../users/sessionUser.js';
import { scopeFor } from '../plugins/scope.js';
import { badRequest, scopeEmpty } from '../lib/errors.js';

const mobile = z.string().trim().regex(/^[6-9]\d{9}$/);
const requestSchema = z.object({ mobile });
const verifySchema = z.object({ mobile, otp: z.string().trim().regex(/^\d{6}$/) });

const rateLimit = { max: config.AUTH_RATE_LIMIT, timeWindow: '15 minutes' };

export function toSessionUser(user: UserRecord): SessionUser {
  const scope = scopeFor(user);
  return {
    id: user.id,
    name: user.name,
    role: user.usertype,
    mobile: user.mobileno,
    scopeId: scope.scopeId,
    effectiveScope: { level: scope.level, nodes: scope.nodes },
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/auth/otp/request', { config: { rateLimit } }, async (req): Promise<OtpRequestResponse> => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Enter a valid 10-digit mobile number.');
    return requestOtp(parsed.data.mobile, req.ip);
  });

  app.post('/api/auth/otp/verify', { config: { rateLimit } }, async (req): Promise<LoginResponse> => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Enter the 6-digit OTP.');

    const { token, claims } = await verifyOtp(parsed.data.mobile, parsed.data.otp, req.ip);
    const user = await sessionUser(claims);
    // Signed in to an empty dashboard is worse than told why.
    if (!hasTerritory(user)) throw scopeEmpty(NO_TERRITORY);
    req.log.info({ userId: user.id, role: user.usertype, divisions: user.divisions }, 'signed in');
    return { token, user: toSessionUser(user) };
  });
};
