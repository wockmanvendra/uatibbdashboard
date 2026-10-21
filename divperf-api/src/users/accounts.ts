/**
 * Password accounts (dashboard_accounts): BU heads, who are not in Infinity's
 * field structure and sign in with a mobile number and password, as in the
 * D2D portal's staff login. Every state change is one atomic statement, so
 * concurrent sign-ins cannot both slip under the lockout or share a code.
 */
import type { UserRecord } from './repo.js';
import type { OtpCheck } from './repo.js';
import { userDb } from './db.js';

/** A session for an account carries `acct:<uuid>`; a field-force one, an empcode. */
export const ACCOUNT_PREFIX = 'acct:';
/** Wrong passwords before the account locks. (D2D portal: 3) */
export const MAX_PASSWORD_FAILURES = 3;

export interface AccountRow {
  id: string;
  usertype: 'bu-head';
  name: string;
  mobileno: string;
  email: string | null;
  empcode: string | null;
  divisionCodes: string[];
  passwordHash: string;
  passwordChangedAt: Date | null;
  passwordVersion: number;
  failedAttempts: number;
  lockedAt: Date | null;
  isActive: boolean;
}

const COLUMNS = `id, usertype, name, mobileno, email, empcode,
  division_codes AS "divisionCodes", password_hash AS "passwordHash",
  password_changed_at AS "passwordChangedAt", password_version AS "passwordVersion",
  failed_attempts AS "failedAttempts", locked_at AS "lockedAt", is_active AS "isActive"`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An active account by its sign-in mobile. */
export async function findAccountByMobile(mobile: string): Promise<AccountRow | null> {
  const { rows } = await userDb().query<AccountRow>(
    `SELECT ${COLUMNS} FROM dashboard_accounts WHERE mobileno = $1 AND is_active`,
    [mobile],
  );
  return rows[0] ?? null;
}

/** An active account by id — what a session resolves to on every request. */
export async function findAccountById(id: string): Promise<AccountRow | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await userDb().query<AccountRow>(
    `SELECT ${COLUMNS} FROM dashboard_accounts WHERE id = $1 AND is_active`,
    [id],
  );
  return rows[0] ?? null;
}

/** The dashboard user an account signs in as: its divisions, as an NSM sees theirs. */
export function accountUser(a: AccountRow): UserRecord {
  return {
    id: ACCOUNT_PREFIX + a.id,
    usertype: a.usertype,
    name: a.name,
    mobileno: a.mobileno,
    email: a.email,
    scopeLevel: 'DIVISION',
    scopeNodes: a.divisionCodes,
    divisions: a.divisionCodes,
  };
}

/** Counts a wrong password and locks the account on the last allowed one. Returns the new count. */
export async function recordWrongPassword(id: string): Promise<number> {
  const { rows } = await userDb().query<{ n: number }>(
    `UPDATE dashboard_accounts
        SET failed_attempts = failed_attempts + 1,
            locked_at = CASE WHEN failed_attempts + 1 >= $2 THEN NOW() ELSE locked_at END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING failed_attempts AS n`,
    [id, MAX_PASSWORD_FAILURES],
  );
  return rows[0]?.n ?? MAX_PASSWORD_FAILURES;
}

export async function clearWrongPasswords(id: string): Promise<void> {
  await userDb().query(
    `UPDATE dashboard_accounts SET failed_attempts = 0, updated_at = NOW() WHERE id = $1 AND failed_attempts > 0`,
    [id],
  );
}

/**
 * Sets a new password chosen by the user — only if the password is still the
 * version the change token was issued for, so a token works once. Unlocks the
 * account and clears any reset code. Null when the token is spent or stale.
 */
export async function setPassword(id: string, hash: string, version: number): Promise<AccountRow | null> {
  const { rows } = await userDb().query<AccountRow>(
    `UPDATE dashboard_accounts
        SET password_hash = $2, password_changed_at = NOW(), password_version = password_version + 1,
            failed_attempts = 0, locked_at = NULL,
            reset_otp_hash = NULL, reset_otp_expires_at = NULL, reset_otp_attempts = 0,
            updated_at = NOW()
      WHERE id = $1 AND password_version = $3 AND is_active
      RETURNING ${COLUMNS}`,
    [id, hash, version],
  );
  return rows[0] ?? null;
}

/**
 * Stores a forgot-password code unless one was sent within `cooldownSeconds`.
 * Returns the seconds left to wait, or 0 when stored.
 */
export async function storeResetOtp(
  id: string,
  otpHash: string,
  expiryMinutes: number,
  cooldownSeconds: number,
): Promise<number> {
  const { rowCount } = await userDb().query(
    `UPDATE dashboard_accounts
        SET reset_otp_hash = $2, reset_otp_expires_at = NOW() + make_interval(mins => $3),
            reset_otp_sent_at = NOW(), reset_otp_attempts = 0, updated_at = NOW()
      WHERE id = $1
        AND (reset_otp_sent_at IS NULL OR reset_otp_sent_at <= NOW() - make_interval(secs => $4))`,
    [id, otpHash, expiryMinutes, cooldownSeconds],
  );
  if (rowCount === 1) return 0;
  const { rows } = await userDb().query<{ wait: number }>(
    `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM reset_otp_sent_at + make_interval(secs => $2) - NOW())))::int AS wait
       FROM dashboard_accounts WHERE id = $1`,
    [id, cooldownSeconds],
  );
  return rows[0]?.wait ?? cooldownSeconds;
}

/** Checks a forgot-password code; a wrong one uses up an attempt, the right one is spent. */
export async function consumeResetOtp(id: string, otpHash: string, maxAttempts: number): Promise<OtpCheck> {
  const { rowCount } = await userDb().query(
    `UPDATE dashboard_accounts
        SET reset_otp_hash = NULL, reset_otp_expires_at = NULL, reset_otp_attempts = 0, updated_at = NOW()
      WHERE id = $1 AND reset_otp_hash = $2 AND reset_otp_expires_at > NOW() AND reset_otp_attempts < $3`,
    [id, otpHash, maxAttempts],
  );
  if (rowCount === 1) return { result: 'ok' };

  const { rows } = await userDb().query<{ attempts: number }>(
    `UPDATE dashboard_accounts SET reset_otp_attempts = reset_otp_attempts + 1
      WHERE id = $1 AND reset_otp_hash IS NOT NULL AND reset_otp_expires_at > NOW() AND reset_otp_attempts < $2
      RETURNING reset_otp_attempts AS attempts`,
    [id, maxAttempts],
  );
  const attempts = rows[0]?.attempts;
  if (attempts === undefined) {
    const { rows: state } = await userDb().query<{ locked: boolean }>(
      `SELECT (reset_otp_hash IS NOT NULL AND reset_otp_expires_at > NOW()) AS locked FROM dashboard_accounts WHERE id = $1`,
      [id],
    );
    return { result: state[0]?.locked ? 'locked' : 'expired' };
  }
  return attempts >= maxAttempts
    ? { result: 'locked' }
    : { result: 'invalid', attemptsLeft: maxAttempts - attempts };
}

// ---------------------------------------------------------------------------
// Administration — used by tools/accounts.ts (npm run account).

export interface NewAccount {
  name: string;
  mobileno: string;
  email: string | null;
  empcode: string | null;
  divisionCodes: string[];
  passwordHash: string;
}

/** A new BU head account with a temporary password, to be replaced at first sign-in. */
export async function createAccount(a: NewAccount): Promise<AccountRow> {
  const { rows } = await userDb().query<AccountRow>(
    `INSERT INTO dashboard_accounts (usertype, name, mobileno, email, empcode, division_codes, password_hash)
     VALUES ('bu-head', $1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [a.name, a.mobileno, a.email, a.empcode, a.divisionCodes, a.passwordHash],
  );
  return rows[0]!;
}

/** A temporary password set by an administrator: unlocks, and forces a change at next sign-in. */
export async function resetPassword(mobile: string, hash: string): Promise<boolean> {
  const { rowCount } = await userDb().query(
    `UPDATE dashboard_accounts
        SET password_hash = $2, password_changed_at = NULL, password_version = password_version + 1,
            failed_attempts = 0, locked_at = NULL, updated_at = NOW()
      WHERE mobileno = $1`,
    [mobile, hash],
  );
  return rowCount === 1;
}

export async function unlockAccount(mobile: string): Promise<boolean> {
  const { rowCount } = await userDb().query(
    `UPDATE dashboard_accounts SET failed_attempts = 0, locked_at = NULL, updated_at = NOW() WHERE mobileno = $1`,
    [mobile],
  );
  return rowCount === 1;
}

export async function setAccountActive(mobile: string, active: boolean): Promise<boolean> {
  const { rowCount } = await userDb().query(
    `UPDATE dashboard_accounts SET is_active = $2, updated_at = NOW() WHERE mobileno = $1`,
    [mobile, active],
  );
  return rowCount === 1;
}

export async function updateAccount(
  mobile: string,
  changes: { name?: string; email?: string | null; empcode?: string | null; divisionCodes?: string[] },
): Promise<boolean> {
  const { rowCount } = await userDb().query(
    `UPDATE dashboard_accounts
        SET name = COALESCE($2, name),
            email = CASE WHEN $3::boolean THEN $4 ELSE email END,
            empcode = CASE WHEN $5::boolean THEN $6 ELSE empcode END,
            division_codes = COALESCE($7, division_codes),
            updated_at = NOW()
      WHERE mobileno = $1`,
    [
      mobile,
      changes.name ?? null,
      changes.email !== undefined, changes.email ?? null,
      changes.empcode !== undefined, changes.empcode ?? null,
      changes.divisionCodes ?? null,
    ],
  );
  return rowCount === 1;
}

export interface AccountSummary {
  name: string;
  mobileno: string;
  email: string | null;
  divisionCodes: string[];
  isActive: boolean;
  locked: boolean;
  mustChangePassword: boolean;
}

export async function listAccounts(): Promise<AccountSummary[]> {
  const { rows } = await userDb().query<AccountSummary>(
    `SELECT name, mobileno, email, division_codes AS "divisionCodes", is_active AS "isActive",
            locked_at IS NOT NULL AS locked, password_changed_at IS NULL AS "mustChangePassword"
       FROM dashboard_accounts ORDER BY name`,
  );
  return rows;
}
