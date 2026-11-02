import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DenylistCache } from './DenylistCache.js';
import { getServiceClient } from '../utils/gatewayClients.js';

// hydrate() mints a ServiceClient internally and reads getDenylistCache().
const mockGetDenylistCache = vi.hoisted(() => vi.fn());
vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: vi.fn(() => ({ getDenylistCache: mockGetDenylistCache })),
}));

// Mock logger
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('DenylistCache', () => {
  let cache: DenylistCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDenylistCache.mockReset();
    vi.mocked(getServiceClient).mockReturnValue({
      getDenylistCache: mockGetDenylistCache,
    } as unknown as ReturnType<typeof getServiceClient>);
    cache = new DenylistCache();
  });

  afterEach(() => {
    cache.stop();
    vi.useRealTimers();
  });

  describe('hydrate', () => {
    it('should populate cache from gateway response', async () => {
      mockGetDenylistCache.mockResolvedValue({
        ok: true,
        data: {
          entries: [
            { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
            { type: 'GUILD', discordId: 'guild1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
            { type: 'USER', discordId: 'user2', scope: 'CHANNEL', scopeId: 'chan1', mode: 'BLOCK' },
            {
              type: 'USER',
              discordId: 'user3',
              scope: 'PERSONALITY',
              scopeId: 'pers1',
              mode: 'MUTE',
            },
          ],
        },
      });

      await cache.hydrate();

      expect(cache.isBotDenied('user1')).toBe(true);
      expect(cache.isBotDenied('', 'guild1')).toBe(true);
      expect(cache.isChannelDenied('user2', 'chan1', null)).toBe(true);
      expect(cache.isPersonalityDenied('user3', 'pers1')).toBe(true);
    });

    it('should default mode to BLOCK for entries without mode', async () => {
      mockGetDenylistCache.mockResolvedValue({
        ok: true,
        data: {
          entries: [{ type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*' }],
        },
      });

      await cache.hydrate();

      expect(cache.isBotDenied('user1')).toBe(true);
      expect(cache.isBlocked('user1')).toBe(true);
    });

    it('should start with empty cache on hydration failure', async () => {
      mockGetDenylistCache.mockRejectedValue(new Error('Network error'));

      await cache.hydrate();

      expect(cache.isBotDenied('user1')).toBe(false);
    });
  });

  describe('hydrate retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('recovers from a failed first hydrate without a restart', async () => {
      mockGetDenylistCache
        .mockRejectedValueOnce(new Error('Gateway ECONNREFUSED'))
        .mockResolvedValueOnce({
          ok: true,
          data: {
            entries: [
              { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
            ],
          },
        });

      await expect(cache.hydrate()).resolves.toBe(false);
      expect(cache.isBotDenied('user1')).toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(cache.isBotDenied('user1')).toBe(true);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);
    });

    it('recovers when the first hydrate returns a non-ok gateway response', async () => {
      mockGetDenylistCache
        .mockResolvedValueOnce({ ok: false, status: 503, error: 'x' })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            entries: [
              { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
            ],
          },
        });

      await expect(cache.hydrate()).resolves.toBe(false);
      expect(cache.isBotDenied('user1')).toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(cache.isBotDenied('user1')).toBe(true);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);
    });

    it('doubles the retry delay up to the 60s cap when attempts keep rejecting', async () => {
      mockGetDenylistCache.mockRejectedValue(new Error('Gateway down'));

      await expect(cache.hydrate()).resolves.toBe(false);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(4);

      await vi.advanceTimersByTimeAsync(40_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(5);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(6);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(7);
    });

    it('stops retrying once an attempt succeeds', async () => {
      mockGetDenylistCache.mockRejectedValueOnce(new Error('Gateway down')).mockResolvedValueOnce({
        ok: true,
        data: { entries: [] },
      });

      await expect(cache.hydrate()).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);
    });

    it('cancels a pending retry when stop() is called', async () => {
      mockGetDenylistCache.mockRejectedValue(new Error('Gateway down'));

      await expect(cache.hydrate()).resolves.toBe(false);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(1);

      cache.stop();

      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(1);
    });

    it('does not schedule a retry when stop() is called while an attempt is in flight', async () => {
      let rejectAttempt!: (reason?: unknown) => void;
      mockGetDenylistCache.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectAttempt = reject;
          })
      );

      const hydratePromise = cache.hydrate();
      cache.stop();
      rejectAttempt(new Error('Gateway down'));

      await expect(hydratePromise).resolves.toBe(false);

      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(1);
    });

    it('keeps current entries on a failed re-hydrate and replaces them when the retry succeeds', async () => {
      mockGetDenylistCache
        .mockResolvedValueOnce({
          ok: true,
          data: {
            entries: [
              { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
            ],
          },
        })
        .mockRejectedValueOnce(new Error('Transient failure'))
        .mockResolvedValueOnce({
          ok: true,
          data: {
            entries: [
              { type: 'USER', discordId: 'user2', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
            ],
          },
        });

      await expect(cache.hydrate()).resolves.toBe(true);
      expect(cache.isBotDenied('user1')).toBe(true);

      await expect(cache.hydrate()).resolves.toBe(false);
      expect(cache.isBotDenied('user1')).toBe(true);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(cache.isBotDenied('user1')).toBe(false);
      expect(cache.isBotDenied('user2')).toBe(true);
    });

    it('cancels a pending retry timer when hydrate() is called again', async () => {
      mockGetDenylistCache.mockRejectedValueOnce(new Error('Gateway down')).mockResolvedValueOnce({
        ok: true,
        data: { entries: [] },
      });

      await expect(cache.hydrate()).resolves.toBe(false);
      await expect(cache.hydrate()).resolves.toBe(true);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);
    });

    it('resets the retry delay after a successful hydrate', async () => {
      mockGetDenylistCache
        .mockRejectedValueOnce(new Error('Boot failure'))
        .mockResolvedValueOnce({
          ok: true,
          data: { entries: [] },
        })
        .mockRejectedValueOnce(new Error('Reload failure'))
        .mockResolvedValueOnce({
          ok: true,
          data: { entries: [] },
        });

      await expect(cache.hydrate()).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);

      await expect(cache.hydrate()).resolves.toBe(false);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(1);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(4);
    });

    it('an older attempt failing after a newer one also fails leaves one retry', async () => {
      let rejectA!: (reason?: unknown) => void;
      let rejectB!: (reason?: unknown) => void;
      mockGetDenylistCache
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectA = reject;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectB = reject;
            })
        )
        .mockResolvedValue({
          ok: true,
          data: { entries: [] },
        });

      const attemptA = cache.hydrate();
      const attemptB = cache.hydrate();

      rejectA(new Error('Attempt A failed'));
      rejectB(new Error('Attempt B failed'));

      await expect(attemptA).resolves.toBe(false);
      await expect(attemptB).resolves.toBe(false);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(3);
    });

    it('a superseded failure arriving last schedules nothing extra', async () => {
      let rejectA!: (reason?: unknown) => void;
      let rejectB!: (reason?: unknown) => void;
      mockGetDenylistCache
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectA = reject;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectB = reject;
            })
        )
        .mockResolvedValue({
          ok: true,
          data: { entries: [] },
        });

      const attemptA = cache.hydrate();
      const attemptB = cache.hydrate();

      rejectB(new Error('Attempt B failed'));
      await expect(attemptB).resolves.toBe(false);

      rejectA(new Error('Attempt A failed'));
      await expect(attemptA).resolves.toBe(false);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(3);
    });

    it('an older snapshot arriving after a newer one is ignored', async () => {
      let resolveA!: (value: unknown) => void;
      mockGetDenylistCache
        .mockImplementationOnce(
          () =>
            new Promise(resolve => {
              resolveA = resolve;
            })
        )
        .mockResolvedValueOnce({
          ok: true,
          data: {
            entries: [
              { type: 'USER', discordId: 'user2', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
            ],
          },
        });

      const attemptA = cache.hydrate();
      const attemptB = cache.hydrate();

      await expect(attemptB).resolves.toBe(true);

      resolveA({
        ok: true,
        data: {
          entries: [
            { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
          ],
        },
      });

      await expect(attemptA).resolves.toBe(false);
      expect(cache.isBotDenied('user2')).toBe(true);
      expect(cache.isBotDenied('user1')).toBe(false);
    });

    it('an older failure after a newer success schedules no retry', async () => {
      let rejectA!: (reason?: unknown) => void;
      mockGetDenylistCache
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectA = reject;
            })
        )
        .mockResolvedValueOnce({
          ok: true,
          data: { entries: [] },
        });

      const attemptA = cache.hydrate();
      const attemptB = cache.hydrate();

      await expect(attemptB).resolves.toBe(true);

      rejectA(new Error('Attempt A failed'));
      await expect(attemptA).resolves.toBe(false);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(2);

      mockGetDenylistCache
        .mockRejectedValueOnce(new Error('Subsequent failure'))
        .mockResolvedValueOnce({
          ok: true,
          data: { entries: [] },
        });

      await expect(cache.hydrate()).resolves.toBe(false);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(1);
      expect(mockGetDenylistCache).toHaveBeenCalledTimes(4);
    });

    it('an add event during a hydrate survives the snapshot', async () => {
      let resolveAttempt!: (value: unknown) => void;
      mockGetDenylistCache.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveAttempt = resolve;
          })
      );

      const hydratePromise = cache.hydrate();

      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user2', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });

      resolveAttempt({
        ok: true,
        data: {
          entries: [
            { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
          ],
        },
      });

      await expect(hydratePromise).resolves.toBe(true);
      expect(cache.isBotDenied('user1')).toBe(true);
      expect(cache.isBotDenied('user2')).toBe(true);
    });

    it('a remove event during a hydrate survives the snapshot', async () => {
      let resolveAttempt!: (value: unknown) => void;
      mockGetDenylistCache.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveAttempt = resolve;
          })
      );

      const hydratePromise = cache.hydrate();

      cache.handleEvent({
        type: 'remove',
        entry: { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });

      resolveAttempt({
        ok: true,
        data: {
          entries: [
            { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
          ],
        },
      });

      await expect(hydratePromise).resolves.toBe(true);
      expect(cache.isBotDenied('user1')).toBe(false);
    });

    it('events replay in arrival order', async () => {
      let resolveAttempt!: (value: unknown) => void;
      mockGetDenylistCache.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveAttempt = resolve;
          })
      );

      const hydratePromise = cache.hydrate();

      const entry = {
        type: 'USER',
        discordId: 'user2',
        scope: 'BOT',
        scopeId: '*',
        mode: 'BLOCK' as const,
      };
      cache.handleEvent({ type: 'add', entry });
      cache.handleEvent({ type: 'remove', entry });

      resolveAttempt({
        ok: true,
        data: {
          entries: [
            { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
          ],
        },
      });

      await expect(hydratePromise).resolves.toBe(true);
      expect(cache.isBotDenied('user2')).toBe(false);
    });

    it('events from a failed attempt are not replayed by the next one', async () => {
      let rejectAttempt!: (reason?: unknown) => void;
      mockGetDenylistCache
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectAttempt = reject;
            })
        )
        .mockResolvedValueOnce({
          ok: true,
          data: { entries: [] },
        });

      const hydratePromise = cache.hydrate();

      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user2', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });

      rejectAttempt(new Error('Gateway failure'));
      await expect(hydratePromise).resolves.toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(cache.isBotDenied('user2')).toBe(false);
    });
  });

  describe('isBotDenied', () => {
    it('should return true for bot-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });

      expect(cache.isBotDenied('user1')).toBe(true);
    });

    it('should return true for bot-denied guild', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'GUILD', discordId: 'guild1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });

      expect(cache.isBotDenied('', 'guild1')).toBe(true);
    });

    it('should return true for MUTE-mode entries (both modes prevent response)', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'MUTE' },
      });

      expect(cache.isBotDenied('user1')).toBe(true);
    });

    it('should return false for unknown user', () => {
      expect(cache.isBotDenied('unknown')).toBe(false);
    });

    it('should return false for unknown guild', () => {
      expect(cache.isBotDenied('', 'unknown')).toBe(false);
    });

    it('should return false for empty userId without guildId', () => {
      expect(cache.isBotDenied('')).toBe(false);
    });
  });

  describe('isUserGuildDenied', () => {
    it('should return true for guild-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'GUILD',
          scopeId: 'guild1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isUserGuildDenied('user1', 'guild1')).toBe(true);
    });

    it('should return false for different guild', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'GUILD',
          scopeId: 'guild1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isUserGuildDenied('user1', 'guild2')).toBe(false);
    });

    it('should return false for unknown user', () => {
      expect(cache.isUserGuildDenied('unknown', 'guild1')).toBe(false);
    });
  });

  describe('isChannelDenied', () => {
    it('should return true for channel-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isChannelDenied('user1', 'chan1', null)).toBe(true);
    });

    it('should return false for different channel', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isChannelDenied('user1', 'chan2', null)).toBe(false);
    });

    it('should return false for unknown user', () => {
      expect(cache.isChannelDenied('unknown', 'chan1', null)).toBe(false);
    });

    describe('thread→parent inheritance (any mode)', () => {
      it('inherits a parent BLOCK when the thread has no entry', () => {
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'parent-chan',
            mode: 'BLOCK',
          },
        });

        expect(cache.isChannelDenied('user1', 'thread-chan', 'parent-chan')).toBe(true);
      });

      it('inherits a parent MUTE when the thread has no entry (ANY-MODE, not BLOCK-only)', () => {
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'parent-chan',
            mode: 'MUTE',
          },
        });

        expect(cache.isChannelDenied('user1', 'thread-chan', 'parent-chan')).toBe(true);
      });

      it('does NOT let a thread MUTE override a parent BLOCK — unlike isBlocked()', () => {
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'parent-chan',
            mode: 'BLOCK',
          },
        });
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'thread-chan',
            mode: 'MUTE',
          },
        });

        expect(cache.isChannelDenied('user1', 'thread-chan', 'parent-chan')).toBe(true);
      });

      it('does not inherit when parentChannelId is null, even if the parent channel has an entry', () => {
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'parent-chan',
            mode: 'BLOCK',
          },
        });

        expect(cache.isChannelDenied('user1', 'thread-chan', null)).toBe(false);
      });

      it('returns false when neither the thread nor the parent has an entry', () => {
        expect(cache.isChannelDenied('user1', 'thread-chan', 'parent-chan')).toBe(false);
      });

      it('contrast: isBlocked() lets an explicit thread MUTE override a parent BLOCK (stays divergent from isChannelDenied)', () => {
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'parent-chan',
            mode: 'BLOCK',
          },
        });
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'thread-chan',
            mode: 'MUTE',
          },
        });

        expect(cache.isBlocked('user1', undefined, 'thread-chan', undefined, 'parent-chan')).toBe(
          false
        );
      });
    });
  });

  describe('isPersonalityDenied', () => {
    it('should return true for personality-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'PERSONALITY',
          scopeId: 'pers1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isPersonalityDenied('user1', 'pers1')).toBe(true);
    });

    it('should return false for different personality', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'PERSONALITY',
          scopeId: 'pers1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isPersonalityDenied('user1', 'pers2')).toBe(false);
    });

    it('should return false for unknown user', () => {
      expect(cache.isPersonalityDenied('unknown', 'pers1')).toBe(false);
    });
  });

  describe('isPersonalityMuted', () => {
    it('returns true only for a MUTE-mode personality entry', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'PERSONALITY',
          scopeId: 'pers1',
          mode: 'MUTE',
        },
      });

      expect(cache.isPersonalityMuted('user1', 'pers1')).toBe(true);
      // Denied AND muted — both are true for the same entry.
      expect(cache.isPersonalityDenied('user1', 'pers1')).toBe(true);
    });

    it('returns false for a BLOCK-mode entry (overt denial)', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'PERSONALITY',
          scopeId: 'pers1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isPersonalityMuted('user1', 'pers1')).toBe(false);
    });

    it('returns false when no entry exists', () => {
      expect(cache.isPersonalityMuted('nobody', 'pers1')).toBe(false);
    });
  });

  describe('isBlocked', () => {
    it('should return true for BLOCK-mode bot-wide user', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });

      expect(cache.isBlocked('user1')).toBe(true);
    });

    it('should return false for MUTE-mode bot-wide user', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'MUTE' },
      });

      expect(cache.isBlocked('user1')).toBe(false);
    });

    it('should return true for BLOCK-mode guild-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'GUILD',
          scopeId: 'guild1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isBlocked('user1', 'guild1')).toBe(true);
    });

    it('should return false for MUTE-mode guild-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'GUILD',
          scopeId: 'guild1',
          mode: 'MUTE',
        },
      });

      expect(cache.isBlocked('user1', 'guild1')).toBe(false);
    });

    it('should return true for BLOCK-mode channel-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isBlocked('user1', undefined, 'chan1')).toBe(true);
    });

    it('should return false for MUTE-mode channel-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan1',
          mode: 'MUTE',
        },
      });

      expect(cache.isBlocked('user1', undefined, 'chan1')).toBe(false);
    });

    it('should return true for BLOCK-mode personality-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'PERSONALITY',
          scopeId: 'pers1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isBlocked('user1', undefined, undefined, 'pers1')).toBe(true);
    });

    it('should return false for MUTE-mode personality-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'PERSONALITY',
          scopeId: 'pers1',
          mode: 'MUTE',
        },
      });

      expect(cache.isBlocked('user1', undefined, undefined, 'pers1')).toBe(false);
    });

    it('should return true for BLOCK-mode bot-wide guild', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'GUILD', discordId: 'guild1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });

      expect(cache.isBlocked('user1', 'guild1')).toBe(true);
    });

    it('should return false for unknown user with no entries', () => {
      expect(cache.isBlocked('user1')).toBe(false);
    });

    describe('with parentChannelId (thread inheritance)', () => {
      it('should inherit BLOCK from parent channel when thread has no entry', () => {
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'parent-chan',
            mode: 'BLOCK',
          },
        });

        expect(cache.isBlocked('user1', undefined, 'thread-123', undefined, 'parent-chan')).toBe(
          true
        );
      });

      it('should NOT inherit MUTE from parent channel', () => {
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'parent-chan',
            mode: 'MUTE',
          },
        });

        expect(cache.isBlocked('user1', undefined, 'thread-123', undefined, 'parent-chan')).toBe(
          false
        );
      });

      it('should let thread MUTE override parent BLOCK', () => {
        // Parent has BLOCK
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'parent-chan',
            mode: 'BLOCK',
          },
        });
        // Thread has explicit MUTE (overrides parent)
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'thread-123',
            mode: 'MUTE',
          },
        });

        expect(cache.isBlocked('user1', undefined, 'thread-123', undefined, 'parent-chan')).toBe(
          false
        );
      });

      it('should return false when neither thread nor parent has entry', () => {
        expect(cache.isBlocked('user1', undefined, 'thread-123', undefined, 'parent-chan')).toBe(
          false
        );
      });

      it('should return true when thread itself has BLOCK (ignores parent)', () => {
        cache.handleEvent({
          type: 'add',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'thread-123',
            mode: 'BLOCK',
          },
        });

        expect(cache.isBlocked('user1', undefined, 'thread-123', undefined, 'parent-chan')).toBe(
          true
        );
      });
    });

    it('should check all scopes and return true if any is BLOCK', () => {
      // MUTE at bot level, BLOCK at channel level
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'MUTE' },
      });
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isBlocked('user1', undefined, 'chan1')).toBe(true);
    });
  });

  describe('handleEvent', () => {
    it('should add and remove bot user entries', () => {
      const entry = { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' };

      cache.handleEvent({ type: 'add', entry });
      expect(cache.isBotDenied('user1')).toBe(true);

      cache.handleEvent({ type: 'remove', entry });
      expect(cache.isBotDenied('user1')).toBe(false);
    });

    it('should add and remove bot guild entries', () => {
      const entry = {
        type: 'GUILD',
        discordId: 'guild1',
        scope: 'BOT',
        scopeId: '*',
        mode: 'BLOCK',
      };

      cache.handleEvent({ type: 'add', entry });
      expect(cache.isBotDenied('', 'guild1')).toBe(true);

      cache.handleEvent({ type: 'remove', entry });
      expect(cache.isBotDenied('', 'guild1')).toBe(false);
    });

    it('should add and remove channel entries', () => {
      const entry = {
        type: 'USER',
        discordId: 'user1',
        scope: 'CHANNEL',
        scopeId: 'chan1',
        mode: 'BLOCK',
      };

      cache.handleEvent({ type: 'add', entry });
      expect(cache.isChannelDenied('user1', 'chan1', null)).toBe(true);

      cache.handleEvent({ type: 'remove', entry });
      expect(cache.isChannelDenied('user1', 'chan1', null)).toBe(false);
    });

    it('should add and remove personality entries', () => {
      const entry = {
        type: 'USER',
        discordId: 'user1',
        scope: 'PERSONALITY',
        scopeId: 'pers1',
        mode: 'BLOCK',
      };

      cache.handleEvent({ type: 'add', entry });
      expect(cache.isPersonalityDenied('user1', 'pers1')).toBe(true);

      cache.handleEvent({ type: 'remove', entry });
      expect(cache.isPersonalityDenied('user1', 'pers1')).toBe(false);
    });

    it('should handle multiple channel entries per user', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan1',
          mode: 'BLOCK',
        },
      });
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan2',
          mode: 'BLOCK',
        },
      });

      expect(cache.isChannelDenied('user1', 'chan1', null)).toBe(true);
      expect(cache.isChannelDenied('user1', 'chan2', null)).toBe(true);

      // Remove one, keep the other
      cache.handleEvent({
        type: 'remove',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan1',
          mode: 'BLOCK',
        },
      });

      expect(cache.isChannelDenied('user1', 'chan1', null)).toBe(false);
      expect(cache.isChannelDenied('user1', 'chan2', null)).toBe(true);
    });

    it('should clean up empty map entries after last removal', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan1',
          mode: 'BLOCK',
        },
      });
      cache.handleEvent({
        type: 'remove',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan1',
          mode: 'BLOCK',
        },
      });

      // The user's channel denial is gone after the matching removal.
      expect(cache.isChannelDenied('user1', 'chan1', null)).toBe(false);

      // Removing a non-existent entry from the now-cleaned user must not throw.
      expect(() =>
        cache.handleEvent({
          type: 'remove',
          entry: {
            type: 'USER',
            discordId: 'user1',
            scope: 'CHANNEL',
            scopeId: 'chan2',
            mode: 'BLOCK',
          },
        })
      ).not.toThrow();
    });

    it('should update mode when re-adding with different mode', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });
      expect(cache.isBlocked('user1')).toBe(true);

      // Re-add as MUTE
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*', mode: 'MUTE' },
      });
      expect(cache.isBotDenied('user1')).toBe(true);
      expect(cache.isBlocked('user1')).toBe(false);
    });
  });

  describe('thread-scoped denial', () => {
    it('blocks in an explicitly thread-scoped CHANNEL entry', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'thread-abc',
          mode: 'BLOCK',
        },
      });

      expect(cache.isBlocked('user1', undefined, 'thread-abc', undefined, 'parent-abc')).toBe(true);
    });

    it('does NOT block in a different channel — the entry is thread-only', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'thread-abc',
          mode: 'BLOCK',
        },
      });

      expect(cache.isBlocked('user1', undefined, 'other-channel', undefined, undefined)).toBe(
        false
      );
    });

    it('isChannelDenied returns true for the thread id directly', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'thread-abc',
          mode: 'BLOCK',
        },
      });

      expect(cache.isChannelDenied('user1', 'thread-abc', null)).toBe(true);
    });

    it('preserves parent-inheritance: a parent-scoped BLOCK with no thread entry still blocks the thread', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'parent-abc',
          mode: 'BLOCK',
        },
      });

      expect(cache.isBlocked('user1', undefined, 'thread-abc', undefined, 'parent-abc')).toBe(true);
    });

    it('an explicit thread MUTE entry wins over a parent BLOCK entry', () => {
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'parent-abc',
          mode: 'BLOCK',
        },
      });
      cache.handleEvent({
        type: 'add',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'thread-abc',
          mode: 'MUTE',
        },
      });

      expect(cache.isBlocked('user1', undefined, 'thread-abc', undefined, 'parent-abc')).toBe(
        false
      );
    });
  });

  describe('getDeniedGuildIds', () => {
    it('should return denied guild IDs', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'GUILD', discordId: 'guild1', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });
      cache.handleEvent({
        type: 'add',
        entry: { type: 'GUILD', discordId: 'guild2', scope: 'BOT', scopeId: '*', mode: 'BLOCK' },
      });

      const guilds = cache.getDeniedGuildIds();
      expect(guilds.has('guild1')).toBe(true);
      expect(guilds.has('guild2')).toBe(true);
      expect(guilds.size).toBe(2);
    });
  });
});
