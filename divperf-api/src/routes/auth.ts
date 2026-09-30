/**
 * POST /api/auth/otp/request  — send a one-time password to a registered mobile
 * POST /api/auth/otp/verify   — exchange it for a session token
 *
 * Rate-limited per IP, as the D2D portal's auth routes are.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type { LoginResponse, OtpRequestResponse, SessionUser } from '../types/api.js';
import type { UserRecord } from '../users/repo.js';
import { OTP_RESEND_SECONDS, requestOtp, verifyOtp } from '../services/authService.js';
import { scopeFor } from '../plugins/scope.js';
import { badRequest } from '../lib/errors.js';

const mobile = z.string().trim().regex(/^[6-9]\d{9}$/);
const requestSchema = z.object({ mobile });
const verifySchema = z.object({ mobile, otp: z.string().trim().regex(/^\d{6}$/) });

const rateLimit = { max: config.AUTH_RATE_LIMIT, timeWindow: '15 minutes' };

function toSessionUser(user: UserRecord): SessionUser {
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

    const { devOtp } = await requestOtp(parsed.data.mobile, { log: req.log, ip: req.ip });
    return {
      expiresInSeconds: config.OTP_EXPIRY_MINUTES * 60,
      resendInSeconds: OTP_RESEND_SECONDS,
      ...(devOtp ? { devOtp } : {}),
    };
  });

  app.post('/api/auth/otp/verify', { config: { rateLimit } }, async (req): Promise<LoginResponse> => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Enter the 6-digit OTP.');

    const user = await verifyOtp(parsed.data.mobile, parsed.data.otp, { log: req.log, ip: req.ip });
    req.log.info({ userId: user.id }, 'signed in');
    return { token: app.jwt.sign({ sub: user.id }), user: toSessionUser(user) };
  });
};
