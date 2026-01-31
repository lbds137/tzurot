/**
 * WebhookManager Unit Tests
 *
 * Tests for Discord webhook management including:
 * - Webhook creation and caching
 * - Bot suffix extraction from client tag
 * - Thread and channel support
 * - Cache cleanup and LRU eviction
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebhookManager } from './WebhookManager.js';
import { ChannelType, Client, TextChannel, ThreadChannel, ForumChannel } from 'discord.js';
import type { Webhook, User } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import { INTERVALS, DISCORD_LIMITS } from '@tzurot/common-types';

// Mock the logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Helper to create mock Discord.js Client
function createMockClient(tag?: string): Client {
  const client = {
    user: tag
      ? {
          id: 'bot-123',
          tag,
        }
      : null,
  } as unknown as Client;
  return client;
}

// Helper to create mock TextChannel
function createMockTextChannel(
  id: string,
  clientUserId: string,
  existingWebhooks: Webhook[] = []
): TextChannel {
  const mockChannel = Object.create(TextChannel.prototype);
  mockChannel.id = id;
  mockChannel.type = ChannelType.GuildText;
  mockChannel.client = {
    user: { id: clientUserId },
  };
  mockChannel.fetchWebhooks = vi.fn().mockResolvedValue({
    find: vi.fn((fn: (wh: Webhook) => boolean) => existingWebhooks.find(fn)),
  });
  mockChannel.createWebhook = vi.fn().mockResolvedValue(createMockWebhook('new-webhook'));
  mockChannel.isThread = () => false;
  return mockChannel;
}

// Helper to create mock ThreadChannel
function createMockThreadChannel(
  id: string,
  parentChannel: TextChannel | ForumChannel | null,
  parentType: ChannelType = ChannelType.GuildText
): ThreadChannel {
  const mockThread = Object.create(ThreadChannel.prototype);
  mockThread.id = id;
  mockThread.type = ChannelType.PublicThread;

  // Use Object.defineProperty since ThreadChannel.prototype.parent is a getter
  const parentValue = parentChannel
    ? {
        ...parentChannel,
        type: parentType,
      }
    : null;
  Object.defineProperty(mockThread, 'parent', {
    value: parentValue,
    writable: true,
    configurable: true,
  });

  mockThread.isThread = () => true;
  return mockThread;
}

// Helper to create mock Webhook
function createMockWebhook(id: string, ownerId?: string): Webhook {
  return {
    id,
    owner: ownerId ? { id: ownerId } : null,
    send: vi.fn().mockResolvedValue({ id: `message-from-${id}` }),
  } as unknown as Webhook;
}

// Helper to create mock LoadedPersonality
// Note: avatarUrl now includes path-based cache-busting (timestamp in filename)
// e.g., /avatars/cold-1705827727111.png - no need for separate avatarUpdatedAt
function createMockPersonality(
  displayName: string,
  avatarUrl?: string,
  name?: string
): LoadedPersonality {
  return {
    id: 'personality-123',
    name: name ?? displayName.toLowerCase() ?? 'fallback-name',
    displayName,
    systemPrompt: 'Test personality',
    avatarUrl,
    llmConfig: {
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 1000,
    },
  } as LoadedPersonality;
}

describe('WebhookManager', () => {
  let manager: WebhookManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager?.destroy();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with client', () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      expect(manager).toBeInstanceOf(WebhookManager);
    });

    it('should start cleanup interval on construction', () => {
      const client = createMockClient('TestBot#1234');
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      manager = new WebhookManager(client);

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), INTERVALS.WEBHOOK_CLEANUP);
    });
  });

  describe('getBotSuffix (via getStandardizedUsername)', () => {
    it('should extract suffix from tag with delimiter', () => {
      const client = createMockClient('Tzurot · Dev#0000');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('Lilith');
      // Access via sendAsPersonality which calls getStandardizedUsername internally
      const channel = createMockTextChannel('channel-123', 'bot-123');

      // We can test the suffix by checking what username is passed to webhook.send
      manager.getWebhook(channel).then(webhook => {
        manager.sendAsPersonality(channel, personality, 'Test');
      });
    });

    it('should use full username when no delimiter in tag', async () => {
      const client = createMockClient('SingleName#1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('Lilith');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      const webhook = await manager.getWebhook(channel);
      await manager.sendAsPersonality(channel, personality, 'Test');

      // The username should be "Lilith · SingleName"
      expect(webhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'Lilith · SingleName',
        })
      );
    });

    it('should remove discriminator from tag', async () => {
      const client = createMockClient('BotName#1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('TestPersonality');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      const webhook = await manager.getWebhook(channel);
      await manager.sendAsPersonality(channel, personality, 'Test');

      // Should not contain #1234
      expect(webhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'TestPersonality · BotName',
        })
      );
    });

    it('should return empty suffix when client.user is null', async () => {
      const client = createMockClient(); // No user
      manager = new WebhookManager(client);

      const personality = createMockPersonality('TestBot');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      const webhook = await manager.getWebhook(channel);
      await manager.sendAsPersonality(channel, personality, 'Test');

      // Should just be the display name with no suffix
      expect(webhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'TestBot',
        })
      );
    });

    it('should cache suffix after first extraction', async () => {
      const client = createMockClient('CachedBot#0000');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('First');
      const personality2 = createMockPersonality('Second');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      const webhook = await manager.getWebhook(channel);
      await manager.sendAsPersonality(channel, personality, 'Test1');
      await manager.sendAsPersonality(channel, personality2, 'Test2');

      // Both should use same suffix
      expect(webhook.send).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          username: 'First · CachedBot',
        })
      );
      expect(webhook.send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          username: 'Second · CachedBot',
        })
      );
    });
  });

  describe('getWebhook', () => {
    describe('TextChannel support', () => {
      it('should fetch existing webhook owned by bot', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const existingWebhook = createMockWebhook('existing-webhook', 'bot-123');
        const channel = createMockTextChannel('channel-123', 'bot-123', [existingWebhook]);

        const webhook = await manager.getWebhook(channel);

        expect(channel.fetchWebhooks).toHaveBeenCalled();
        expect(channel.createWebhook).not.toHaveBeenCalled();
        expect(webhook.id).toBe('existing-webhook');
      });

      it('should create new webhook when none exists', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const channel = createMockTextChannel('channel-123', 'bot-123', []);

        const webhook = await manager.getWebhook(channel);

        expect(channel.fetchWebhooks).toHaveBeenCalled();
        expect(channel.createWebhook).toHaveBeenCalledWith({
          name: 'Tzurot Personalities',
          reason: 'Multi-personality bot system',
        });
        expect(webhook.id).toBe('new-webhook');
      });

      it('should ignore webhooks owned by other users', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const otherWebhook = createMockWebhook('other-webhook', 'other-user-456');
        const channel = createMockTextChannel('channel-123', 'bot-123', [otherWebhook]);

        const webhook = await manager.getWebhook(channel);

        expect(channel.createWebhook).toHaveBeenCalled();
        expect(webhook.id).toBe('new-webhook');
      });
    });

    describe('ThreadChannel support', () => {
      it('should get webhook from thread parent channel', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const parentChannel = createMockTextChannel('parent-123', 'bot-123');
        const thread = createMockThreadChannel('thread-456', parentChannel);

        const webhook = await manager.getWebhook(thread);

        expect(parentChannel.fetchWebhooks).toHaveBeenCalled();
        expect(webhook.id).toBe('new-webhook');
      });

      it('should support ForumChannel parent', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const parentChannel = createMockTextChannel('forum-123', 'bot-123');
        const thread = createMockThreadChannel('thread-456', parentChannel, ChannelType.GuildForum);

        const webhook = await manager.getWebhook(thread);

        expect(parentChannel.fetchWebhooks).toHaveBeenCalled();
        expect(webhook.id).toBe('new-webhook');
      });

      it('should throw error when thread has no parent', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const thread = createMockThreadChannel('thread-456', null);

        await expect(manager.getWebhook(thread)).rejects.toThrow(
          'Thread thread-456 has no parent channel'
        );
      });

      it('should throw error for unsupported parent channel type', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const parentChannel = createMockTextChannel('voice-123', 'bot-123');
        const thread = createMockThreadChannel('thread-456', parentChannel, ChannelType.GuildVoice);

        await expect(manager.getWebhook(thread)).rejects.toThrow(
          'Thread thread-456 has unsupported parent channel type'
        );
      });
    });

    describe('caching behavior', () => {
      it('should return cached webhook on subsequent calls', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const channel = createMockTextChannel('channel-123', 'bot-123');

        const webhook1 = await manager.getWebhook(channel);
        const webhook2 = await manager.getWebhook(channel);

        expect(channel.fetchWebhooks).toHaveBeenCalledTimes(1); // Only called once
        expect(webhook1).toBe(webhook2);
      });

      it('should cache by parent channel ID for threads', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const parentChannel = createMockTextChannel('parent-123', 'bot-123');
        const thread1 = createMockThreadChannel('thread-1', parentChannel);
        const thread2 = createMockThreadChannel('thread-2', parentChannel);

        const webhook1 = await manager.getWebhook(thread1);
        const webhook2 = await manager.getWebhook(thread2);

        // Both threads should use same cached webhook from parent
        expect(parentChannel.fetchWebhooks).toHaveBeenCalledTimes(1);
        expect(webhook1).toBe(webhook2);
      });

      it('should refresh webhook after cache timeout', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const channel = createMockTextChannel('channel-123', 'bot-123');

        await manager.getWebhook(channel);

        // Advance past cache timeout
        vi.advanceTimersByTime(INTERVALS.WEBHOOK_CACHE_TTL + 1000);

        await manager.getWebhook(channel);

        expect(channel.fetchWebhooks).toHaveBeenCalledTimes(2);
      });

      it('should update lastUsed on cache hit', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const channel = createMockTextChannel('channel-123', 'bot-123');

        await manager.getWebhook(channel);

        // Advance time but not past timeout
        vi.advanceTimersByTime(INTERVALS.WEBHOOK_CACHE_TTL / 2);

        // This should update lastUsed
        await manager.getWebhook(channel);

        // Advance same amount again - should still be valid because lastUsed was updated
        vi.advanceTimersByTime(INTERVALS.WEBHOOK_CACHE_TTL / 2);

        await manager.getWebhook(channel);

        // Should still be using cache (only 1 fetch)
        expect(channel.fetchWebhooks).toHaveBeenCalledTimes(1);
      });
    });

    describe('cache limit enforcement', () => {
      it('should evict LRU entries when cache exceeds limit', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        // Create more channels than max cache size
        const channels = [];
        for (let i = 0; i < DISCORD_LIMITS.WEBHOOK_CACHE_SIZE + 5; i++) {
          const channel = createMockTextChannel(`channel-${i}`, 'bot-123');
          channels.push(channel);
          await manager.getWebhook(channel);
          // Small time advance to establish LRU order
          vi.advanceTimersByTime(10);
        }

        // Access earliest channels again - they should have been evicted
        await manager.getWebhook(channels[0]);

        // Should have refetched because it was evicted
        expect(channels[0].fetchWebhooks).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('sendAsPersonality', () => {
    it('should send message with personality avatar and name', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('Lilith', 'https://example.com/avatar.png');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      const message = await manager.sendAsPersonality(channel, personality, 'Hello world!');

      const webhook = await manager.getWebhook(channel);
      expect(webhook.send).toHaveBeenCalledWith({
        content: 'Hello world!',
        username: 'Lilith · TestBot',
        avatarURL: 'https://example.com/avatar.png',
      });
      expect(message.id).toBe('message-from-new-webhook');
    });

    it('should send without avatarURL when personality has none', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('NoAvatar'); // No avatar URL
      const channel = createMockTextChannel('channel-123', 'bot-123');

      await manager.sendAsPersonality(channel, personality, 'Test message');

      const webhook = await manager.getWebhook(channel);
      expect(webhook.send).toHaveBeenCalledWith({
        content: 'Test message',
        username: 'NoAvatar · TestBot',
        avatarURL: undefined,
      });
    });

    it('should include threadId when sending to thread', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('ThreadBot');
      const parentChannel = createMockTextChannel('parent-123', 'bot-123');
      const thread = createMockThreadChannel('thread-456', parentChannel);

      await manager.sendAsPersonality(thread, personality, 'Thread message');

      const webhook = await manager.getWebhook(thread);
      expect(webhook.send).toHaveBeenCalledWith({
        content: 'Thread message',
        username: 'ThreadBot · TestBot',
        avatarURL: undefined,
        threadId: 'thread-456',
      });
    });

    it('should return the sent message', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('TestBot');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      const result = await manager.sendAsPersonality(channel, personality, 'Test');

      expect(result).toHaveProperty('id');
    });

    describe('displayName fallback to name', () => {
      it('should use displayName for webhook username', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        // Note: displayName fallback to name is handled by mapToPersonality(),
        // not by WebhookManager. WebhookManager trusts that displayName is always set.
        const personality = createMockPersonality('Lilith Display', undefined, undefined, 'lilith');
        const channel = createMockTextChannel('channel-123', 'bot-123');

        await manager.sendAsPersonality(channel, personality, 'Test');

        const webhook = await manager.getWebhook(channel);
        expect(webhook.send).toHaveBeenCalledWith(
          expect.objectContaining({
            username: 'Lilith Display · TestBot',
          })
        );
      });
    });

    describe('avatar URL handling', () => {
      // Note: Cache-busting is now path-based (timestamp in filename) and handled
      // by deriveAvatarUrl() in PersonalityDefaults.ts, not by WebhookManager.
      // WebhookManager simply passes the URL through to Discord.

      it('should pass through avatarURL with path-based cache-busting', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        // URL already includes timestamp in path (from deriveAvatarUrl)
        const personality = createMockPersonality(
          'Lilith',
          'https://example.com/avatars/lilith-1704067200000.png'
        );
        const channel = createMockTextChannel('channel-123', 'bot-123');

        await manager.sendAsPersonality(channel, personality, 'Test');

        const webhook = await manager.getWebhook(channel);
        expect(webhook.send).toHaveBeenCalledWith(
          expect.objectContaining({
            avatarURL: 'https://example.com/avatars/lilith-1704067200000.png',
          })
        );
      });

      it('should pass through undefined avatarURL when personality has no avatar', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        const personality = createMockPersonality('Lilith');
        const channel = createMockTextChannel('channel-123', 'bot-123');

        await manager.sendAsPersonality(channel, personality, 'Test');

        const webhook = await manager.getWebhook(channel);
        expect(webhook.send).toHaveBeenCalledWith(
          expect.objectContaining({
            avatarURL: undefined,
          })
        );
      });
    });
  });

  describe('cleanupExpiredCache', () => {
    it('should remove expired entries during periodic cleanup', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const channel1 = createMockTextChannel('channel-1', 'bot-123');
      const channel2 = createMockTextChannel('channel-2', 'bot-123');

      // Add both to cache
      await manager.getWebhook(channel1);
      await manager.getWebhook(channel2);

      // Advance past cache timeout
      vi.advanceTimersByTime(INTERVALS.WEBHOOK_CACHE_TTL + 1000);

      // Trigger cleanup interval
      vi.advanceTimersByTime(INTERVALS.WEBHOOK_CLEANUP);

      // Access again - both should need refetch
      await manager.getWebhook(channel1);
      await manager.getWebhook(channel2);

      expect(channel1.fetchWebhooks).toHaveBeenCalledTimes(2);
      expect(channel2.fetchWebhooks).toHaveBeenCalledTimes(2);
    });

    it('should not remove entries that were recently accessed', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const oldChannel = createMockTextChannel('old-channel', 'bot-123');
      const newChannel = createMockTextChannel('new-channel', 'bot-123');

      // Add old channel
      await manager.getWebhook(oldChannel);

      // Advance time significantly
      vi.advanceTimersByTime(INTERVALS.WEBHOOK_CACHE_TTL - 1000);

      // Add new channel
      await manager.getWebhook(newChannel);

      // Advance a bit more (old should expire, new should not)
      vi.advanceTimersByTime(2000);

      // Trigger cleanup
      vi.advanceTimersByTime(INTERVALS.WEBHOOK_CLEANUP);

      // Old channel should need refetch
      await manager.getWebhook(oldChannel);
      expect(oldChannel.fetchWebhooks).toHaveBeenCalledTimes(2);

      // New channel should still be cached
      await manager.getWebhook(newChannel);
      expect(newChannel.fetchWebhooks).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('should clear cleanup interval', () => {
      const client = createMockClient('TestBot#1234');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      manager = new WebhookManager(client);
      manager.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should clear webhook cache', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const channel = createMockTextChannel('channel-123', 'bot-123');
      await manager.getWebhook(channel);

      manager.destroy();

      // Create new manager (since old one is destroyed)
      manager = new WebhookManager(client);

      // Should need to refetch since cache was cleared
      await manager.getWebhook(channel);
      expect(channel.fetchWebhooks).toHaveBeenCalledTimes(2);
    });

    it('should handle being called multiple times safely', () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      expect(() => {
        manager.destroy();
        manager.destroy();
      }).not.toThrow();
    });
  });
});
