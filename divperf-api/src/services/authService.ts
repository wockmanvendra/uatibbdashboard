/**
 * Mobile + OTP sign-in for the field force listed in Infinity's field structure
 * (vw_dashboard_users) — the D2D portal's TM login flow, with the code stored
 * hashed, a cap on wrong guesses, and the code returned in the response only
 * outside production.
 */
import { createHmac, randomInt } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import {
  consumeOtp,
  findUserByMobile,
  recordLogin,
  storeOtp,
  type LoginAttempt,
  type UserRecord,
} from '../users/repo.js';
import { deliverOtp } from './otpDelivery.js';
import {
  badRequest,
  notFound,
  scopeEmpty,
  tooManyRequests,
  unauthorized,
  upstreamUnavailable,
} from '../lib/errors.js';

export const OTP_RESEND_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 5;

const NOT_REGISTERED = 'This mobile number is not registered for the dashboard.';

interface Context {
  log: FastifyBaseLogger;
  ip: string;
}

/** Keyed on the user as well, so a hash cannot be replayed onto another account. */
export function hashOtp(userId: string, otp: string): string {
  return createHmac('sha256', config.JWT_SECRET).update(`${userId}:${otp}`).digest('hex');
}

/** Never throws, so a failed write cannot block or mask the sign-in result. */
function audit(ctx: Context, attempt: Omit<LoginAttempt, 'ip'>): Promise<void> {
  return recordLogin({ ...attempt, ip: ctx.ip }, (err) => ctx.log.error({ err }, 'login history write failed'));
}

export const NO_TERRITORY =
  'Your territory is not set in Infinity, so there is nothing to show you. Contact your administrator.';

/** Someone listed but with no territory would sign in to an empty dashboard. */
export const hasTerritory = (u: Pick<UserRecord, 'scopeLevel' | 'scopeNodes'>) =>
  u.scopeLevel === 'ALL' || u.scopeNodes.length > 0;

async function registeredUser(mobile: string, ctx: Context): Promise<UserRecord> {
  const lookup = await findUserByMobile(mobile);
  if (lookup.found === 'none') {
    await audit(ctx, { mobileno: mobile, status: 'failed', failureReason: 'Not registered' });
    throw notFound(NOT_REGISTERED);
  }
  if (lookup.found === 'several') {
    await audit(ctx, { mobileno: mobile, status: 'failed', failureReason: 'Mobile shared by several people' });
    throw badRequest(
      'This mobile number is listed against more than one person in Infinity. Contact your administrator.',
    );
  }
  const { user } = lookup;
  if (!hasTerritory(user)) {
    await audit(ctx, { userId: user.id, name: user.name, mobileno: mobile, usertype: user.usertype, status: 'failed', failureReason: 'No territory' });
    throw scopeEmpty(NO_TERRITORY);
  }
  return user;
}

export async function requestOtp(mobile: string, ctx: Context): Promise<{ devOtp?: string }> {
  const user = await registeredUser(mobile, ctx);

  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const wait = await storeOtp(user.id, hashOtp(user.id, otp), config.OTP_EXPIRY_MINUTES, OTP_RESEND_SECONDS);
  if (wait > 0) throw tooManyRequests(`Wait ${wait}s before requesting another OTP.`);

  const delivery = await deliverOtp(user, otp, ctx.log);
  if (delivery.attempted > 0 && delivery.sent === 0) {
    throw upstreamUnavailable('We could not send the OTP right now. Try again in a moment.');
  }
  ctx.log.info({ userId: user.id, channels: delivery.sent }, 'otp issued');

  // No SMS or email outside production is normal; the login screen shows the code.
  return config.NODE_ENV === 'production' ? {} : { devOtp: otp };
}

export async function verifyOtp(mobile: string, otp: string, ctx: Context): Promise<UserRecord> {
  const user = await registeredUser(mobile, ctx);
  const who = { userId: user.id, name: user.name, mobileno: user.mobileno, usertype: user.usertype };

  const check = await consumeOtp(user.id, hashOtp(user.id, otp), OTP_MAX_ATTEMPTS);
  switch (check.result) {
    case 'ok':
      await audit(ctx, { ...who, status: 'success' });
      return user;
    case 'expired':
      await audit(ctx, { ...who, status: 'failed', failureReason: 'OTP expired or not requested' });
      throw unauthorized('OTP expired. Request a new one.');
    case 'locked':
      await audit(ctx, { ...who, status: 'failed', failureReason: 'Too many incorrect attempts' });
      throw tooManyRequests('Too many incorrect attempts. Request a new OTP.');
    case 'invalid':
      await audit(ctx, { ...who, status: 'failed', failureReason: 'Invalid OTP' });
      throw unauthorized(`Incorrect OTP. ${check.attemptsLeft} attempt(s) left.`);
  }
}
