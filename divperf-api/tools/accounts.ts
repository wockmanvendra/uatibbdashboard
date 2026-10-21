/**
 * Manages BU head password accounts (dashboard_accounts) — the dashboard's
 * stand-in for the D2D portal's "Admin User Details" screen.
 *
 *   npm run account -- add     --name "Name" --mobile 98XXXXXXXX --division 85[,A5] [--email a@b.com] [--empcode 123]
 *   npm run account -- reset   --mobile 98XXXXXXXX     new temporary password; unlocks; forces a change
 *   npm run account -- unlock  --mobile 98XXXXXXXX
 *   npm run account -- disable --mobile 98XXXXXXXX     (enable to restore)
 *   npm run account -- update  --mobile 98XXXXXXXX [--name] [--email] [--empcode] [--division]
 *   npm run account -- list
 *
 * A new or reset account gets a temporary password, printed once; the user must
 * replace it at first sign-in. Give it to them privately.
 */
import { randomInt } from 'node:crypto';
import { closeUserDb } from '../src/users/db.js';
import {
  createAccount, listAccounts, resetPassword, setAccountActive, unlockAccount, updateAccount,
} from '../src/users/accounts.js';
import { hashPassword, passwordProblem } from '../src/services/passwordAuth.js';

const [command, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
for (let i = 0; i < rest.length; i++) {
  const key = rest[i]!;
  if (!key.startsWith('--')) fail(`Unexpected argument "${key}".`);
  flags[key.slice(2)] = rest[i + 1] ?? '';
  i++;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function mobile(): string {
  const m = (flags.mobile ?? '').trim();
  if (!/^[6-9]\d{9}$/.test(m)) fail('--mobile must be a 10-digit Indian mobile number.');
  return m;
}

function divisions(raw: string): string[] {
  const list = raw.split(',').map((d) => d.trim().toUpperCase()).filter(Boolean);
  if (list.length === 0 || !list.every((d) => /^[A-Z0-9]{1,4}$/.test(d))) {
    fail('--division takes one or more division codes, e.g. 85 or 85,A5.');
  }
  return list;
}

function email(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim())) fail('--email does not look like an email address.');
  return raw.trim();
}

/** 12 characters meeting the password rule: one of each class, then a mix. */
function temporaryPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%&*!?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]!);
  while (chars.length < 12) chars.push(all[randomInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  const password = chars.join('');
  if (passwordProblem(password)) return temporaryPassword();
  return password;
}

const done = (ok: boolean, what: string) => {
  if (!ok) fail(`No account with mobile ${flags.mobile}.`);
  console.log(what);
};

try {
  switch (command) {
    case 'add': {
      const name = (flags.name ?? '').trim();
      if (!name) fail('--name is required.');
      if (!flags.division) fail('--division is required.');
      const password = temporaryPassword();
      const a = await createAccount({
        name,
        mobileno: mobile(),
        email: email(flags.email),
        empcode: flags.empcode?.trim() || null,
        divisionCodes: divisions(flags.division),
        passwordHash: await hashPassword(password),
      });
      console.log(`Created BU head account for ${a.name} (${a.mobileno}), divisions ${a.divisionCodes.join(', ')}.`);
      console.log(`Temporary password: ${password}`);
      console.log('They sign in at /login/bu-head and must choose their own password first.');
      break;
    }
    case 'reset': {
      const password = temporaryPassword();
      done(await resetPassword(mobile(), await hashPassword(password)), 'Password reset; account unlocked.');
      console.log(`Temporary password: ${password}`);
      break;
    }
    case 'unlock':
      done(await unlockAccount(mobile()), 'Account unlocked.');
      break;
    case 'disable':
      done(await setAccountActive(mobile(), false), 'Account disabled: it can no longer sign in, and open sessions end within a minute.');
      break;
    case 'enable':
      done(await setAccountActive(mobile(), true), 'Account enabled.');
      break;
    case 'update':
      done(
        await updateAccount(mobile(), {
          name: flags.name?.trim() || undefined,
          email: 'email' in flags ? email(flags.email) : undefined,
          empcode: 'empcode' in flags ? flags.empcode?.trim() || null : undefined,
          divisionCodes: flags.division ? divisions(flags.division) : undefined,
        }),
        'Account updated.',
      );
      break;
    case 'list': {
      const rows = await listAccounts();
      if (rows.length === 0) console.log('No BU head accounts yet.');
      for (const r of rows) {
        const state = [!r.isActive && 'DISABLED', r.locked && 'LOCKED', r.mustChangePassword && 'must change password']
          .filter(Boolean)
          .join(', ');
        console.log(`${r.mobileno}  ${r.name}  divisions ${r.divisionCodes.join(',')}  ${r.email ?? '(no email)'}${state ? `  [${state}]` : ''}`);
      }
      break;
    }
    default:
      fail('Usage: npm run account -- add|reset|unlock|disable|enable|update|list [--flags]. See tools/accounts.ts.');
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/dashboard_accounts_mobileno_key/.test(message)) fail(`An account with mobile ${flags.mobile} already exists.`);
  fail(message);
} finally {
  await closeUserDb();
}
