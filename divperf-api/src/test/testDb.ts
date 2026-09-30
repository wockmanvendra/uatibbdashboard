/**
 * The tests' user database: a throwaway copy on the local PostgreSQL, never the
 * real one. It is truncated freely, so nothing resets a database not named *_test.
 */
export const TEST_USER_DATABASE_URL = 'postgres://postgres@127.0.0.1:5432/sales_dash_user_db_test';

export function assertTestDb(url: string): void {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Refusing to reset a non-test user database: ${name}`);
}
