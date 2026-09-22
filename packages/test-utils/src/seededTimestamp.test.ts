import { describe, it, expect } from 'vitest';
import { seededTimestamp, FAR_FUTURE_SEED_INDEX } from './seededTimestamp.js';

describe('seededTimestamp', () => {
  it('spaces consecutive indices exactly 1000ms apart', () => {
    expect(seededTimestamp(1).getTime() - seededTimestamp(0).getTime()).toBe(1000);
    expect(seededTimestamp(6).getTime() - seededTimestamp(5).getTime()).toBe(1000);
  });

  it('is deterministic for the same index', () => {
    expect(seededTimestamp(3).getTime()).toBe(seededTimestamp(3).getTime());
  });

  it('places FAR_FUTURE_SEED_INDEX strictly after the index before it', () => {
    expect(seededTimestamp(FAR_FUTURE_SEED_INDEX).getTime()).toBeGreaterThan(
      seededTimestamp(FAR_FUTURE_SEED_INDEX - 1).getTime()
    );
  });
});
