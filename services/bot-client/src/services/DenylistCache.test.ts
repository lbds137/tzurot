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
            { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*' },
            { type: 'GUILD', discordId: 'guild1', scope: 'BOT', scopeId: '*' },
            { type: 'USER', discordId: 'user2', scope: 'CHANNEL', scopeId: 'chan1' },
            { type: 'USER', discordId: 'user3', scope: 'PERSONALITY', scopeId: 'pers1' },
          ],
        }),
      };

      await cache.hydrate(mockGateway as never);

      expect(cache.isBotDenied('user1')).toBe(true);
      expect(cache.isBotDenied('', 'guild1')).toBe(true);
      expect(cache.isChannelDenied('user2', 'chan1')).toBe(true);
      expect(cache.isPersonalityDenied('user3', 'pers1')).toBe(true);
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
        entry: { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*' },
      });

      expect(cache.isBotDenied('user1')).toBe(true);
    });

    it('should return true for bot-denied guild', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'GUILD', discordId: 'guild1', scope: 'BOT', scopeId: '*' },
      });

      expect(cache.isBotDenied('', 'guild1')).toBe(true);
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

  describe('isChannelDenied', () => {
    it('should return true for channel-denied user', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'CHANNEL', scopeId: 'chan1' },
      });

      expect(cache.isChannelDenied('user1', 'chan1')).toBe(true);
    });

    it('should return false for different channel', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'CHANNEL', scopeId: 'chan1' },
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
        entry: { type: 'USER', discordId: 'user1', scope: 'PERSONALITY', scopeId: 'pers1' },
      });

      expect(cache.isPersonalityDenied('user1', 'pers1')).toBe(true);
    });

    it('should return false for different personality', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'PERSONALITY', scopeId: 'pers1' },
      });

      expect(cache.isPersonalityDenied('user1', 'pers2')).toBe(false);
    });

    it('should return false for unknown user', () => {
      expect(cache.isPersonalityDenied('unknown', 'pers1')).toBe(false);
    });
  });

  describe('handleEvent', () => {
    it('should add and remove bot user entries', () => {
      const entry = { type: 'USER', discordId: 'user1', scope: 'BOT', scopeId: '*' };

      cache.handleEvent({ type: 'add', entry });
      expect(cache.isBotDenied('user1')).toBe(true);

      cache.handleEvent({ type: 'remove', entry });
      expect(cache.isBotDenied('user1')).toBe(false);
    });

    it('should add and remove bot guild entries', () => {
      const entry = { type: 'GUILD', discordId: 'guild1', scope: 'BOT', scopeId: '*' };

      cache.handleEvent({ type: 'add', entry });
      expect(cache.isBotDenied('', 'guild1')).toBe(true);

      cache.handleEvent({ type: 'remove', entry });
      expect(cache.isBotDenied('', 'guild1')).toBe(false);
    });

    it('should add and remove channel entries', () => {
      const entry = { type: 'USER', discordId: 'user1', scope: 'CHANNEL', scopeId: 'chan1' };

      cache.handleEvent({ type: 'add', entry });
      expect(cache.isChannelDenied('user1', 'chan1')).toBe(true);

      cache.handleEvent({ type: 'remove', entry });
      expect(cache.isChannelDenied('user1', 'chan1')).toBe(false);
    });

    it('should add and remove personality entries', () => {
      const entry = { type: 'USER', discordId: 'user1', scope: 'PERSONALITY', scopeId: 'pers1' };

      cache.handleEvent({ type: 'add', entry });
      expect(cache.isPersonalityDenied('user1', 'pers1')).toBe(true);

      cache.handleEvent({ type: 'remove', entry });
      expect(cache.isPersonalityDenied('user1', 'pers1')).toBe(false);
    });

    it('should handle multiple channel entries per user', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'CHANNEL', scopeId: 'chan1' },
      });
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'CHANNEL', scopeId: 'chan2' },
      });

      expect(cache.isChannelDenied('user1', 'chan1')).toBe(true);
      expect(cache.isChannelDenied('user1', 'chan2')).toBe(true);

      // Remove one, keep the other
      cache.handleEvent({
        type: 'remove',
        entry: { type: 'USER', discordId: 'user1', scope: 'CHANNEL', scopeId: 'chan1' },
      });

      expect(cache.isChannelDenied('user1', 'chan1')).toBe(false);
      expect(cache.isChannelDenied('user1', 'chan2')).toBe(true);
    });

    it('should clean up empty map entries after last removal', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'USER', discordId: 'user1', scope: 'CHANNEL', scopeId: 'chan1' },
      });
      cache.handleEvent({
        type: 'remove',
        entry: { type: 'USER', discordId: 'user1', scope: 'CHANNEL', scopeId: 'chan1' },
      });

      // Removing a non-existent entry from the now-cleaned user should not throw
      cache.handleEvent({
        type: 'remove',
        entry: { type: 'USER', discordId: 'user1', scope: 'CHANNEL', scopeId: 'chan2' },
      });
    });
  });

  describe('getDeniedGuildIds', () => {
    it('should return denied guild IDs', () => {
      cache.handleEvent({
        type: 'add',
        entry: { type: 'GUILD', discordId: 'guild1', scope: 'BOT', scopeId: '*' },
      });
      cache.handleEvent({
        type: 'add',
        entry: { type: 'GUILD', discordId: 'guild2', scope: 'BOT', scopeId: '*' },
      });

      const guilds = cache.getDeniedGuildIds();
      expect(guilds.has('guild1')).toBe(true);
      expect(guilds.has('guild2')).toBe(true);
      expect(guilds.size).toBe(2);
    });
  });
});
