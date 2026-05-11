import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeHistoryCutoff } from './historyCutoff.js';

describe('computeHistoryCutoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined when neither input is provided', () => {
    expect(computeHistoryCutoff(undefined, undefined)).toBeUndefined();
    expect(computeHistoryCutoff(null, undefined)).toBeUndefined();
  });

  it('derives cutoff from maxAgeSeconds alone', () => {
    const cutoff = computeHistoryCutoff(3600, undefined); // 1h ago
    expect(cutoff).toEqual(new Date('2026-05-10T11:00:00Z'));
  });

  it('uses contextEpoch directly when maxAgeSeconds is missing', () => {
    const epoch = new Date('2026-05-09T00:00:00Z');
    expect(computeHistoryCutoff(undefined, epoch)).toBe(epoch);
  });

  it('returns the more recent (later) cutoff when both are provided', () => {
    // maxAgeSeconds=3600 → 11:00Z; contextEpoch=09:00Z → 11:00Z wins
    const epoch = new Date('2026-05-10T09:00:00Z');
    expect(computeHistoryCutoff(3600, epoch)).toEqual(new Date('2026-05-10T11:00:00Z'));

    // contextEpoch=11:30Z is more recent than maxAgeSeconds=3600 → 11:00Z
    const laterEpoch = new Date('2026-05-10T11:30:00Z');
    expect(computeHistoryCutoff(3600, laterEpoch)).toBe(laterEpoch);
  });

  it('treats null maxAgeSeconds the same as undefined (cascade "off" sentinel)', () => {
    const epoch = new Date('2026-05-09T00:00:00Z');
    expect(computeHistoryCutoff(null, epoch)).toBe(epoch);
  });
});
