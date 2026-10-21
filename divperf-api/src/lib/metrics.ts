/**
 * Every derived metric in the dashboard, in one place.
 *
 * Per invariant I4 these are computed at read time from additive sums and are
 * never stored. Per §5 every denominator is guarded — a division with zero
 * budget renders an em dash, never Infinity, NaN, or 0.
 *
 * ---------------------------------------------------------------------------
 * DUMMY FORMULAS — pending business confirmation
 * ---------------------------------------------------------------------------
 * Marked `DUMMY:` below. Each is a single expression so swapping it later is a
 * one-line change. Do not spread these rules into panel queries or components.
 *
 *   achPct        target source is BUDGET1 (see ARCHITECTURE.md §4.3). The
 *                 user has not yet supplied the Ach% definition; this uses the
 *                 §5 default of actual / budget * 100.
 *   pcpm          collection ÷ TMs in place (Infinity.vw_emp_count) ÷ months.
 *   rcpa*         RCPA is doctor-related; definition not yet supplied.
 *   secondary     chemist-level (secondary) sales; no source yet.
 *   cn split      Exp CN / SRCN / PD CN arrive as an Excel feed; no source yet.
 *
 * Structurally absent from the source, not merely unconfirmed (see §4.3):
 *
 *   brand-level collection    COLLECTION is customer-grain and carries no
 *                             brand. Proven: rows with a brand have exactly 0
 *                             collection.
 *   geo-level inventory       STOCK and GIT sit only on rows with a null zone;
 *                             they are plant-level. Correct at division and
 *                             brand grain, not at zone/region/HQ.
 *
 * These two cannot be fixed by a better query. They need a new source or a
 * business-defined allocation rule.
 */

/** Safe ratio. Returns null when the denominator is absent, zero, or NaN. */
export function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num === null || num === undefined) return null;
  if (den === null || den === undefined || den === 0) return null;
  const r = num / den;
  return Number.isFinite(r) ? r : null;
}

/** Safe percentage: num / den * 100. */
export function pct(num: number | null | undefined, den: number | null | undefined): number | null {
  const r = ratio(num, den);
  return r === null ? null : r * 100;
}

/**
 * Ach% = actual / target * 100.
 * DUMMY: target column is BUDGET1; the definitive Ach% rule is pending.
 */
export const achPct = (actual: number | null, target: number | null): number | null =>
  pct(actual, target);

/**
 * Gr% = (current - prior) / prior * 100, where prior is the same month range
 * one year earlier. Returns null when the prior window has no data — which is
 * the case for the whole of FY26-27 in the current source (ARCHITECTURE.md
 * §4.3: months 202504–202603 are absent).
 */
export function grPct(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

/**
 * PCPM = total sales / total people / months.
 *
 * The user's definition is "total sales / total people". The Excel adds the
 * month divisor ("Collection / No. of Budgeted TMs / No. of Months") so the
 * figure stays comparable across a multi-month range; `months` defaults to 1
 * to make that divisor explicit at the call site rather than implied.
 *
 * `people` is the TMs in place, from Infinity.vw_emp_count.
 */
export function pcpm(
  sales: number | null,
  people: number | null,
  months: number,
): number | null {
  if (months <= 0) return null;
  const perHead = ratio(sales, people);
  return perHead === null ? null : perHead / months;
}

/** Inventory = stock + GIT. Null only when both are missing. (§5) */
export function inventory(stock: number | null, git: number | null): number | null {
  if (stock === null && git === null) return null;
  return (stock ?? 0) + (git ?? 0);
}

/** CN% = credit notes / gross sales * 100. */
export const cnPct = (crNotes: number | null, grossSales: number | null): number | null =>
  pct(crNotes, grossSales);

/** RCPA as % of secondary — the last column of the geo grids. */
export const rcpaPctToSec = (rcpa: number | null, sec: number | null): number | null =>
  pct(rcpa, sec);

/**
 * Rxber for a period: prescribers per month, averaged over the months that
 * have Rx data. Prescribers are a monthly count of doctors, so summing months
 * would count the same doctor once per month.
 */
export function prescribersPerMonth(prescriberMonths: number | null, monthsWithRx: number): number | null {
  return monthsWithRx > 0 ? ratio(prescriberMonths, monthsWithRx) : null;
}

/**
 * P/D: prescriptions ÷ prescribers. For a month, that month's Rxns ÷ Rxber; for
 * a period, the period's Rxns ÷ its Rxber (prescribers per month).
 */
export const perPrescriber = (rxns: number | null, prescribers: number | null): number | null =>
  ratio(rxns, prescribers);

/**
 * A count per month over a period: doctors on the list, doctors met. Lists are
 * monthly, so summing months would count the same doctor once per month.
 */
export function perMonth(total: number | null, months: number): number | null {
  return months > 0 ? ratio(total, months) : null;
}

/** Call Avg: doctor calls per field day. */
export const callAverage = (calls: number | null, fieldDays: number | null): number | null =>
  ratio(calls, fieldDays);

/**
 * Achievement band for the gap ribbon and value colouring. (§9.1)
 * >= 100 good, 85–99.99 warn, < 85 bad, null when not computable.
 */
export type AchBand = 'good' | 'warn' | 'bad' | 'none';

export function achBand(ach: number | null): AchBand {
  if (ach === null || !Number.isFinite(ach)) return 'none';
  if (ach >= 100) return 'good';
  if (ach >= 85) return 'warn';
  return 'bad';
}

/**
 * Collection sign normalisation.
 *
 * COLLECTION is stored as a credit (negative) in the source: 115,238 negative
 * rows against 1,504 positive. The load pipeline negates it so every measure
 * downstream is a positive magnitude. Kept here so the rule is stated once.
 */
export const normaliseCollection = (raw: number | null): number | null =>
  raw === null ? null : -raw;
