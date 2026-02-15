import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DenylistCache } from './DenylistCache.js';

// Mock logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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
    cache = new DenylistCache();
  });

  describe('hydrate', () => {
    it('should populate cache from gateway response', async () => {
      const mockGateway = {
        getDenylistEntries: vi.fn().mockResolvedValue({
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
        }),
      };

      await cache.hydrate(mockGateway as never);

      expect(cache.isBotDenied('user1')).toBe(true);
      expect(cache.isBotDenied('', 'guild1')).toBe(true);
      expect(cache.isChannelDenied('user2', 'chan1')).toBe(true);
      expect(cache.isPersonalityDenied('user3', 'pers1')).toBe(true);
    });

    it('should default mode to BLOCK for entries without mode', async () => {
      const mockGateway = {
        getDenylistEntries: vi.fn().mockResolvedValue({
          entries: [{ type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*' }],
        }),
      };

      await cache.hydrate(mockGateway as never);

      expect(cache.isBotDenied('user1')).toBe(true);
      expect(cache.isBlocked('user1')).toBe(true);
    });

    it('should start with empty cache on hydration failure', async () => {
      const mockGateway = {
        getDenylistEntries: vi.fn().mockRejectedValue(new Error('Network error')),
      };

      await cache.hydrate(mockGateway as never);

      expect(cache.isBotDenied('user1')).toBe(false);
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

      expect(cache.isChannelDenied('user1', 'chan1')).toBe(true);
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

      expect(cache.isChannelDenied('user1', 'chan2')).toBe(false);
    });

    it('should return false for unknown user', () => {
      expect(cache.isChannelDenied('unknown', 'chan1')).toBe(false);
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
      expect(cache.isChannelDenied('user1', 'chan1')).toBe(true);

      cache.handleEvent({ type: 'remove', entry });
      expect(cache.isChannelDenied('user1', 'chan1')).toBe(false);
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

      expect(cache.isChannelDenied('user1', 'chan1')).toBe(true);
      expect(cache.isChannelDenied('user1', 'chan2')).toBe(true);

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

      expect(cache.isChannelDenied('user1', 'chan1')).toBe(false);
      expect(cache.isChannelDenied('user1', 'chan2')).toBe(true);
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

      // Removing a non-existent entry from the now-cleaned user should not throw
      cache.handleEvent({
        type: 'remove',
        entry: {
          type: 'USER',
          discordId: 'user1',
          scope: 'CHANNEL',
          scopeId: 'chan2',
          mode: 'BLOCK',
        },
      });
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
