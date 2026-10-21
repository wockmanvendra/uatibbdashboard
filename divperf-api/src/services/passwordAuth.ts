/**
 * Mobile + password sign-in for BU heads (dashboard_accounts), as the D2D
 * portal's staff login does it:
 *
 * - bcrypt hashes; a locked account is refused before the hash is checked;
 * - three wrong passwords lock the account until an administrator unlocks it
 *   (npm run account -- unlock) or the user resets it by "Forgot password";
 * - at first sign-in, and once the password is 90 days old, the user gets a
 *   15-minute token that can only set a new password;
 * - "Forgot password" sends a code by email (and SMS, where configured); the
 *   code is stored hashed, with the same attempt cap and resend wait as the
 *   field-force OTP, and is shown on screen outside production.
 */
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import {
  MAX_PASSWORD_FAILURES,
  accountUser,
  clearWrongPasswords,
  consumeResetOtp,
  findAccountById,
  findAccountByMobile,
  recordWrongPassword,
  setPassword,
  storeResetOtp,
  type AccountRow,
} from '../users/accounts.js';
import { recordLogin, type LoginAttempt, type UserRecord } from '../users/repo.js';
import { deliverOtp } from './otpDelivery.js';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_SECONDS, hashOtp } from './authService.js';
import {
  badRequest,
  forbidden,
  notFound,
  tooManyRequests,
  unauthorized,
  upstreamUnavailable,
} from '../lib/errors.js';

export const BCRYPT_ROUNDS = 10;
export const PASSWORD_MAX_AGE_DAYS = 90;
export const CHANGE_TOKEN_MINUTES = 15;

const NOT_REGISTERED = 'No BU head account is registered for this mobile number.';
const LOCKED = 'Account locked. Contact your administrator to unlock it, or use "Forgot password".';

interface Context {
  log: FastifyBaseLogger;
  ip: string;
}

/** The D2D portal's rule: 8+ characters, upper- and lower-case, a digit and a symbol. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character (e.g. @#$%).';
  return null;
}

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);

function audit(ctx: Context, attempt: Omit<LoginAttempt, 'ip' | 'loginMethod'>): Promise<void> {
  return recordLogin(
    { ...attempt, ip: ctx.ip, loginMethod: 'password' },
    (err) => ctx.log.error({ err }, 'login history write failed'),
  );
}

const who = (a: AccountRow) => ({
  userId: accountUser(a).id,
  name: a.name,
  mobileno: a.mobileno,
  usertype: a.usertype,
});

async function account(mobile: string, ctx: Context): Promise<AccountRow> {
  const a = await findAccountByMobile(mobile);
  if (!a) {
    await audit(ctx, { mobileno: mobile, status: 'failed', failureReason: 'Not registered' });
    throw notFound(NOT_REGISTERED);
  }
  return a;
}

const passwordExpired = (a: AccountRow) =>
  a.passwordChangedAt === null ||
  Date.now() - a.passwordChangedAt.getTime() > PASSWORD_MAX_AGE_DAYS * 86_400_000;

export type PasswordLoginResult =
  | { kind: 'session'; user: UserRecord }
  /** The password must be replaced first: `version` is what a change token may replace. */
  | { kind: 'change'; accountId: string; version: number };

export async function passwordLogin(mobile: string, password: string, ctx: Context): Promise<PasswordLoginResult> {
  const a = await account(mobile, ctx);

  // Before the hash check, so a locked account answers the same either way.
  if (a.lockedAt) {
    await audit(ctx, { ...who(a), status: 'failed', failureReason: 'Account locked' });
    throw forbidden(LOCKED);
  }

  if (!(await bcrypt.compare(password, a.passwordHash))) {
    const failures = await recordWrongPassword(a.id);
    await audit(ctx, { ...who(a), status: 'failed', failureReason: 'Invalid password' });
    if (failures >= MAX_PASSWORD_FAILURES) {
      throw forbidden(`Account locked after ${MAX_PASSWORD_FAILURES} wrong passwords. Contact your administrator, or use "Forgot password".`);
    }
    throw unauthorized(`Incorrect password. ${MAX_PASSWORD_FAILURES - failures} attempt(s) left before the account locks.`);
  }

  await clearWrongPasswords(a.id);
  await audit(ctx, { ...who(a), status: 'success' });

  if (passwordExpired(a)) {
    return { kind: 'change', accountId: a.id, version: a.passwordVersion };
  }
  return { kind: 'session', user: accountUser(a) };
}

/** Sets the password a change token was issued for; the token is spent by it. */
export async function changePassword(
  accountId: string,
  version: number,
  newPassword: string,
  ctx: Context,
): Promise<UserRecord> {
  const problem = passwordProblem(newPassword);
  if (problem) throw badRequest(problem);

  const current = await findAccountById(accountId);
  if (!current) throw unauthorized('This account no longer has dashboard access. Contact your administrator.');
  if (await bcrypt.compare(newPassword, current.passwordHash)) {
    throw badRequest('Choose a password different from the current one.');
  }

  const updated = await setPassword(accountId, await hashPassword(newPassword), version);
  if (!updated) throw unauthorized('This password-change link has been used or has expired. Sign in again.');
  ctx.log.info({ userId: accountUser(updated).id }, 'password changed');
  return accountUser(updated);
}

/** "r***@wockhardt.com" */
const maskEmail = (email: string) => {
  const [local, domain] = email.split('@');
  return `${local?.[0] ?? ''}***@${domain ?? ''}`;
};

export async function requestPasswordReset(
  mobile: string,
  ctx: Context,
): Promise<{ sentTo: string; devOtp?: string }> {
  const a = await account(mobile, ctx);
  const production = config.NODE_ENV === 'production';
  if (!a.email && production) {
    throw badRequest('No email address on file for this account. Contact your administrator.');
  }

  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const userId = accountUser(a).id;
  const wait = await storeResetOtp(a.id, hashOtp(userId, otp), config.OTP_EXPIRY_MINUTES, OTP_RESEND_SECONDS);
  if (wait > 0) throw tooManyRequests(`Wait ${wait}s before requesting another code.`);

  const delivery = await deliverOtp(a, otp, ctx.log);
  if (delivery.attempted > 0 && delivery.sent === 0) {
    throw upstreamUnavailable('We could not send the code right now. Try again in a moment.');
  }
  ctx.log.info({ userId, channels: delivery.sent }, 'password reset code issued');

  return {
    sentTo: a.email ? maskEmail(a.email) : 'your registered contact',
    // No SMS or email outside production is normal; the screen shows the code.
    ...(production ? {} : { devOtp: otp }),
  };
}

/** A correct code buys a change token, as a correct password at first sign-in does. */
export async function verifyPasswordReset(
  mobile: string,
  otp: string,
  ctx: Context,
): Promise<{ accountId: string; version: number }> {
  const a = await account(mobile, ctx);
  const check = await consumeResetOtp(a.id, hashOtp(accountUser(a).id, otp), OTP_MAX_ATTEMPTS);
  switch (check.result) {
    case 'ok':
      return { accountId: a.id, version: a.passwordVersion };
    case 'expired':
      throw unauthorized('Code expired. Request a new one.');
    case 'locked':
      throw tooManyRequests('Too many incorrect attempts. Request a new code.');
    case 'invalid':
      throw unauthorized(`Incorrect code. ${check.attemptsLeft} attempt(s) left.`);
  }
}
