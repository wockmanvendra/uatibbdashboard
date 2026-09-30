import { describe, expect, it } from 'vitest';
import {
  addMonths, fromParts, fyLabel, isClosed, isValidYrMn,
  label, monthCount, monthRange, priorYear,
} from './yrmn.js';

describe('yrmn', () => {
  it('validates month keys', () => {
    expect(isValidYrMn(202608)).toBe(true);
    expect(isValidYrMn(202613)).toBe(false);
    expect(isValidYrMn(202600)).toBe(false);
    expect(isValidYrMn(20260.5)).toBe(false);
  });

  it('rolls over year boundaries in both directions', () => {
    expect(addMonths(202612, 1)).toBe(202701);
    expect(addMonths(202601, -1)).toBe(202512);
    expect(addMonths(202601, -13)).toBe(202412);
    expect(fromParts(2026, 13)).toBe(202701);
    expect(fromParts(2026, 0)).toBe(202512);
  });

  it('takes the prior-year anchor for Gr%', () => {
    expect(priorYear(202608)).toBe(202508);
    expect(priorYear(202601)).toBe(202501);
  });

  it('counts months inclusively, not as a subtraction', () => {
    expect(monthCount(202604, 202608)).toBe(5);
    expect(monthCount(202608, 202608)).toBe(1);
    // The naive `to - from` gives 89 here; the correct answer is 5.
    expect(monthCount(202512, 202604)).toBe(5);
  });

  it('enumerates a range across a year boundary', () => {
    expect(monthRange(202511, 202602)).toEqual([202511, 202512, 202601, 202602]);
  });

  it('labels months the way the Excel report does', () => {
    expect(label(202608)).toBe('Aug-26');
    expect(label(202401)).toBe('Jan-24');
  });

  it('labels fiscal years from April', () => {
    expect(fyLabel(202608)).toBe('FY26-27');
    expect(fyLabel(202603)).toBe('FY25-26');
    expect(fyLabel(202604)).toBe('FY26-27');
  });

  it('treats only months before the open month as closed', () => {
    expect(isClosed(202607, 202608)).toBe(true);
    expect(isClosed(202608, 202608)).toBe(false);
    expect(isClosed(202609, 202608)).toBe(false);
  });
});
