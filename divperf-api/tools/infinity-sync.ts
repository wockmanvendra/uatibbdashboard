/**
 * Pulls Infinity's field structure for every division in infinity_division —
 * the source of who may sign in.
 *
 *   npm run infinity:sync                         all divisions
 *   npm run infinity:sync -- --division 85        one division
 *   npm run infinity:sync -- --force              accept a division shrinking by half or more
 *
 * Exits non-zero if any division failed; each failure keeps that division's
 * previous rows. Every run is recorded in infinity_sync_log.
 */
import { userDb, closeUserDb } from '../src/users/db.js';
import { syncDivision, type Division } from '../src/users/infinitySync.js';

const args = process.argv.slice(2);
const only = args.includes('--division') ? args[args.indexOf('--division') + 1] : undefined;
const force = args.includes('--force');

try {
  const { rows: divisions } = await userDb().query<Division>(
    `SELECT division_code AS "divisionCode", infinity_division_code AS "infinityDivisionCode"
       FROM infinity_division ${only ? 'WHERE division_code = $1' : ''} ORDER BY division_code`,
    only ? [only] : [],
  );
  if (divisions.length === 0) {
    throw new Error(only ? `Division ${only} is not in infinity_division.` : 'infinity_division is empty.');
  }

  const client = await userDb().connect();
  const results = [];
  try {
    for (const d of divisions) results.push(await syncDivision(client, d, { force }));
  } finally {
    client.release();
  }

  const { rows: people } = await userDb().query<{ usertype: string; n: number }>(
    'SELECT usertype, COUNT(*)::int AS n FROM vw_dashboard_users GROUP BY usertype ORDER BY n DESC',
  );
  console.table(results);
  console.log('People who can now sign in:', Object.fromEntries(people.map((p) => [p.usertype, p.n])));
  if (results.some((r) => r.status === 'error')) process.exitCode = 1;
} finally {
  await closeUserDb();
}
