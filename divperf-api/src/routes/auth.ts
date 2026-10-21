/**
 * Field force (OTP):
 *   POST /api/auth/otp/request              — send a one-time password to a registered mobile
 *   POST /api/auth/otp/verify               — exchange it for a session token
 * BU heads (password):
 *   POST /api/auth/password                 — a session, or a token that can only set a new password
 *   POST /api/auth/password/change          — set it with that token; returns a session
 *   POST /api/auth/password/forgot          — a reset code by email (and SMS)
 *   POST /api/auth/password/forgot/verify   — the code buys a change token
 *
 * Rate-limited per IP, as the D2D portal's auth routes are.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type {
  ForgotPasswordResponse, ForgotPasswordVerifyResponse, LoginResponse, OtpRequestResponse,
  PasswordLoginResponse, SessionUser,
} from '../types/api.js';
import type { UserRecord } from '../users/repo.js';
import { OTP_RESEND_SECONDS, requestOtp, verifyOtp } from '../services/authService.js';
import { scopeFor } from '../plugins/scope.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import {
  CHANGE_TOKEN_MINUTES, changePassword, passwordLogin, requestPasswordReset, verifyPasswordReset,
} from '../services/passwordAuth.js';
import { ACCOUNT_PREFIX } from '../users/accounts.js';

const mobile = z.string().trim().regex(/^[6-9]\d{9}$/);
const requestSchema = z.object({ mobile });
const verifySchema = z.object({ mobile, otp: z.string().trim().regex(/^\d{6}$/) });
const passwordSchema = z.object({ mobile, password: z.string().min(1).max(200) });
const changeSchema = z.object({ changeToken: z.string().min(1), newPassword: z.string().min(1).max(200) });

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

  // A token that can only set a new password: short-lived, and good for one
  // password version, so it cannot be replayed once used.
  const changeToken = (accountId: string, version: number) =>
    app.jwt.sign(
      { sub: ACCOUNT_PREFIX + accountId, scope: 'change-password', pv: version },
      { expiresIn: `${CHANGE_TOKEN_MINUTES}m` },
    );

  app.post('/api/auth/password', { config: { rateLimit } }, async (req): Promise<PasswordLoginResponse> => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Enter your 10-digit mobile number and password.');

    const result = await passwordLogin(parsed.data.mobile, parsed.data.password, { log: req.log, ip: req.ip });
    if (result.kind === 'change') {
      return { mustChangePassword: true, changeToken: changeToken(result.accountId, result.version) };
    }
    req.log.info({ userId: result.user.id }, 'signed in');
    return { token: app.jwt.sign({ sub: result.user.id }), user: toSessionUser(result.user) };
  });

  app.post('/api/auth/password/change', { config: { rateLimit } }, async (req): Promise<LoginResponse> => {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Enter a new password.');

    let claims: { sub: string; scope?: string; pv?: number };
    try {
      claims = app.jwt.verify(parsed.data.changeToken);
    } catch (err) {
      throw unauthorized('This password-change link has expired. Sign in again.', err);
    }
    if (claims.scope !== 'change-password' || !claims.sub.startsWith(ACCOUNT_PREFIX) || typeof claims.pv !== 'number') {
      throw unauthorized('This is not a password-change link. Sign in again.');
    }

    const user = await changePassword(
      claims.sub.slice(ACCOUNT_PREFIX.length),
      claims.pv,
      parsed.data.newPassword,
      { log: req.log, ip: req.ip },
    );
    req.log.info({ userId: user.id }, 'signed in');
    return { token: app.jwt.sign({ sub: user.id }), user: toSessionUser(user) };
  });

  app.post('/api/auth/password/forgot', { config: { rateLimit } }, async (req): Promise<ForgotPasswordResponse> => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Enter a valid 10-digit mobile number.');

    const { sentTo, devOtp } = await requestPasswordReset(parsed.data.mobile, { log: req.log, ip: req.ip });
    return {
      sentTo,
      expiresInSeconds: config.OTP_EXPIRY_MINUTES * 60,
      resendInSeconds: OTP_RESEND_SECONDS,
      ...(devOtp ? { devOtp } : {}),
    };
  });

  app.post(
    '/api/auth/password/forgot/verify',
    { config: { rateLimit } },
    async (req): Promise<ForgotPasswordVerifyResponse> => {
      const parsed = verifySchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Enter the 6-digit code.');

      const { accountId, version } = await verifyPasswordReset(parsed.data.mobile, parsed.data.otp, {
        log: req.log,
        ip: req.ip,
      });
      return { changeToken: changeToken(accountId, version) };
    },
  );
};
