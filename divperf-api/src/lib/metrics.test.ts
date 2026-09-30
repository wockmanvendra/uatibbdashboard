import { describe, expect, it } from 'vitest';
import { achBand, achPct, cnPct, grPct, inventory, pcpm, pct, ratio } from './metrics.js';

describe('metrics', () => {
  it('returns null rather than Infinity or NaN on a zero denominator', () => {
    // §11: "A division with zero budget renders —, not Infinity or NaN."
    expect(achPct(100, 0)).toBeNull();
    expect(ratio(1, 0)).toBeNull();
    expect(pct(1, null)).toBeNull();
    expect(pcpm(100, 0, 3)).toBeNull();
    expect(pcpm(100, 10, 0)).toBeNull();
    expect(cnPct(5, 0)).toBeNull();
  });

  it('propagates a null numerator as null', () => {
    expect(achPct(null, 100)).toBeNull();
    expect(grPct(null, 100)).toBeNull();
  });

  it('computes Ach% and CN% as percentages', () => {
    expect(achPct(1_750_000, 2_000_000)).toBeCloseTo(87.5);
    expect(cnPct(82_000, 1_920_000)).toBeCloseTo(4.27, 2);
  });

  it('computes Gr% against the prior-year window', () => {
    expect(grPct(112.3, 100)).toBeCloseTo(12.3);
    expect(grPct(90, 100)).toBeCloseTo(-10);
  });

  it('renders Gr% as null when the prior year has no data', () => {
    // The source is missing 202504–202603 entirely, so this is the normal case
    // for every month of FY26-27.
    expect(grPct(500, null)).toBeNull();
    expect(grPct(500, 0)).toBeNull();
  });

  it('divides PCPM by headcount and then by months', () => {
    expect(pcpm(900_000, 20, 3)).toBeCloseTo(15_000);
    expect(pcpm(900_000, 20, 1)).toBeCloseTo(45_000);
  });

  it('sums inventory as stock + GIT, and only nulls when both are missing', () => {
    expect(inventory(100, 20)).toBe(120);
    expect(inventory(100, null)).toBe(100);
    expect(inventory(null, null)).toBeNull();
  });

  it('bands achievement at the 85 and 100 thresholds', () => {
    expect(achBand(120)).toBe('good');
    expect(achBand(100)).toBe('good');
    expect(achBand(99.9)).toBe('warn');
    expect(achBand(85)).toBe('warn');
    expect(achBand(84.9)).toBe('bad');
    expect(achBand(null)).toBe('none');
  });
});
