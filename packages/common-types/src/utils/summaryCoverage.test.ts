import { describe, it, expect } from 'vitest';
import {
  FLIP_GATE_TARGET,
  SUMMARY_COVERAGE_WINDOW_DAYS,
  summarizedShare,
} from './summaryCoverage.js';

describe('summarizedShare', () => {
  it('returns null on a zero denominator', () => {
    expect(summarizedShare({ retrieved_in_window: 0, done_current: 0 })).toBeNull();
  });

  it('divides done_current by retrieved_in_window', () => {
    expect(summarizedShare({ retrieved_in_window: 200, done_current: 100 })).toBe(0.5);
  });

  it('is BELOW the flip gate at 47/50 (0.94)', () => {
    const share = summarizedShare({ retrieved_in_window: 50, done_current: 47 });
    expect(share).toBe(0.94);
    expect(share).not.toBeNull();
    expect(share as number).toBeLessThan(FLIP_GATE_TARGET);
  });

  it('is exactly at the flip gate (READY) at 95/100', () => {
    const share = summarizedShare({ retrieved_in_window: 100, done_current: 95 });
    expect(share).toBe(FLIP_GATE_TARGET);
    expect(share).not.toBeNull();
    expect(share as number).toBeGreaterThanOrEqual(FLIP_GATE_TARGET);
  });
});

describe('FLIP_GATE_TARGET', () => {
  it('is exactly 0.95', () => {
    expect(FLIP_GATE_TARGET).toBe(0.95);
  });
});

describe('SUMMARY_COVERAGE_WINDOW_DAYS', () => {
  it('is 30', () => {
    expect(SUMMARY_COVERAGE_WINDOW_DAYS).toBe(30);
  });
});
