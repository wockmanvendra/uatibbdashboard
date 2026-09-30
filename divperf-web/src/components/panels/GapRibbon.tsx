/**
 * The signature element. (§9.4)
 *
 * A 4px band under a KPI value showing achievement as a filled proportion, with
 * a 1px notch at the 100% position.
 *
 *   Coll   17.50 L
 *          ████████████████████▏          │
 *          ↑ filled to Ach%              ↑ 100% notch
 *
 * Why this and not a percentage badge: a manager scanning the Division tab has
 * to read eight numbers and compare each to its target. The ribbon makes that a
 * single glance — the gaps line up spatially and the eye finds the short bar
 * without reading any digits.
 *
 * The scale is fixed at 0–125% so that bars are comparable ACROSS panels. A
 * per-bar scale would defeat the entire point of the element.
 */
import { achBand, BAND_VAR, percent } from '../../lib/format';

/** The notch sits at 100/SCALE_MAX of the track width. */
const SCALE_MAX = 125;

interface GapRibbonProps {
  /** Achievement percentage. 87.5 means 87.5%. Null renders an empty track. */
  ach: number | null | undefined;
  /** Accessible name, e.g. "Collection achievement". */
  label: string;
}

export function GapRibbon({ ach, label }: GapRibbonProps) {
  const band = achBand(ach);
  const value = ach ?? 0;
  const filled = Math.max(0, Math.min(value, SCALE_MAX));
  const widthPct = (filled / SCALE_MAX) * 100;
  const notchPct = (100 / SCALE_MAX) * 100;
  const overflowed = value > SCALE_MAX;

  return (
    <div
      className="relative mt-2 h-1 w-full overflow-hidden rounded-sm bg-track"
      role="meter"
      aria-label={label}
      aria-valuenow={ach ?? undefined}
      aria-valuemin={0}
      aria-valuetext={ach === null || ach === undefined ? 'Not available' : percent(ach)}
      title={ach === null || ach === undefined ? 'Not available' : `${percent(ach)} of target`}
    >
      {ach !== null && ach !== undefined && (
        <div
          className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-300"
          style={{ width: `${widthPct}%`, background: BAND_VAR[band] }}
        />
      )}

      {/* The 100% reference. Without it the fill is a bar, not a comparison. */}
      <div
        className="absolute inset-y-0 w-px bg-notch"
        style={{ left: `${notchPct}%` }}
        aria-hidden="true"
      />

      {/* Achievement past the top of the scale still has to read as "past it". */}
      {overflowed && (
        <div
          className="absolute inset-y-0 right-0 w-1"
          style={{ background: BAND_VAR.good }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
