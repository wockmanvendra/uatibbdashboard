import { describe, expect, it } from 'vitest';
import { linearTrend } from './trend';

describe('linearTrend', () => {
  it('returns the line itself for points already on a line', () => {
    expect(linearTrend([10, 20, 30, 40])).toEqual([10, 20, 30, 40]);
  });

  it('fits the least-squares line through scattered points', () => {
    // y = 797 + 52x fits 790, 870, 880, 960 best (Excel's trendline gives the same).
    const t = linearTrend([790, 870, 880, 960]);
    expect(t.map((v) => Math.round(v!))).toEqual([797, 849, 901, 953]);
  });

  it('fits over the months that have a value but draws across all of them', () => {
    expect(linearTrend([null, 10, null, 30])).toEqual([0, 10, 20, 30]);
  });

  it('draws nothing from fewer than two values', () => {
    expect(linearTrend([null, 5, null])).toEqual([null, null, null]);
    expect(linearTrend([])).toEqual([]);
  });
});
