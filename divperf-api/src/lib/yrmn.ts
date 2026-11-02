/**
 * Month arithmetic on YR_MN integers (202508). Mirrored in divperf-web.
 *
 * YR_MN is the month key everywhere (I8). Never derive a month from a date at
 * query time and never pass a date string across the wire.
 *
 * Note: the source view stores YR_MN as nvarchar(24). The load pipeline casts
 * it to int once, on the way in. Downstream everything is an int.
 */

/** Indian pharma fiscal year starts in April. */
export const FY_START_MONTH = 4;

export function isValidYrMn(v: number): boolean {
  if (!Number.isInteger(v)) return false;
  const m = v % 100;
  const y = Math.floor(v / 100);
  return y >= 1990 && y <= 2999 && m >= 1 && m <= 12;
}

export function toParts(yrMn: number): { year: number; month: number } {
  return { year: Math.floor(yrMn / 100), month: yrMn % 100 };
}

export function fromParts(year: number, month: number): number {
  // Normalise month overflow/underflow so callers can pass month 0 or 13.
  const y = year + Math.floor((month - 1) / 12);
  const m = ((((month - 1) % 12) + 12) % 12) + 1;
  return y * 100 + m;
}

export function addMonths(yrMn: number, delta: number): number {
  const { year, month } = toParts(yrMn);
  return fromParts(year, month + delta);
}

export const prevYrMn = (yrMn: number) => addMonths(yrMn, -1);
export const nextYrMn = (yrMn: number) => addMonths(yrMn, 1);

/** The same month one year earlier — the prior-period anchor for Gr%. (§5) */
export const priorYear = (yrMn: number) => addMonths(yrMn, -12);

/** Inclusive count of months in a range. Never `to - from`. (§5) */
export function monthCount(from: number, to: number): number {
  const a = toParts(from);
  const b = toParts(to);
  return (b.year - a.year) * 12 + (b.month - a.month) + 1;
}

/** Every month key in an inclusive range, ascending. */
export function monthRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m = nextYrMn(m)) {
    out.push(m);
    if (out.length > 600) throw new Error(`monthRange too wide: ${from}..${to}`);
  }
  return out;
}

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Aug-26". Two-digit year, matching the Excel report the users already read. */
export function label(yrMn: number): string {
  const { year, month } = toParts(yrMn);
  return `${MONTH_ABBR[month - 1]}-${String(year % 100).padStart(2, '0')}`;
}

/** Fiscal year label for an Apr–Mar year: 202608 -> "FY26-27". */
export function fyLabel(yrMn: number): string {
  const { year, month } = toParts(yrMn);
  const start = month >= FY_START_MONTH ? year : year - 1;
  return `FY${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** A month is closed once it is strictly before the open month. (I7) */
export const isClosed = (yrMn: number, openYrMn: number) => yrMn < openYrMn;

/**
 * The period a dashboard opens on: the fiscal year to date — from the April
 * that starts the open month's fiscal year, to the open month. The API's cache
 * warmer pre-builds exactly this period, so it must match the web's default.
 */
export function defaultPeriod(openYrMn: number): { from: number; to: number } {
  const { year, month } = toParts(openYrMn);
  const fyYear = month >= FY_START_MONTH ? year : year - 1;
  return { from: fromParts(fyYear, FY_START_MONTH), to: openYrMn };
}
