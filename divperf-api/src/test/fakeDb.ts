/**
 * A stand-in database for data-layer tests: answers each query with the rows
 * of the first route whose pattern matches its SQL, and records every call so
 * a test can check the SQL and parameters it produced.
 */
import type { Db, SqlParams } from '../data/db.js';

export function fakeDb(routes: [RegExp, unknown[]][]) {
  const calls: { sql: string; params: SqlParams }[] = [];
  const answer = (sql: string) => routes.find(([re]) => re.test(sql))?.[1] ?? [];
  const db: Db = {
    all: async <T>(sql: string, params: SqlParams = {}) => {
      calls.push({ sql, params });
      return answer(sql) as T[];
    },
    one: async <T>(sql: string, params: SqlParams = {}) => {
      calls.push({ sql, params });
      return (answer(sql)[0] ?? null) as T | null;
    },
    close: async () => {},
  };
  return { db, calls };
}
