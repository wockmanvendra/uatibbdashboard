/**
 * Number formatting, Indian conventions. (§9.5)
 *
 * This is an Indian pharma division, so grouping is lakh/crore (17,50,000) and
 * KPI values abbreviate to L / Cr. Rounding happens here at render time — the
 * API returns full precision.
 */

/** The em dash used for every null. Never `0`, never `N/A`. (§9.5) */
export const EM_DASH = '—';

const LAKH = 100_000;
const CRORE = 10_000_000;

/** Indian digit grouping: 1,75,00,000 rather than 17,500,000. */
export function groupIndian(n: number, fractionDigits = 0): string {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Abbreviated money for KPI tiles: "17.50 L", "1.24 Cr".
 * Full precision belongs in the tooltip, not the tile.
 */
export function money(n: number | null | undefined, opts: { decimals?: number } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH;
  const d = opts.decimals ?? 2;
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : ''; // U+2212, not a hyphen — it aligns with digits
  if (abs >= CRORE) return `${sign}${groupIndian(abs / CRORE, d)} Cr`;
  if (abs >= LAKH) return `${sign}${groupIndian(abs / LAKH, d)} L`;
  return `${sign}${groupIndian(abs, 0)}`;
}

/**
 * Rupees in lakhs, as the report states them under "(₹ L)" headers: "340.0".
 * Tables use one decimal throughout.
 */
export function lakhs(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH;
  const sign = n < 0 ? '−' : '';
  return `${sign}${groupIndian(Math.abs(n) / LAKH, decimals)}`;
}

/** KPI tiles and summary tables: whole lakhs from 100 L ("5,439"), one decimal below ("9.7"). */
export function lakhsAuto(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH;
  return lakhs(n, Math.abs(n) / LAKH >= 100 ? 0 : 1);
}

/** Chart axis ticks in lakhs, one decimal: "1,000.0". */
export function axisLakhs(n: number): string {
  return lakhs(n, 1);
}

/** Full-precision money for tooltips and table exports: "₹17,50,000.00". */
export function moneyFull(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH;
  const sign = n < 0 ? '−' : '';
  return `${sign}₹${groupIndian(Math.abs(n), 2)}`;
}

/** Plain count: "420". */
export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH;
  return groupIndian(n, 0);
}

/** Percentage, one decimal: "87.5%". */
export function percent(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH;
  return `${n.toFixed(decimals)}%`;
}

/**
 * Growth percentage — always signed, so the direction reads without comparing
 * against a neighbour: "+12.3%", "−4.1%".
 */
export function growth(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(decimals)}%`;
}

/** Colour class for a growth figure. Negative is --bad, with a minus sign. */
export function growthClass(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'text-ink-3';
  if (n > 0) return 'text-good';
  if (n < 0) return 'text-bad';
  return 'text-ink-2';
}

/** Achievement band, mirroring the API's thresholds. (§9.1) */
export type AchBand = 'good' | 'warn' | 'bad' | 'none';

export function achBand(ach: number | null | undefined): AchBand {
  if (ach === null || ach === undefined || !Number.isFinite(ach)) return 'none';
  if (ach >= 100) return 'good';
  if (ach >= 85) return 'warn';
  return 'bad';
}

export const BAND_VAR: Record<AchBand, string> = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  none: 'var(--rule)',
};

export const BAND_TEXT: Record<AchBand, string> = {
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  none: 'text-ink-3',
};

/**
 * Axis tick formatter for money on a chart. Charts need a shorter form than
 * KPI tiles — "1.2 Cr", not "1.24 Cr".
 */
export function axisMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= CRORE) return `${sign}${(abs / CRORE).toFixed(1)} Cr`;
  if (abs >= LAKH) return `${sign}${(abs / LAKH).toFixed(0)} L`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(0)}k`;
  return `${sign}${abs.toFixed(0)}`;
}
