/**
 * Query parameters shared by the routes that take the dashboard's filters:
 * the period and the hierarchy selections.
 */
import { z } from 'zod';
import { canonicalDivisionCode } from '../config.js';
import { badRequest } from '../lib/errors.js';
import { isValidYrMn, monthCount } from '../lib/yrmn.js';

/** Repeated query params arrive as a string or an array of strings. */
export const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return [];
    const raw = Array.isArray(v) ? v : [v];
    // Also accept a single comma-separated value, which is what a URL built by
    // hand usually looks like.
    return [...new Set(raw.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean))];
  });

/** Division codes; an alias (84) means its division (02), so old links still work. */
export const divisionList = list.transform((codes) => [...new Set(codes.map(canonicalDivisionCode))]);

/** The period and the filter selections. */
export const filterQuery = z.object({
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  division: divisionList,
  brand: list,
  zone: list,
  region: list,
  hq: list,
});

export const MAX_MONTHS = 36;

/** Parses with `schema`, turning the first problem into a 400 the user can read. */
export function parseQuery<S extends z.ZodTypeAny>(schema: S, query: unknown): z.infer<S> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(
      `Invalid ${first?.path.join('.') ?? 'request'}: ${first?.message ?? 'check the parameters'}.`,
    );
  }
  return parsed.data;
}

/** A real month range, oldest first, no longer than MAX_MONTHS. */
export function checkPeriod({ from, to }: { from: number; to: number }): void {
  if (!isValidYrMn(from) || !isValidYrMn(to)) {
    throw badRequest('Period must be a month key such as 202608 (YYYYMM).');
  }
  if (to < from) {
    throw badRequest('Period "to" cannot be earlier than "from".');
  }
  const span = monthCount(from, to);
  if (span > MAX_MONTHS) {
    throw badRequest(`Period is ${span} months. Select ${MAX_MONTHS} months or fewer.`);
  }
}
