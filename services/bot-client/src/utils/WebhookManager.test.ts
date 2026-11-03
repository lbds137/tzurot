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
import { WebhookManager, isRefusedUsernameError } from './WebhookManager.js';
import { adjustRefusedWebhookUsername } from './webhookNaming.js';
import {
  ChannelType,
  DiscordAPIError,
  type Client,
  TextChannel,
  ThreadChannel,
  type ForumChannel,
} from 'discord.js';
import type { Webhook } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { INTERVALS } from '@tzurot/common-types/constants/timing';

// Mock the logger
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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
    user: { id: clientUserId, username: 'TestBot' },
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
    voiceEnabled: false,
    llmConfig: {
      model: 'test-model',
      provider: 'openrouter',
      temperature: 0.7,
      maxTokens: 1000,
    },
  } as unknown as LoadedPersonality;
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
    it('should extract suffix from tag with delimiter', async () => {
      const client = createMockClient('Tzurot · Dev#0000');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('Lilith');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      const webhook = await manager.getWebhook(channel);
      await manager.sendAsPersonality(channel, personality, 'Test');

      // The bot tag's delimiter suffix ("Dev") is appended: "Lilith · Dev".
      expect(webhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'Lilith · Dev',
        })
      );
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

    // PR #864 regression guard: discriminator regex is `\s{0,16}#\d{4}$`.
    // If the whitespace bound were removed/narrowed, a tag with a few leading
    // spaces before the discriminator would fail to strip.
    it('strips discriminator even with multiple leading spaces (bounded-quantifier regression)', async () => {
      const client = createMockClient('BotName   #1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('TestPersonality');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      const webhook = await manager.getWebhook(channel);
      await manager.sendAsPersonality(channel, personality, 'Test');

      expect(webhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'TestPersonality · BotName',
        })
      );
    });

    it('should convert legacy pipe delimiter to middle dot', async () => {
      const client = createMockClient('Rotzot | תשב#0000');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('COLD');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      const webhook = await manager.getWebhook(channel);
      await manager.sendAsPersonality(channel, personality, 'Test');

      // Should extract suffix and use middle dot, not pipe
      expect(webhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'COLD · תשב',
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
          name: 'TestBot Personalities',
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
        allowedMentions: { parse: [] },
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
        allowedMentions: { parse: [] },
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
        allowedMentions: { parse: [] },
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

    it('should include allowedMentions to prevent @everyone/@here/@role pings', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('Lilith');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      await manager.sendAsPersonality(channel, personality, 'Hey @everyone check this out!');

      const webhook = await manager.getWebhook(channel);
      expect(webhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedMentions: { parse: [] },
        })
      );
    });

    it('should pass files to webhook.send when provided', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('Lilith');
      const channel = createMockTextChannel('channel-123', 'bot-123');
      const files = [{ attachment: Buffer.from([0x52, 0x49, 0x46, 0x46]), name: 'voice.wav' }];

      await manager.sendAsPersonality(channel, personality, 'Hello!', files);

      const webhook = await manager.getWebhook(channel);
      expect(webhook.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hello!',
          files: [{ attachment: expect.any(Buffer), name: 'voice.wav' }],
        })
      );
    });

    it('should not include files in webhook options when not provided', async () => {
      const client = createMockClient('TestBot#1234');
      manager = new WebhookManager(client);

      const personality = createMockPersonality('Lilith');
      const channel = createMockTextChannel('channel-123', 'bot-123');

      await manager.sendAsPersonality(channel, personality, 'Hello!');

      const webhook = await manager.getWebhook(channel);
      const callArgs = (webhook.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.files).toBeUndefined();
    });

    describe('displayName fallback to name', () => {
      it('should use displayName for webhook username', async () => {
        const client = createMockClient('TestBot#1234');
        manager = new WebhookManager(client);

        // Note: displayName fallback to name is handled by mapToPersonality(),
        // not by WebhookManager. WebhookManager trusts that displayName is always set.
        const personality = createMockPersonality('Lilith Display', undefined, 'lilith');
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

// Discord refuses a webhook username containing "discord" or "clyde", or longer
// than 80 characters, with a 50035 whose errors.username carries the reason.
function createDiscordError(
  code: number,
  errors: Record<string, unknown> | undefined
): DiscordAPIError {
  const rawError = { message: 'Invalid Form Body', code, errors };
  return new DiscordAPIError(
    rawError as unknown as ConstructorParameters<typeof DiscordAPIError>[0],
    code,
    400,
    'POST',
    '/webhooks/123/token',
    {}
  );
}

function createUsernameRefusal(): DiscordAPIError {
  return createDiscordError(50035, {
    username: {
      _errors: [
        { code: 'USERNAME_INVALID_CONTAINS', message: 'Username cannot contain "discord"' },
      ],
    },
  });
}

describe('isRefusedUsernameError', () => {
  it('accepts a 50035 whose errors carry a username object', () => {
    expect(isRefusedUsernameError(createUsernameRefusal())).toBe(true);
  });

  it('rejects a 50035 whose errors have no username key', () => {
    const error = createDiscordError(50035, {
      content: { _errors: [{ code: 'BASE_TYPE_REQUIRED', message: 'Required' }] },
    });
    expect(isRefusedUsernameError(error)).toBe(false);
  });

  it('rejects a Discord error with another code', () => {
    expect(isRefusedUsernameError(createDiscordError(10062, undefined))).toBe(false);
  });

  it('rejects a non-Discord error', () => {
    expect(isRefusedUsernameError(new Error('boom'))).toBe(false);
  });
});

describe('WebhookManager refused usernames', () => {
  let manager: WebhookManager;
  const suffix = ' · TestBot';
  const adjusted = adjustRefusedWebhookUsername('Discord Helper', suffix);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager?.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Replace the cached webhook's send with a scripted mock. */
  async function scriptedSend(
    channel: TextChannel | ThreadChannel,
    ...results: unknown[]
  ): Promise<ReturnType<typeof vi.fn>> {
    const webhook = await manager.getWebhook(channel);
    const send = vi.fn();
    for (const result of results) {
      if (result instanceof Error) {
        send.mockRejectedValueOnce(result);
      } else {
        send.mockResolvedValueOnce(result);
      }
    }
    webhook.send = send;
    return send;
  }

  it('retries once under the adjusted name and delivers the message', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    const send = await scriptedSend(channel, createUsernameRefusal(), { id: 'retry-message' });

    const message = await manager.sendAsPersonality(channel, personality, 'Hello');

    expect(message.id).toBe('retry-message');
    expect(send).toHaveBeenCalledTimes(2);
    const first = send.mock.calls[0][0];
    const second = send.mock.calls[1][0];
    expect(first.username).toBe('Discord Helper · TestBot');
    expect(second.username).toBe(adjusted);
    expect(second).toEqual({ ...first, username: adjusted });
  });

  it('keeps threadId on the retry for a thread send', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const parent = createMockTextChannel('channel-123', 'bot-123');
    const thread = createMockThreadChannel('thread-456', parent);
    const send = await scriptedSend(thread, createUsernameRefusal(), { id: 'retry-message' });

    await manager.sendAsPersonality(thread, personality, 'Hello');

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].threadId).toBe('thread-456');
    expect(send.mock.calls[1][0].threadId).toBe('thread-456');
    expect(send.mock.calls[1][0].username).toBe(adjusted);
  });

  it('rethrows a 50035 whose errors have no username key, after one send', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    const error = createDiscordError(50035, {
      content: { _errors: [{ code: 'BASE_TYPE_REQUIRED', message: 'Required' }] },
    });
    const send = await scriptedSend(channel, error);

    await expect(manager.sendAsPersonality(channel, personality, 'Hello')).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-Discord error, after one send', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    const error = new Error('network down');
    const send = await scriptedSend(channel, error);

    await expect(manager.sendAsPersonality(channel, personality, 'Hello')).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rethrows the second error when the adjusted name is refused too, after two sends', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    const secondRefusal = createUsernameRefusal();
    const send = await scriptedSend(channel, createUsernameRefusal(), secondRefusal);

    await expect(manager.sendAsPersonality(channel, personality, 'Hello')).rejects.toBe(
      secondRefusal
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends the adjusted name directly on the next send for the same persona', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    const send = await scriptedSend(
      channel,
      createUsernameRefusal(),
      { id: 'retry-message' },
      { id: 'next-message' }
    );

    await manager.sendAsPersonality(channel, personality, 'First');
    const message = await manager.sendAsPersonality(channel, personality, 'Second');

    expect(message.id).toBe('next-message');
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0].username).toBe(adjusted);
  });

  it('rethrows the original refusal without a second send when the adjusted name equals the plain one', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Weaver');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    const refusal = createUsernameRefusal();
    const send = await scriptedSend(channel, refusal);

    await expect(manager.sendAsPersonality(channel, personality, 'Hello')).rejects.toBe(refusal);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not cache a refused retry, so the next send starts from the plain name', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    const retryRefusal = createUsernameRefusal();
    const send = await scriptedSend(channel, createUsernameRefusal(), retryRefusal, {
      id: 'plain-again',
    });

    await expect(manager.sendAsPersonality(channel, personality, 'First')).rejects.toBe(
      retryRefusal
    );
    const message = await manager.sendAsPersonality(channel, personality, 'Second');

    expect(message.id).toBe('plain-again');
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0].username).toBe('Discord Helper · TestBot');
  });

  it('forgets a cached adjusted name once it is refused, so the send after uses the plain name', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    const laterRefusal = createUsernameRefusal();
    const send = await scriptedSend(
      channel,
      createUsernameRefusal(),
      { id: 'retry-message' },
      laterRefusal,
      { id: 'plain-again' }
    );

    await manager.sendAsPersonality(channel, personality, 'First');
    await expect(manager.sendAsPersonality(channel, personality, 'Second')).rejects.toBe(
      laterRefusal
    );
    const message = await manager.sendAsPersonality(channel, personality, 'Third');

    expect(message.id).toBe('plain-again');
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[3][0].username).toBe('Discord Helper · TestBot');
  });

  it('reuses the adjusted name within 24h and sends the plain name again after it expires', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    // The TTL cache reads performance.now (lru-cache's default clock), which the
    // fake timers do not move, so the test drives that clock directly. lru-cache
    // debounces that clock with a setTimeout, so fake timers must advance between
    // clock moves for the new reading to be taken. The clock starts above zero:
    // lru-cache treats a zero start time as unset and never expires that entry.
    const base = 1000;
    const clock = vi.spyOn(performance, 'now').mockReturnValue(base);
    const send = await scriptedSend(
      channel,
      createUsernameRefusal(),
      { id: 'retry-message' },
      { id: 'within-ttl' },
      { id: 'expired' }
    );
    const day = 24 * 60 * 60 * 1000;

    await manager.sendAsPersonality(channel, personality, 'First');
    clock.mockReturnValue(base + day - 1);
    vi.advanceTimersByTime(1000);
    await manager.sendAsPersonality(channel, personality, 'Second');
    clock.mockReturnValue(base + day + 1);
    vi.advanceTimersByTime(1000);
    await manager.sendAsPersonality(channel, personality, 'Third');

    expect(send.mock.calls[2][0].username).toBe(adjusted);
    expect(send.mock.calls[3][0].username).toBe('Discord Helper · TestBot');
  });

  it('passes the same files to the retry', async () => {
    manager = new WebhookManager(createMockClient('TestBot#1234'));
    const personality = createMockPersonality('Discord Helper');
    const channel = createMockTextChannel('channel-123', 'bot-123');
    const files = [{ attachment: Buffer.from('audio'), name: 'voice.ogg' }];
    const send = await scriptedSend(channel, createUsernameRefusal(), { id: 'retry-message' });

    await manager.sendAsPersonality(channel, personality, 'Hello', files);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].files).toBe(files);
    expect(send.mock.calls[1][0].files).toBe(files);
  });
});
