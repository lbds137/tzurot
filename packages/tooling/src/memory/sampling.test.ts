import { describe, it, expect } from 'vitest';
import { pickEvenlySpaced } from './sampling.js';

describe('pickEvenlySpaced', () => {
  it('returns the quota count, evenly spread across the pool', () => {
    const pool = Array.from({ length: 8 }, (_, i) => i);
    const picked = pickEvenlySpaced(pool, 4, 4);
    expect(picked).toHaveLength(4);
    // Even spacing across 4 buckets of 2 → first element of each bucket.
    expect(picked).toEqual([0, 2, 4, 6]);
  });

  it('caps at pool size when quota exceeds it', () => {
    expect(pickEvenlySpaced([1, 2, 3], 10, 8)).toHaveLength(3);
  });

  it('returns empty for zero quota or empty pool', () => {
    expect(pickEvenlySpaced([1, 2, 3], 0, 4)).toEqual([]);
    expect(pickEvenlySpaced([], 5, 4)).toEqual([]);
  });

  it('is deterministic (same input → same output)', () => {
    const pool = Array.from({ length: 20 }, (_, i) => i);
    expect(pickEvenlySpaced(pool, 5, 8)).toEqual(pickEvenlySpaced(pool, 5, 8));
  });
});
