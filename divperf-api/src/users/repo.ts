/**
 * Every query against the sign-in database. Who a user is comes from the
 * vw_dashboard_users view (Infinity's field structure); only OTP state and the
 * login audit are stored. Each OTP state change is one atomic statement, so
 * concurrent requests cannot share a code or overrun the attempt cap.
 */
import type { ScopeLevel, UserRole } from '../types/api.js';
import { userDb } from './db.js';

export interface UserRecord {
  /** The Infinity employee code. */
  id: string;
  usertype: UserRole;
  name: string;
  mobileno: string;
  email: string | null;
  scopeLevel: ScopeLevel;
  scopeNodes: string[];
}

const USER_COLUMNS = `empcode AS id, usertype, name, mobileno, email,
  scope_level AS "scopeLevel", scope_nodes AS "scopeNodes"`;

export type MobileLookup =
  | { found: 'one'; user: UserRecord }
  | { found: 'none' }
  /** The field structure lists this number against more than one person. */
  | { found: 'several' };

export async function findUserByMobile(mobileno: string): Promise<MobileLookup> {
  const { rows } = await userDb().query<UserRecord>(
    `SELECT ${USER_COLUMNS} FROM vw_dashboard_users WHERE mobileno = $1 LIMIT 2`,
    [mobileno],
  );
  if (rows.length === 0) return { found: 'none' };
  if (rows.length > 1) return { found: 'several' };
  return { found: 'one', user: rows[0]! };
}

export async function findUserByEmpcode(empcode: string): Promise<UserRecord | null> {
  const { rows } = await userDb().query<UserRecord>(
    `SELECT ${USER_COLUMNS} FROM vw_dashboard_users WHERE empcode = $1`,
    [empcode],
  );
  return rows[0] ?? null;
}

/**
 * Stores a new pending code unless one was sent within `cooldownSeconds`.
 * Returns the seconds left to wait, or 0 when the code was stored.
 */
export async function storeOtp(
  empcode: string,
  otpHash: string,
  expiryMinutes: number,
  cooldownSeconds: number,
): Promise<number> {
  const { rowCount } = await userDb().query(
    `INSERT INTO login_otp (empcode, otp_hash, otp_expires_at, otp_sent_at, otp_attempts)
     VALUES ($1, $2, NOW() + make_interval(mins => $3), NOW(), 0)
     ON CONFLICT (empcode) DO UPDATE
        SET otp_hash = EXCLUDED.otp_hash, otp_expires_at = EXCLUDED.otp_expires_at,
            otp_sent_at = EXCLUDED.otp_sent_at, otp_attempts = 0
      WHERE login_otp.otp_sent_at IS NULL
         OR login_otp.otp_sent_at <= NOW() - make_interval(secs => $4)`,
    [empcode, otpHash, expiryMinutes, cooldownSeconds],
  );
  if (rowCount === 1) return 0;

  const { rows } = await userDb().query<{ wait: number }>(
    `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM otp_sent_at + make_interval(secs => $2) - NOW())))::int AS wait
       FROM login_otp WHERE empcode = $1`,
    [empcode, cooldownSeconds],
  );
  return rows[0]?.wait ?? cooldownSeconds;
}

export type OtpCheck =
  | { result: 'ok' | 'expired' | 'locked' }
  | { result: 'invalid'; attemptsLeft: number };

/**
 * Checks a guess against the pending code. A wrong guess uses up an attempt;
 * the right one clears the code, so it cannot be used twice.
 */
export async function consumeOtp(empcode: string, otpHash: string, maxAttempts: number): Promise<OtpCheck> {
  const { rowCount } = await userDb().query(
    `UPDATE login_otp
        SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, last_login_at = NOW()
      WHERE empcode = $1 AND otp_hash = $2 AND otp_expires_at > NOW() AND otp_attempts < $3`,
    [empcode, otpHash, maxAttempts],
  );
  if (rowCount === 1) return { result: 'ok' };

  // Wrong, expired, or out of attempts. Count the attempt only against a live code.
  const { rows } = await userDb().query<{ attempts: number }>(
    `UPDATE login_otp SET otp_attempts = otp_attempts + 1
      WHERE empcode = $1 AND otp_hash IS NOT NULL AND otp_expires_at > NOW() AND otp_attempts < $2
      RETURNING otp_attempts AS attempts`,
    [empcode, maxAttempts],
  );
  const attempts = rows[0]?.attempts;
  if (attempts === undefined) {
    const { rows: state } = await userDb().query<{ locked: boolean }>(
      `SELECT (otp_hash IS NOT NULL AND otp_expires_at > NOW()) AS locked FROM login_otp WHERE empcode = $1`,
      [empcode],
    );
    return { result: state[0]?.locked ? 'locked' : 'expired' };
  }
  return attempts >= maxAttempts
    ? { result: 'locked' }
    : { result: 'invalid', attemptsLeft: maxAttempts - attempts };
}

export interface LoginAttempt {
  userId?: string | null;
  name?: string | null;
  mobileno: string;
  usertype?: string | null;
  status: 'success' | 'failed';
  failureReason?: string | null;
  ip?: string | null;
}

/** Never throws: a logging failure must not block or mask the sign-in result. */
export async function recordLogin(a: LoginAttempt, onError: (err: unknown) => void): Promise<void> {
  try {
    await userDb().query(
      `INSERT INTO login_history (user_id, name, mobileno, usertype, status, failure_reason, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [a.userId ?? null, a.name ?? null, a.mobileno, a.usertype ?? null, a.status, a.failureReason ?? null, a.ip ?? null],
    );
  } catch (err) {
    onError(err);
  }
}
