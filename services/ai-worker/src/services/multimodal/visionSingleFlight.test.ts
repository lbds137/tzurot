import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';

const mockTryAcquireInflight = vi.fn();
const mockIsInflight = vi.fn();
const mockReleaseInflight = vi.fn();
const mockCacheGet = vi.fn();

vi.mock('../../redis.js', () => ({
  visionDescriptionCache: {
    tryAcquireInflight: (options: unknown) => mockTryAcquireInflight(options),
    isInflight: (options: unknown) => mockIsInflight(options),
    releaseInflight: (options: unknown) => mockReleaseInflight(options),
    get: (options: unknown) => mockCacheGet(options),
  },
}));

import { enterSingleFlight, exitSingleFlight } from './visionSingleFlight.js';

const attachment = {
  id: 'att-1',
  url: 'https://cdn.example/img.png',
  name: 'img.png',
  contentType: 'image/png',
} as AttachmentMetadata;

const keyOptions = { attachmentId: 'att-1', url: attachment.url };

describe('enterSingleFlight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTryAcquireInflight.mockResolvedValue(true);
    mockIsInflight.mockResolvedValue(false);
    mockReleaseInflight.mockResolvedValue(undefined);
    mockCacheGet.mockResolvedValue(null);
  });

  it('skipCache bypasses acquisition entirely', async () => {
    const entry = await enterSingleFlight(keyOptions, attachment, true);
    expect(entry).toEqual({ acquired: false, coalesced: null });
    expect(mockTryAcquireInflight).not.toHaveBeenCalled();
  });

  it('winner acquires and proceeds without waiting', async () => {
    const entry = await enterSingleFlight(keyOptions, attachment, false);
    expect(entry).toEqual({ acquired: true, coalesced: null });
    expect(mockCacheGet).not.toHaveBeenCalled();
  });

  it('loser coalesces onto the winner cache write', async () => {
    mockTryAcquireInflight.mockResolvedValue(false);
    mockCacheGet.mockResolvedValue('A valid description of the image, long enough to pass');

    const entry = await enterSingleFlight(keyOptions, attachment, false);

    expect(entry.acquired).toBe(false);
    expect(entry.coalesced).toBe('A valid description of the image, long enough to pass');
  });

  it('loser keeps waiting through a SLOW successful winner and coalesces (regression: 45s ceiling < 90s model timeout)', async () => {
    vi.useFakeTimers();
    try {
      mockTryAcquireInflight.mockResolvedValue(false);
      mockIsInflight.mockResolvedValue(true);
      // Winner stores after ~100s of polling — beyond the OLD 45s ceiling,
      // within the vision invoke's own 90s budget plus download/store overhead.
      const start = Date.now();
      mockCacheGet.mockImplementation(() =>
        Promise.resolve(
          Date.now() - start >= 100_000
            ? 'A valid description of the image from a slow winner'
            : null
        )
      );

      const entryPromise = enterSingleFlight(keyOptions, attachment, false);
      await vi.advanceTimersByTimeAsync(101_000);
      const entry = await entryPromise;

      expect(entry.coalesced).toBe('A valid description of the image from a slow winner');
    } finally {
      vi.useRealTimers();
    }
  });

  it('loser falls through at the wait ceiling when the marker never clears (crashed winner)', async () => {
    vi.useFakeTimers();
    try {
      mockTryAcquireInflight.mockResolvedValue(false);
      mockIsInflight.mockResolvedValue(true); // crashed winner: marker held until TTL
      mockCacheGet.mockResolvedValue(null);

      const entryPromise = enterSingleFlight(keyOptions, attachment, false);
      // Past the derived ceiling (VISION_MODEL 90s + 30s margin = 120s).
      await vi.advanceTimersByTimeAsync(125_000);
      const entry = await entryPromise;

      expect(entry).toEqual({ acquired: false, coalesced: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('loser falls through when the winner dies without a cache write', async () => {
    mockTryAcquireInflight.mockResolvedValue(false);
    mockCacheGet.mockResolvedValue(null);
    mockIsInflight.mockResolvedValue(false); // marker gone → winner failed

    const entry = await enterSingleFlight(keyOptions, attachment, false);

    expect(entry).toEqual({ acquired: false, coalesced: null });
  });
});

describe('exitSingleFlight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReleaseInflight.mockResolvedValue(undefined);
  });

  it('releases only when this caller owns the marker', async () => {
    await exitSingleFlight({ acquired: true, coalesced: null }, keyOptions);
    expect(mockReleaseInflight).toHaveBeenCalledTimes(1);
  });

  it('never releases for a non-owner (fallen-through loser)', async () => {
    await exitSingleFlight({ acquired: false, coalesced: null }, keyOptions);
    expect(mockReleaseInflight).not.toHaveBeenCalled();
  });
});
