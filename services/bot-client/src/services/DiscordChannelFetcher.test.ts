/**
 * Tests for DiscordChannelFetcher
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collection, MessageType, MessageReferenceType } from 'discord.js';
import type { Message, TextChannel } from 'discord.js';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { DiscordChannelFetcher, type FetchableChannel } from './DiscordChannelFetcher.js';
import { executeDatabaseSync } from './channelFetcher/SyncExecutor.js';
import { OPT_OUT_FOOTER } from './releaseDm/releaseDmContext.js';

// Mock the logger (keep everything else from actual module)
vi.mock('@tzurot/common-types/constants/message', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/message')>(
    '@tzurot/common-types/constants/message'
  );
  return {
    ...actual,
    MESSAGE_LIMITS: {
      ...actual.MESSAGE_LIMITS,
      MAX_EXTENDED_CONTEXT: 100,
      MAX_REACTION_MESSAGES: 5,
      MAX_REACTIONS_PER_MESSAGE: 3,
      MAX_USERS_PER_REACTION: 5,
    },
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('./channelFetcher/SyncExecutor.js', () => ({
  executeDatabaseSync: vi.fn().mockResolvedValue({ updated: 0, deleted: 0 }),
}));

// Mock role interface for testing
interface MockRole {
  id: string;
  name: string;
  position: number;
}

// Helper to create mock Discord messages
// Mock attachment properties needed by extractAttachments
interface MockAttachment {
  id?: string;
  url?: string;
  contentType: string | null;
  name: string | null;
  size?: number;
  duration?: number | null; // null = not a voice message, undefined = treated as voice message (bug)
  waveform?: string;
}

// Mock reaction interface for testing
interface MockReaction {
  emoji: { id: string | null; name: string | null };
  users: {
    fetch: (options?: { limit?: number }) => Promise<Collection<string, MockReactorUser>>;
  };
}

interface MockReactorUser {
  id: string;
  username: string;
  displayName?: string;
  bot: boolean;
}

function createMockMessage(
  overrides: Partial<{
    id: string;
    content: string;
    authorId: string;
    authorUsername: string;
    authorGlobalName: string | null;
    memberDisplayName: string | null;
    memberRoles: MockRole[] | null;
    memberDisplayHexColor: string | null;
    memberJoinedAt: Date | null;
    guildId: string | null;
    isBot: boolean;
    webhookId: string | null;
    type: MessageType;
    createdAt: Date;
    attachments: Map<string, MockAttachment>;
    reference: { messageId: string; type?: number; channelId?: string } | null;
    reactions: Map<string, MockReaction>;
  }>
): Message {
  const defaults = {
    id: '123456789',
    content: 'Test message',
    authorId: 'user123',
    authorUsername: 'testuser',
    authorGlobalName: null,
    memberDisplayName: null,
    memberRoles: null,
    memberDisplayHexColor: null,
    memberJoinedAt: null,
    guildId: null,
    isBot: false,
    webhookId: null,
    type: MessageType.Default,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    attachments: new Map(),
    reference: null,
    reactions: new Map<string, MockReaction>(),
  };

  const config = { ...defaults, ...overrides };

  // Build member object with optional guild info
  let member = null;
  if (config.memberDisplayName !== null || config.memberRoles !== null) {
    const rolesCache = new Collection<string, MockRole>();
    if (config.memberRoles) {
      for (const role of config.memberRoles) {
        rolesCache.set(role.id, role);
      }
    }

    member = {
      displayName: config.memberDisplayName ?? config.authorUsername,
      roles: config.memberRoles ? { cache: rolesCache } : undefined,
      displayHexColor: config.memberDisplayHexColor ?? '#000000',
      joinedAt: config.memberJoinedAt,
    };
  }

  return {
    id: config.id,
    content: config.content,
    author: {
      id: config.authorId,
      username: config.authorUsername,
      globalName: config.authorGlobalName,
      bot: config.isBot,
    },
    member,
    webhookId: config.webhookId,
    guild: config.guildId ? { id: config.guildId } : null,
    type: config.type,
    createdAt: config.createdAt,
    createdTimestamp: config.createdAt.getTime(),
    attachments: new Collection(config.attachments),
    reference: config.reference,
    // Reactions cache for extended context processing
    reactions: { cache: new Collection(config.reactions) },
  } as unknown as Message;
}

/**
 * Helper to create a mock reaction with user fetching
 */
function createMockReaction(
  emoji: { id: string | null; name: string | null },
  users: MockReactorUser[]
): MockReaction {
  return {
    emoji,
    users: {
      fetch: vi.fn().mockImplementation((options?: { limit?: number }) => {
        const userCollection = new Collection<string, MockReactorUser>();
        const limit = options?.limit ?? users.length;
        const usersToAdd = users.slice(0, limit);
        for (const user of usersToAdd) {
          userCollection.set(user.id, user);
        }
        return Promise.resolve(userCollection);
      }),
    },
  };
}

// Helper to create mock channel
function createMockChannel(messages: Message[]): FetchableChannel {
  const messageCollection = new Collection<string, Message>();
  for (const msg of messages) {
    messageCollection.set(msg.id, msg);
  }

  return {
    id: 'channel123',
    messages: {
      fetch: vi.fn().mockResolvedValue(messageCollection),
    },
  } as unknown as TextChannel;
}

describe('DiscordChannelFetcher', () => {
  let fetcher: DiscordChannelFetcher;

  beforeEach(() => {
    vi.clearAllMocks();
    fetcher = new DiscordChannelFetcher();
  });

  describe('fetchRecentMessages', () => {
    it('should fetch and convert messages from Discord', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello world',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: '2',
          content: 'Hi there',
          authorId: 'user2',
          authorUsername: 'bob',
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.fetchedCount).toBe(2);
      expect(result.keptCount).toBe(2);
      expect(result.messages).toHaveLength(2);

      // Should be newest first - content no longer has [Name]: prefix (uses from attribute in XML)
      expect(result.messages[0].content).toBe('Hi there');
      expect(result.messages[1].content).toBe('Hello world');
    });

    it('includes a forwarded message with empty top-level content in history results', async () => {
      // Real invariant (keep beyond the temporary forward-shape diagnostic):
      // a forward whose top-level content is empty is NOT filtered out of the
      // history path — isForwardedMessage is true via the Forward reference
      // type, so it passes the processable-content gate. (It also exercises the
      // forward-shape diagnostic log, which is why a logger.info fires here.)
      const messages = [
        createMockMessage({
          id: 'fwd-1',
          content: '',
          authorId: 'user1',
          authorUsername: 'alice',
          reference: { messageId: 'orig-1', type: MessageReferenceType.Forward, channelId: 'src' },
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, { botUserId: 'bot123' });

      // Forwards are never filtered out even with empty extracted content.
      expect(result.fetchedCount).toBe(1);
      expect(result.messages).toHaveLength(1);
    });

    it('identifies our webhook character reply as assistant role (registry detection)', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'User message',
          authorId: 'user1',
          authorUsername: 'alice',
        }),
        createMockMessage({
          id: '2',
          content: 'Bot response',
          // Real webhook messages are authored by the WEBHOOK, not the primary
          // bot user: author.id !== botUserId and webhookId is set. (The old
          // tests modelled webhooks as authorId === botUserId, which never
          // matched production — the root of the footer-strip-never-ran bug.)
          authorId: 'webhook-2',
          authorUsername: 'TestBot',
          webhookId: 'webhook-2',
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        personalityName: 'TestPersonality',
        // Registry resolves this webhook message to one of our personalities.
        getOurPersonalityId: async id => (id === '2' ? 'personality-uuid' : null),
      });

      const userMsg = result.messages.find(m => m.role === MessageRole.User);
      const assistantMsg = result.messages.find(m => m.role === MessageRole.Assistant);

      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe('User message');

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBe('Bot response');
      // personalityName is the webhook display name (the registry stores the
      // UUID; the username carries the human-readable name). No suffix to strip.
      expect(assistantMsg!.personalityName).toBe('TestBot');
      expect(assistantMsg!.personaName).toBeUndefined();
      // The registry-resolved UUID is threaded through so ai-worker can remap
      // attribution to the unique name (display names can collide).
      expect(assistantMsg!.personalityId).toBe('personality-uuid');
    });

    it('extracts personality name from webhook " · BotName" suffix (registry-miss fallback)', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Bot response from webhook',
          authorId: 'webhook-1',
          // Webhook name format: "DisplayName · BotName" (current canonical form)
          authorUsername: 'Lila · תשב',
          webhookId: 'webhook-1',
        }),
      ];

      const channel = createMockChannel(messages);

      // No getOurPersonalityId → registry miss; the bot-suffix is the fallback
      // ownership detector for guild webhooks whose registry key expired.
      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        botSuffix: ' · תשב',
        personalityName: 'CurrentPersonality', // Different from webhook name
      });

      const assistantMsg = result.messages.find(m => m.role === MessageRole.Assistant);
      expect(assistantMsg).toBeDefined();
      // Should extract "Lila" from "Lila · תשב", not use "CurrentPersonality"
      expect(assistantMsg!.personalityName).toBe('Lila');
      // Registry miss → no UUID; ai-worker keeps the display-name attribution.
      expect(assistantMsg!.personalityId).toBeUndefined();
    });

    it('extracts personality name from webhook legacy " | BotName" suffix (back-compat)', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Bot response from legacy webhook',
          authorId: 'webhook-1',
          // Legacy webhook name format: "DisplayName | BotName" — older
          // messages keep their original pipe separator and must still
          // parse correctly (backward-compat read path).
          authorUsername: 'Lila | תשב',
          webhookId: 'webhook-1',
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        botSuffix: ' · תשב',
        personalityName: 'CurrentPersonality',
      });

      const assistantMsg = result.messages.find(m => m.role === MessageRole.Assistant);
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.personalityName).toBe('Lila');
    });

    it('falls back to raw webhook username for personalityName when no botSuffix is supplied', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Bot response',
          authorId: 'webhook-1',
          authorUsername: 'Lila · תשב',
          webhookId: 'webhook-1',
        }),
      ];

      const channel = createMockChannel(messages);

      // Registry establishes ownership; with no botSuffix there's nothing to
      // strip, so the raw webhook username is used as the personalityName
      // (degraded but not broken — caller's choice to opt in to stripping).
      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        personalityName: 'CurrentPersonality',
        getOurPersonalityId: async () => 'personality-uuid',
      });

      const assistantMsg = result.messages.find(m => m.role === MessageRole.Assistant);
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.personalityName).toBe('Lila · תשב');
    });

    it('classifies a primary-bot relay-echo of user input as a user message (Bug B)', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          // Chime-in / slash-command relay echo: sent by the PRIMARY bot user
          // via channel.send("**Name:** message"). The Name is the USER's
          // display name, and the message is USER content — not the bot's.
          content: '**Lila:** poke',
          authorId: botUserId,
          authorUsername: 'Rotzot',
          isBot: true,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        botSuffix: ' · תשב',
        // Relay echoes are NOT in the our-webhook registry (it holds personality
        // responses only), so the registry resolver returns null for them.
        getOurPersonalityId: async () => null,
      });

      const msg = result.messages[0];
      expect(msg.role).toBe(MessageRole.User);
      // Attributed to the user from the prefix, not to the bot/personality.
      expect(msg.personaName).toBe('Lila');
      expect(msg.personalityName).toBeUndefined();
      // The "**Name:** " prefix is stripped from the content seen by the model.
      expect(msg.content).toBe('poke');
      // The bot (relay author) must NOT be registered as a participant — the
      // isRealUser guard excludes bot-authored messages from user collection.
      expect(result.extendedContextUsers ?? []).not.toContainEqual(
        expect.objectContaining({ discordId: botUserId })
      );
    });

    it('classifies a primary-bot relay-echo with no prefix as a user message (bot name fallback)', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          // Edge case: a primary-bot message not in the registry and with no
          // "**Name:** " prefix (e.g. an error fallback). It's still user-role
          // (not our assistant), and personaName falls back to the author name.
          content: 'plain bot-authored text, no prefix',
          authorId: botUserId,
          authorUsername: 'Rotzot',
          isBot: true,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        getOurPersonalityId: async () => null, // not registered
      });

      const msg = result.messages[0];
      expect(msg.role).toBe(MessageRole.User);
      // No prefix to parse → personaName falls back to the author display name.
      expect(msg.personaName).toBe('Rotzot');
      expect(msg.content).toBe('plain bot-authored text, no prefix');
      // Still excluded from participant collection (bot-authored).
      expect(result.extendedContextUsers ?? []).not.toContainEqual(
        expect.objectContaining({ discordId: botUserId })
      );
    });

    it('classifies a primary-bot DM response as a relay-echo when the registry misses (documented degradation)', async () => {
      // Documents the registry-miss degradation: a real DM personality response
      // whose registry key expired/never-stored is classified as a relay-echo
      // (user role) on the LIVE copy. In production this is dedup-mitigated — the
      // DM response is persisted as role=assistant and the live copy dedups
      // against the DB row, so the misclassification never reaches the model.
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          content: '**Lila:** hello there',
          authorId: botUserId,
          authorUsername: 'Rotzot',
          isBot: true,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        getOurPersonalityId: async () => null, // registry miss (TTL expired / never stored)
      });

      const msg = result.messages[0];
      // Degrades to user-role relay-echo (the documented, dedup-mitigated path).
      expect(msg.role).toBe(MessageRole.User);
      expect(msg.personaName).toBe('Lila');
      expect(msg.content).toBe('hello there');
    });

    it('classifies a primary-bot DM personality response as an assistant message', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          // DMs can't use webhooks, so personality responses are sent by the
          // primary bot as "**Personality:** content" — and ARE registered.
          content: '**Lila:** hello there',
          authorId: botUserId,
          authorUsername: 'Rotzot',
          isBot: true,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        getOurPersonalityId: async () => 'personality-uuid',
      });

      const msg = result.messages[0];
      expect(msg.role).toBe(MessageRole.Assistant);
      // Personality display name comes from the "**Name:** " prefix in DMs.
      expect(msg.personalityName).toBe('Lila');
      expect(msg.content).toBe('hello there');
    });

    it('strips our -# footers (model / incognito / transcription) from webhook replies (Bug A)', async () => {
      const botUserId = 'bot123';
      const content = [
        'The actual reply.',
        '-# Model: [glm-5.2](<https://example/model>)',
        '-# 👻 Incognito Mode • Memories not being saved',
        '-# Transcribed by [Mistral](<https://example/stt>)',
      ].join('\n');

      const messages = [
        createMockMessage({
          id: '1',
          content,
          authorId: 'webhook-1',
          authorUsername: 'Lila · תשב',
          webhookId: 'webhook-1',
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        botSuffix: ' · תשב',
        getOurPersonalityId: async () => 'personality-uuid',
      });

      const msg = result.messages[0];
      expect(msg.role).toBe(MessageRole.Assistant);
      // All three footer kinds gone; only the real reply text reaches the model.
      expect(msg.content).toBe('The actual reply.');
      expect(msg.content).not.toContain('-#');
      expect(msg.content).not.toContain('Incognito');
      expect(msg.content).not.toContain('Transcribed by');
    });

    it('leaves a real user message containing footer/prefix-shaped text intact', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          // A human literally typing these shapes — must NOT be stripped or
          // re-attributed; normalization is scoped to OUR messages only.
          content: '**Important:** read this\n-# Model: not really a footer',
          authorId: 'user1',
          authorUsername: 'alice',
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        getOurPersonalityId: async () => null,
      });

      const msg = result.messages[0];
      expect(msg.role).toBe(MessageRole.User);
      expect(msg.content).toBe('**Important:** read this\n-# Model: not really a footer');
      expect(msg.personaName).toBe('alice');
    });

    it('treats a foreign webhook (registry miss + no suffix match) as a user message', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          // A non-ours webhook (e.g. PluralKit): has a webhookId, but the
          // registry doesn't know it AND its username carries no bot-suffix.
          content: 'proxied human message',
          authorId: 'pk-webhook-1',
          authorUsername: 'SomeSystemMember',
          webhookId: 'pk-webhook-1',
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
        botSuffix: ' · תשב',
        getOurPersonalityId: async () => null, // registry miss
      });

      const msg = result.messages[0];
      // Not ours → user role, content untouched, no personality attribution.
      expect(msg.role).toBe(MessageRole.User);
      expect(msg.content).toBe('proxied human message');
      expect(msg.personalityName).toBeUndefined();
    });

    it('should filter out system messages', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Normal message',
          type: MessageType.Default,
        }),
        createMockMessage({
          id: '2',
          content: 'User joined the server',
          type: MessageType.UserJoin,
        }),
        createMockMessage({
          id: '3',
          content: 'Someone boosted the server',
          type: MessageType.GuildBoost,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.fetchedCount).toBe(3);
      expect(result.keptCount).toBe(1);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toContain('Normal message');
    });

    it('should include Reply messages', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Original message',
          type: MessageType.Default,
        }),
        createMockMessage({
          id: '2',
          content: 'This is a reply',
          type: MessageType.Reply,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.messages).toHaveLength(2);
    });

    it('should filter empty messages without attachments', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Has content',
        }),
        createMockMessage({
          id: '2',
          content: '',
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.keptCount).toBe(1);
      expect(result.messages[0].content).toContain('Has content');
    });

    it('should filter thinking block messages from extended context', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'User question',
          authorId: 'user123',
        }),
        createMockMessage({
          id: '2',
          // Thinking block message - should be filtered
          content:
            '💭 **Thinking:**\n||Let me analyze this carefully...\nThe user is asking about...||',
          authorId: 'webhook123', // Sent via webhook, different from bot ID
          authorUsername: 'Lilith | שבת',
          isBot: true, // Webhooks show as bot
        }),
        createMockMessage({
          id: '3',
          content: 'The actual response without thinking',
          authorId: 'bot456',
          authorUsername: 'Lilith | שבת',
          isBot: true,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot456',
        personalityName: 'Lilith',
      });

      // Should have 2 messages (user + response), not 3 (thinking filtered out)
      expect(result.fetchedCount).toBe(3);
      expect(result.keptCount).toBe(2);
      expect(result.messages).toHaveLength(2);

      // Verify thinking block was filtered
      const thinkingMsg = result.messages.find(m => m.content?.includes('💭 **Thinking:**'));
      expect(thinkingMsg).toBeUndefined();

      // Verify actual response is present
      const responseMsg = result.messages.find(m =>
        m.content?.includes('The actual response without thinking')
      );
      expect(responseMsg).toBeDefined();
    });

    it('should include empty messages with attachments', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: '',
          authorUsername: 'alice',
          attachments: new Map([
            [
              'att1',
              {
                id: 'att1',
                url: 'https://cdn.discord.com/attachments/photo.png',
                contentType: 'image/png',
                name: 'photo.png',
                duration: null, // Not a voice message
              },
            ],
          ]),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      // Message should be included even with empty content
      expect(result.messages).toHaveLength(1);
      // Content is empty because attachment descriptions are now handled via imageAttachments
      expect(result.messages[0].content).toBe('');
      // Attachment should be in imageAttachments (for vision processing)
      expect(result.imageAttachments).toHaveLength(1);
      expect(result.imageAttachments?.[0].name).toBe('photo.png');
    });

    it('should use display name for user messages', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorUsername: 'alice_123',
          memberDisplayName: 'Alice',
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.messages[0].content).toBe('Hello');
    });

    it('should use global name when display name is not available', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorUsername: 'alice_123',
          authorGlobalName: 'AliceG',
          memberDisplayName: null,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      // Content has no prefix - personaName has the display name for XML formatting
      expect(result.messages[0].content).toBe('Hello');
      expect(result.messages[0].personaName).toBe('AliceG');
    });

    it('should respect before parameter', async () => {
      const messages = [createMockMessage({ id: '1', content: 'First' })];

      const channel = createMockChannel(messages);

      await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
        before: 'message999',
      });

      expect(channel.messages.fetch).toHaveBeenCalledWith({
        limit: 100,
        before: 'message999',
      });
    });

    it('should handle fetch errors gracefully', async () => {
      const channel = {
        id: 'channel123',
        messages: {
          fetch: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
      } as unknown as TextChannel;

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.messages).toEqual([]);
      expect(result.fetchedCount).toBe(0);
      expect(result.keptCount).toBe(0);
    });
  });

  describe('mergeWithHistory', () => {
    it('should deduplicate messages by Discord ID', () => {
      // Extended messages from Discord no longer have [Name]: prefix
      const extendedMessages = [
        {
          id: 'msg1',
          role: MessageRole.User,
          content: 'Hello from Discord',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'discord:user1',
          personaName: 'Alice',
          discordMessageId: ['discord1'],
          channelId: 'test-channel',
          guildId: 'test-guild',
        },
        {
          id: 'msg2',
          role: MessageRole.User,
          content: 'Also from Discord',
          createdAt: new Date('2024-01-01T12:01:00Z'),
          personaId: 'discord:user2',
          personaName: 'Bob',
          discordMessageId: ['discord2'],
          channelId: 'test-channel',
          guildId: 'test-guild',
        },
      ];

      // DB history may have old format with [Name]: prefix (backward compatibility)
      const dbHistory = [
        {
          id: 'db1',
          role: MessageRole.User,
          content: '[Alice]: Hello from DB',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'persona1',
          discordMessageId: ['discord1'], // Same as first extended message
          channelId: 'test-channel',
          guildId: 'test-guild',
        },
      ];

      const merged = fetcher.mergeWithHistory(extendedMessages, dbHistory);

      // Should have 2 messages: 1 from DB (deduplicated), 1 unique from extended
      expect(merged).toHaveLength(2);
      // DB message should be present (has priority)
      expect(merged.some(m => m.content === '[Alice]: Hello from DB')).toBe(true);
      // Unique extended message should be present
      expect(merged.some(m => m.content === 'Also from Discord')).toBe(true);
      // Duplicate from extended should NOT be present
      expect(merged.some(m => m.content === 'Hello from Discord')).toBe(false);
    });

    it('should sort merged messages by timestamp (oldest first = chronological)', () => {
      // Extended message from Discord (no prefix)
      const extendedMessages = [
        {
          id: 'ext1',
          role: MessageRole.User,
          content: 'Newest',
          createdAt: new Date('2024-01-01T12:05:00Z'),
          personaId: 'discord:user3',
          personaName: 'Charlie',
          discordMessageId: ['discord3'],
          channelId: 'test-channel',
          guildId: 'test-guild',
        },
      ];

      // DB history (may have old format with prefix)
      const dbHistory = [
        {
          id: 'db1',
          role: MessageRole.User,
          content: '[Alice]: Oldest',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'persona1',
          discordMessageId: ['discord1'],
          channelId: 'test-channel',
          guildId: 'test-guild',
        },
        {
          id: 'db2',
          role: MessageRole.User,
          content: '[Bob]: Middle',
          createdAt: new Date('2024-01-01T12:02:00Z'),
          personaId: 'persona2',
          discordMessageId: ['discord2'],
          channelId: 'test-channel',
          guildId: 'test-guild',
        },
      ];

      const merged = fetcher.mergeWithHistory(extendedMessages, dbHistory);

      // Chronological order: oldest first, newest last (LLM recency bias optimization)
      expect(merged[0].content).toBe('[Alice]: Oldest');
      expect(merged[1].content).toBe('[Bob]: Middle');
      expect(merged[2].content).toBe('Newest');
    });

    it('should handle empty extended messages', () => {
      const dbHistory = [
        {
          id: 'db1',
          role: MessageRole.User,
          content: '[Alice]: From DB',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'persona1',
          discordMessageId: ['discord1'],
          channelId: 'test-channel',
          guildId: 'test-guild',
        },
      ];

      const merged = fetcher.mergeWithHistory([], dbHistory);

      expect(merged).toHaveLength(1);
      expect(merged[0].content).toBe('[Alice]: From DB');
    });

    it('should handle empty DB history', () => {
      // Extended message from Discord (no prefix)
      const extendedMessages = [
        {
          id: 'ext1',
          role: MessageRole.User,
          content: 'From Discord',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'discord:user1',
          personaName: 'Alice',
          discordMessageId: ['discord1'],
          channelId: 'test-channel',
          guildId: 'test-guild',
        },
      ];

      const merged = fetcher.mergeWithHistory(extendedMessages, []);

      expect(merged).toHaveLength(1);
      expect(merged[0].content).toBe('From Discord');
    });

    it('should enrich DB messages with reactions from extended context', () => {
      // Extended context message WITH reactions
      const extendedMessages = [
        {
          id: 'ext1',
          role: MessageRole.User,
          content: 'Hello from Discord',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'discord:user1',
          personaName: 'Alice',
          discordMessageId: ['discord1'],
          channelId: 'test-channel',
          guildId: 'test-guild',
          messageMetadata: {
            reactions: [
              {
                emoji: '👍',
                isCustom: false,
                reactors: [{ personaId: 'discord:user2', displayName: 'Bob' }],
              },
            ],
          },
        },
      ];

      // DB message WITHOUT reactions (same message, but stored in DB)
      const dbHistory = [
        {
          id: 'db1',
          role: MessageRole.User,
          content: 'Hello from Discord',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'persona1',
          personaName: 'Alice',
          discordMessageId: ['discord1'], // Same as extended message
          channelId: 'test-channel',
          guildId: 'test-guild',
          // No messageMetadata - reactions not stored in DB
        },
      ];

      const merged = fetcher.mergeWithHistory(extendedMessages, dbHistory);

      // Should have 1 message (deduplicated)
      expect(merged).toHaveLength(1);
      // DB message should have been enriched with reactions
      expect(merged[0].messageMetadata?.reactions).toBeDefined();
      expect(merged[0].messageMetadata?.reactions).toHaveLength(1);
      expect(merged[0].messageMetadata?.reactions?.[0].emoji).toBe('👍');
    });

    it('should enrich DB messages with embeds from extended context', () => {
      // Extended context message with embeds
      const extendedMessages = [
        {
          id: 'ext1',
          role: MessageRole.User,
          content: 'Check this link',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'discord:user1',
          personaName: 'Alice',
          discordMessageId: ['discord1'],
          channelId: 'test-channel',
          guildId: 'test-guild',
          messageMetadata: {
            embedsXml: ['<embed>Link Preview</embed>'],
          },
        },
      ];

      // DB message without embeds
      const dbHistory = [
        {
          id: 'db1',
          role: MessageRole.User,
          content: 'Check this link',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          personaId: 'persona1',
          personaName: 'Alice',
          discordMessageId: ['discord1'],
          channelId: 'test-channel',
          guildId: 'test-guild',
        },
      ];

      const merged = fetcher.mergeWithHistory(extendedMessages, dbHistory);

      // DB message should have been enriched with embeds
      expect(merged[0].messageMetadata?.embedsXml).toBeDefined();
      expect(merged[0].messageMetadata?.embedsXml?.[0]).toBe('<embed>Link Preview</embed>');
    });
  });

  describe('syncWithDatabase', () => {
    // The sync algorithm itself (edit/delete detection, chunk collation,
    // footer stripping, voice-transcript protection) is tested in common-types
    // (conversationSyncDiff). This test covers only the fetcher's delegation.
    it('delegates the observed snapshot to executeDatabaseSync', async () => {
      vi.mocked(executeDatabaseSync).mockResolvedValueOnce({ updated: 1, deleted: 2 });
      const createdAt = new Date('2024-01-01T12:00:00Z');
      const discordMessages = new Collection<string, Message>();
      discordMessages.set(
        'discord1',
        createMockMessage({ id: 'discord1', content: 'Hello', createdAt })
      );

      const result = await fetcher.syncWithDatabase(
        discordMessages,
        'channel123',
        'personality123'
      );

      expect(result).toEqual({ updated: 1, deleted: 2 });
      expect(executeDatabaseSync).toHaveBeenCalledWith(
        discordMessages,
        'channel123',
        'personality123'
      );
    });
  });

  describe('participantGuildInfo', () => {
    it('should collect guild info for user participants', async () => {
      const guildId = 'guild123';
      const joinDate = new Date('2023-06-15T10:00:00Z');

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello from Alice',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          memberRoles: [
            { id: 'role1', name: 'Admin', position: 10 },
            { id: 'role2', name: 'Moderator', position: 5 },
            { id: guildId, name: '@everyone', position: 0 }, // Should be excluded
          ],
          memberDisplayHexColor: '#FF0000',
          memberJoinedAt: joinDate,
          guildId,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.participantGuildInfo).toBeDefined();
      expect(result.participantGuildInfo!['discord:user1']).toEqual({
        roles: ['Admin', 'Moderator'], // Sorted by position, @everyone excluded
        displayColor: '#FF0000',
        joinedAt: joinDate.toISOString(),
      });
    });

    it('should collect guild info for multiple participants', async () => {
      const guildId = 'guild123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          memberRoles: [{ id: 'role1', name: 'Member', position: 1 }],
          memberDisplayHexColor: '#00FF00',
          guildId,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: '2',
          content: 'Hi there',
          authorId: 'user2',
          authorUsername: 'bob',
          memberDisplayName: 'Bob',
          memberRoles: [{ id: 'role2', name: 'VIP', position: 5 }],
          memberDisplayHexColor: '#0000FF',
          guildId,
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.participantGuildInfo).toBeDefined();
      expect(Object.keys(result.participantGuildInfo!)).toHaveLength(2);
      expect(result.participantGuildInfo!['discord:user1'].roles).toContain('Member');
      expect(result.participantGuildInfo!['discord:user2'].roles).toContain('VIP');
    });

    it('should not collect guild info for bot messages', async () => {
      const guildId = 'guild123';
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'User message',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          memberRoles: [{ id: 'role1', name: 'Member', position: 1 }],
          guildId,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: '2',
          content: 'Bot response',
          authorId: botUserId,
          authorUsername: 'TestBot',
          memberDisplayName: 'TestBot',
          memberRoles: [{ id: 'role2', name: 'Bot', position: 3 }],
          isBot: true,
          guildId,
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
      });

      expect(result.participantGuildInfo).toBeDefined();
      // Only user1 should have guild info, not the bot
      expect(Object.keys(result.participantGuildInfo!)).toHaveLength(1);
      expect(result.participantGuildInfo!['discord:user1']).toBeDefined();
      expect(result.participantGuildInfo!['assistant']).toBeUndefined();
    });

    it('should collect guild info only once per participant', async () => {
      const guildId = 'guild123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'First message',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          memberRoles: [{ id: 'role1', name: 'Member', position: 1 }],
          guildId,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: '2',
          content: 'Second message from same user',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          memberRoles: [{ id: 'role1', name: 'Member', position: 1 }],
          guildId,
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.participantGuildInfo).toBeDefined();
      // Should only have one entry for user1
      expect(Object.keys(result.participantGuildInfo!)).toHaveLength(1);
    });

    it('should limit roles to top 5 sorted by position', async () => {
      const guildId = 'guild123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          memberRoles: [
            { id: 'role1', name: 'Role1', position: 1 },
            { id: 'role2', name: 'Role2', position: 2 },
            { id: 'role3', name: 'Role3', position: 3 },
            { id: 'role4', name: 'Role4', position: 4 },
            { id: 'role5', name: 'Role5', position: 5 },
            { id: 'role6', name: 'Role6', position: 6 },
            { id: 'role7', name: 'Role7', position: 7 },
          ],
          guildId,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.participantGuildInfo).toBeDefined();
      const roles = result.participantGuildInfo!['discord:user1'].roles;
      expect(roles).toHaveLength(5);
      // Should be sorted by position (highest first) and limited to 5
      expect(roles).toEqual(['Role7', 'Role6', 'Role5', 'Role4', 'Role3']);
    });

    it('should limit participants to MAX_EXTENDED_CONTEXT_PARTICIPANTS, keeping most recent', async () => {
      const guildId = 'guild123';

      // Create 25 messages from 25 different users (exceeds limit of 20)
      const messages = [];
      for (let i = 1; i <= 25; i++) {
        messages.push(
          createMockMessage({
            id: String(i),
            content: `Message from user ${i}`,
            authorId: `user${i}`,
            authorUsername: `user${i}`,
            memberDisplayName: `User ${i}`,
            memberRoles: [{ id: `role${i}`, name: `Role${i}`, position: 1 }],
            guildId,
            // Spread over time so ordering is clear
            createdAt: new Date(`2024-01-01T12:${String(i).padStart(2, '0')}:00Z`),
          })
        );
      }

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.participantGuildInfo).toBeDefined();
      const participantIds = Object.keys(result.participantGuildInfo!);

      // Should be limited to 20 participants
      expect(participantIds).toHaveLength(20);

      // Should keep the most recent 20 (users 6-25, not 1-20)
      // Most recent users are those closest to the triggering message
      expect(participantIds).not.toContain('discord:user1');
      expect(participantIds).not.toContain('discord:user5');
      expect(participantIds).toContain('discord:user6');
      expect(participantIds).toContain('discord:user25');
    });

    it('should not include displayColor if it is #000000', async () => {
      const guildId = 'guild123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          memberRoles: [{ id: 'role1', name: 'Member', position: 1 }],
          memberDisplayHexColor: '#000000', // Transparent/default
          guildId,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.participantGuildInfo).toBeDefined();
      expect(result.participantGuildInfo!['discord:user1'].displayColor).toBeUndefined();
    });

    it('should return undefined participantGuildInfo when no users with guild info', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorId: 'user1',
          authorUsername: 'alice',
          // No member info (DM or unavailable)
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.participantGuildInfo).toBeUndefined();
    });
  });

  describe('voice transcript fallback', () => {
    it('should use DB transcript when available', async () => {
      // Voice message with a bot transcript reply in channel
      const voiceMessageId = 'voice-msg-1';
      const messages = [
        createMockMessage({
          id: voiceMessageId,
          content: '',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          attachments: new Map([
            [
              'att1',
              {
                id: 'att1',
                url: 'https://cdn.discord.com/voice-message.ogg',
                contentType: 'audio/ogg',
                name: 'voice-message.ogg',
                duration: 5, // Has duration = voice message
                waveform: 'abc',
              },
            ],
          ]),
        }),
        // Bot transcript reply
        createMockMessage({
          id: 'transcript-reply-1',
          content: 'Fallback transcript from bot reply',
          authorId: 'bot123',
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:01Z'),
          reference: { messageId: voiceMessageId },
        }),
      ];

      const channel = createMockChannel(messages);

      // DB returns transcript - should use DB, not fallback
      const getTranscript = vi.fn().mockResolvedValue('DB transcript content');

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
        getTranscript,
      });

      // Should have 1 message (voice message with transcript, bot reply filtered)
      expect(result.keptCount).toBe(1);
      // Voice transcripts are now in messageMetadata for structured XML formatting
      expect(result.messages[0].messageMetadata?.voiceTranscripts).toContain(
        'DB transcript content'
      );
      // Fallback transcript should not appear
      expect(result.messages[0].messageMetadata?.voiceTranscripts?.join('') ?? '').not.toContain(
        'Fallback transcript'
      );
      // Resolved transcript ⇒ no re-resolution ref shipped to the worker.
      expect(result.voiceAttachments ?? []).toHaveLength(0);
    });

    it('ships a voice attachment ref when the transcript could not be resolved', async () => {
      const voiceMessageId = 'voice-unresolved-1';
      const messages = [
        createMockMessage({
          id: voiceMessageId,
          content: '',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          attachments: new Map([
            [
              'att1',
              {
                id: 'att1',
                url: 'https://cdn.discord.com/voice-message.ogg',
                contentType: 'audio/ogg',
                name: 'voice-message.ogg',
                duration: 5,
                waveform: 'abc',
              },
            ],
          ]),
        }),
      ];
      const channel = createMockChannel(messages);
      // No DB transcript, no bot reply in window ⇒ unresolved.
      const getTranscript = vi.fn().mockResolvedValue(null);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
        getTranscript,
      });

      expect(result.messages[0].messageMetadata?.voiceTranscripts ?? []).toHaveLength(0);
      // The worker re-resolves these (DB-first, STT-fallback).
      expect(result.voiceAttachments).toHaveLength(1);
      expect(result.voiceAttachments?.[0].sourceDiscordMessageId).toBe(voiceMessageId);
      expect(result.voiceAttachments?.[0].isVoiceMessage).toBe(true);
    });

    it('should fall back to bot reply when DB returns null', async () => {
      const voiceMessageId = 'voice-msg-1';
      const messages = [
        createMockMessage({
          id: voiceMessageId,
          content: '',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          attachments: new Map([
            [
              'att1',
              {
                id: 'att1',
                url: 'https://cdn.discord.com/voice-message.ogg',
                contentType: 'audio/ogg',
                name: 'voice-message.ogg',
                duration: 5,
                waveform: 'abc',
              },
            ],
          ]),
        }),
        // Bot transcript reply
        createMockMessage({
          id: 'transcript-reply-1',
          content: 'Fallback transcript from bot reply',
          authorId: 'bot123',
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:01Z'),
          reference: { messageId: voiceMessageId },
        }),
      ];

      const channel = createMockChannel(messages);

      // DB returns null - should fall back to bot reply
      const getTranscript = vi.fn().mockResolvedValue(null);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
        getTranscript,
      });

      expect(result.keptCount).toBe(1);
      // Voice transcripts are now in messageMetadata for structured XML formatting
      expect(result.messages[0].messageMetadata?.voiceTranscripts).toContain(
        'Fallback transcript from bot reply'
      );
    });

    it('should fall back to bot reply when DB returns empty string', async () => {
      const voiceMessageId = 'voice-msg-1';
      const messages = [
        createMockMessage({
          id: voiceMessageId,
          content: '',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          attachments: new Map([
            [
              'att1',
              {
                id: 'att1',
                url: 'https://cdn.discord.com/voice-message.ogg',
                contentType: 'audio/ogg',
                name: 'voice-message.ogg',
                duration: 5,
                waveform: 'abc',
              },
            ],
          ]),
        }),
        // Bot transcript reply
        createMockMessage({
          id: 'transcript-reply-1',
          content: 'Fallback from empty DB',
          authorId: 'bot123',
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:01Z'),
          reference: { messageId: voiceMessageId },
        }),
      ];

      const channel = createMockChannel(messages);

      // DB returns empty string (corrupted data) - should fall back to bot reply
      const getTranscript = vi.fn().mockResolvedValue('');

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
        getTranscript,
      });

      expect(result.keptCount).toBe(1);
      // Voice transcripts are now in messageMetadata for structured XML formatting
      expect(result.messages[0].messageMetadata?.voiceTranscripts).toContain(
        'Fallback from empty DB'
      );
    });

    it('should return null transcript when neither DB nor fallback available', async () => {
      const voiceMessageId = 'voice-msg-1';
      const messages = [
        createMockMessage({
          id: voiceMessageId,
          content: '',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          attachments: new Map([
            [
              'att1',
              {
                id: 'att1',
                url: 'https://cdn.discord.com/voice-message.ogg',
                contentType: 'audio/ogg',
                name: 'voice-message.ogg',
                duration: 5,
                waveform: 'abc',
              },
            ],
          ]),
        }),
        // NO bot transcript reply in channel
      ];

      const channel = createMockChannel(messages);

      // DB returns null, no bot reply available
      const getTranscript = vi.fn().mockResolvedValue(null);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
        getTranscript,
      });

      // Message should still be included (has attachment) but content may be empty/minimal
      expect(result.keptCount).toBe(1);
      // The voice message attachment is processed but has no transcript
      expect(result.messages[0].content).not.toContain('transcript');
    });

    it('should use fallback when no getTranscript function provided', async () => {
      const voiceMessageId = 'voice-msg-1';
      const messages = [
        createMockMessage({
          id: voiceMessageId,
          content: '',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          attachments: new Map([
            [
              'att1',
              {
                id: 'att1',
                url: 'https://cdn.discord.com/voice-message.ogg',
                contentType: 'audio/ogg',
                name: 'voice-message.ogg',
                duration: 5,
                waveform: 'abc',
              },
            ],
          ]),
        }),
        // Bot transcript reply
        createMockMessage({
          id: 'transcript-reply-1',
          content: 'Fallback when no DB function',
          authorId: 'bot123',
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:01Z'),
          reference: { messageId: voiceMessageId },
        }),
      ];

      const channel = createMockChannel(messages);

      // No getTranscript provided - should use fallback
      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
        // No getTranscript option
      });

      expect(result.keptCount).toBe(1);
      // Voice transcripts are now in messageMetadata for structured XML formatting
      expect(result.messages[0].messageMetadata?.voiceTranscripts).toContain(
        'Fallback when no DB function'
      );
    });

    it('should not use empty bot reply as fallback', async () => {
      const voiceMessageId = 'voice-msg-1';
      const messages = [
        createMockMessage({
          id: voiceMessageId,
          content: '',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          attachments: new Map([
            [
              'att1',
              {
                id: 'att1',
                url: 'https://cdn.discord.com/voice-message.ogg',
                contentType: 'audio/ogg',
                name: 'voice-message.ogg',
                duration: 5,
                waveform: 'abc',
              },
            ],
          ]),
        }),
        // Bot reply with empty content (shouldn't be used as fallback)
        createMockMessage({
          id: 'bot-reply-empty',
          content: '',
          authorId: 'bot123',
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:01Z'),
          reference: { messageId: voiceMessageId },
          attachments: new Map([
            [
              'img1',
              {
                id: 'img1',
                url: 'https://cdn.discord.com/image.png',
                contentType: 'image/png',
                name: 'image.png',
                duration: null,
              },
            ],
          ]),
        }),
      ];

      const channel = createMockChannel(messages);

      const getTranscript = vi.fn().mockResolvedValue(null);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
        getTranscript,
      });

      // Voice message included (has attachment), bot reply with image also included
      // but no transcript should be in the content
      expect(result.keptCount).toBe(2);
    });
  });

  describe('release-notes DM filtering', () => {
    it('should filter out release DMs but keep a user quoting the footer', async () => {
      const footerText = OPT_OUT_FOOTER.trimStart();
      const messages = [
        // Bot-authored release DM (should be FILTERED OUT — otherwise it
        // classifies as a relay-echo and enters context as user speech)
        createMockMessage({
          id: 'release-dm-1',
          content: `## v3.0.0 released!\nNew stuff.\n\n${footerText}`,
          authorId: 'bot123',
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:01Z'),
        }),
        // A user quoting the footer text (should be INCLUDED — author gate)
        createMockMessage({
          id: 'user-msg-1',
          content: `what does ${footerText} mean?`,
          authorId: 'user2',
          authorUsername: 'bob',
          createdAt: new Date('2024-01-01T12:00:02Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.keptCount).toBe(1);
      expect(result.messages.some(m => m.content.includes('v3.0.0 released'))).toBe(false);
      expect(result.messages.some(m => m.content.includes('what does'))).toBe(true);
    });
  });

  describe('bot transcript reply filtering', () => {
    it('should filter out bot transcript replies from extended context', async () => {
      // Bot transcript replies are: bot message + reply reference + has text content
      // They should be filtered out because transcripts are retrieved via TranscriptRetriever
      const messages = [
        // Bot transcript reply (should be FILTERED OUT)
        createMockMessage({
          id: 'transcript-reply-1',
          content: 'This is the transcript of the voice message',
          authorId: 'bot123', // From the bot
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:01Z'),
          reference: { messageId: 'voice-msg-1' }, // Replying to voice message
        }),
        // Regular user message (should be included)
        createMockMessage({
          id: 'user-msg-1',
          content: 'Hello everyone!',
          authorId: 'user2',
          authorUsername: 'bob',
          createdAt: new Date('2024-01-01T12:00:02Z'),
        }),
        // Bot response NOT a reply (should be included)
        createMockMessage({
          id: 'bot-response-1',
          content: 'Hi there! How can I help?',
          authorId: 'bot123',
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:03Z'),
          // No reference - not a reply
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      // Should have 2 messages (user msg, bot response)
      // Should NOT have transcript reply
      expect(result.keptCount).toBe(2);
      expect(result.messages.some(m => m.content.includes('transcript of the voice'))).toBe(false);
      expect(result.messages.some(m => m.content.includes('Hello everyone'))).toBe(true);
      expect(result.messages.some(m => m.content.includes('How can I help'))).toBe(true);
    });

    it('should NOT filter bot messages without reply reference', async () => {
      // Bot messages without a reply reference are normal responses, not transcript replies
      const messages = [
        createMockMessage({
          id: 'bot-msg-1',
          content: 'I am a bot response without reply reference',
          authorId: 'bot123',
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:00Z'),
          // No reference
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.keptCount).toBe(1);
      expect(result.messages[0].content).toContain('bot response without reply reference');
    });

    it('should NOT filter bot reply messages with empty content', async () => {
      // Bot reply without text content (e.g., just an attachment) is not a transcript reply
      const messages = [
        createMockMessage({
          id: 'bot-reply-1',
          content: '', // Empty content
          authorId: 'bot123',
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:00Z'),
          reference: { messageId: 'some-msg' },
          attachments: new Map([
            [
              '1',
              {
                id: '1',
                url: 'https://cdn.discord.com/attachments/image.png',
                contentType: 'image/png',
                name: 'image.png',
                duration: null, // Not a voice message
              },
            ],
          ]),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      // Should still be included (has attachment, not a text transcript reply)
      expect(result.keptCount).toBe(1);
    });

    it('should NOT filter user reply messages', async () => {
      // User replies with text content should NOT be filtered (only bot transcript replies)
      const messages = [
        createMockMessage({
          id: 'user-reply-1',
          content: 'This is a user reply to something',
          authorId: 'user1',
          authorUsername: 'alice',
          isBot: false,
          createdAt: new Date('2024-01-01T12:00:00Z'),
          reference: { messageId: 'some-msg' },
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.keptCount).toBe(1);
      expect(result.messages[0].content).toContain('user reply');
    });
  });

  describe('extendedContextUsers', () => {
    it('should collect user info from non-bot messages', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello from Alice',
          authorId: 'user1',
          authorUsername: 'alice',
          authorGlobalName: 'Alice Global',
          memberDisplayName: 'Alice Display',
          isBot: false,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: '2',
          content: 'Hello from Bob',
          authorId: 'user2',
          authorUsername: 'bob',
          memberDisplayName: 'Bob Display',
          isBot: false,
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.extendedContextUsers).toBeDefined();
      expect(result.extendedContextUsers).toHaveLength(2);

      const alice = result.extendedContextUsers?.find(u => u.discordId === 'user1');
      expect(alice).toBeDefined();
      expect(alice!.username).toBe('alice');
      expect(alice!.displayName).toBe('Alice Display');
      expect(alice!.isBot).toBe(false);

      const bob = result.extendedContextUsers?.find(u => u.discordId === 'user2');
      expect(bob).toBeDefined();
      expect(bob!.username).toBe('bob');
      expect(bob!.displayName).toBe('Bob Display');
    });

    it('should not include bot users', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'User message',
          authorId: 'user1',
          authorUsername: 'alice',
          isBot: false,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: '2',
          content: 'Bot response',
          authorId: botUserId,
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
      });

      expect(result.extendedContextUsers).toBeDefined();
      expect(result.extendedContextUsers).toHaveLength(1);
      expect(result.extendedContextUsers![0].discordId).toBe('user1');
    });

    it('should deduplicate users appearing in multiple messages', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'First message from Alice',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          isBot: false,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: '2',
          content: 'Second message from Alice',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          isBot: false,
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
        createMockMessage({
          id: '3',
          content: 'Third message from Alice',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          isBot: false,
          createdAt: new Date('2024-01-01T12:02:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.extendedContextUsers).toBeDefined();
      expect(result.extendedContextUsers).toHaveLength(1);
      expect(result.extendedContextUsers![0].discordId).toBe('user1');
    });

    it('should use global name as displayName when member display name unavailable', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorId: 'user1',
          authorUsername: 'alice',
          authorGlobalName: 'Alice Global',
          memberDisplayName: null, // No server-specific display name
          isBot: false,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.extendedContextUsers).toBeDefined();
      expect(result.extendedContextUsers![0].displayName).toBe('Alice Global');
    });

    it('should return undefined when no valid users', async () => {
      const botUserId = 'bot123';

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Bot message only',
          authorId: botUserId,
          authorUsername: 'TestBot',
          isBot: true,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId,
      });

      // No valid users (only bot), so extendedContextUsers should be undefined or empty
      expect(
        result.extendedContextUsers === undefined || result.extendedContextUsers.length === 0
      ).toBe(true);
    });
  });

  describe('extractReactions', () => {
    it('should extract reactions with unicode emojis', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          { id: 'user1', username: 'alice', displayName: 'Alice', bot: false },
          { id: 'user2', username: 'bob', displayName: 'Bob', bot: false },
        ])
      );

      const msg = createMockMessage({
        id: 'msg1',
        content: 'Great news!',
        reactions,
      });

      const result = await fetcher.extractReactions(msg);

      expect(result).toHaveLength(1);
      expect(result[0].emoji).toBe('👍');
      expect(result[0].isCustom).toBe(false);
      expect(result[0].reactors).toHaveLength(2);
      expect(result[0].reactors[0].personaId).toBe('discord:user1');
      expect(result[0].reactors[0].displayName).toBe('Alice');
      expect(result[0].reactors[1].personaId).toBe('discord:user2');
      expect(result[0].reactors[1].displayName).toBe('Bob');
    });

    it('should extract reactions with custom emojis', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        'custom123',
        createMockReaction({ id: 'custom123', name: 'pepe' }, [
          { id: 'user1', username: 'alice', displayName: 'Alice', bot: false },
        ])
      );

      const msg = createMockMessage({
        id: 'msg1',
        content: 'Funny meme',
        reactions,
      });

      const result = await fetcher.extractReactions(msg);

      expect(result).toHaveLength(1);
      expect(result[0].emoji).toBe(':pepe:');
      expect(result[0].isCustom).toBe(true);
      expect(result[0].reactors).toHaveLength(1);
    });

    it('should exclude bot reactions', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          { id: 'user1', username: 'alice', displayName: 'Alice', bot: false },
          { id: 'bot1', username: 'SomeBot', displayName: 'SomeBot', bot: true },
        ])
      );

      const msg = createMockMessage({
        id: 'msg1',
        content: 'Hello',
        reactions,
      });

      const result = await fetcher.extractReactions(msg);

      expect(result).toHaveLength(1);
      expect(result[0].reactors).toHaveLength(1);
      expect(result[0].reactors[0].displayName).toBe('Alice');
    });

    it('should skip reactions with only bot reactors', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '🤖',
        createMockReaction({ id: null, name: '🤖' }, [
          { id: 'bot1', username: 'Bot1', displayName: 'Bot1', bot: true },
          { id: 'bot2', username: 'Bot2', displayName: 'Bot2', bot: true },
        ])
      );

      const msg = createMockMessage({
        id: 'msg1',
        content: 'Hello',
        reactions,
      });

      const result = await fetcher.extractReactions(msg);

      expect(result).toHaveLength(0);
    });

    it('should limit reactions to MAX_REACTIONS_PER_MESSAGE', async () => {
      // Create 5 reactions (more than limit of 3)
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          { id: 'user1', username: 'alice', bot: false },
        ])
      );
      reactions.set(
        '👎',
        createMockReaction({ id: null, name: '👎' }, [{ id: 'user2', username: 'bob', bot: false }])
      );
      reactions.set(
        '❤️',
        createMockReaction({ id: null, name: '❤️' }, [
          { id: 'user3', username: 'carol', bot: false },
        ])
      );
      reactions.set(
        '🎉',
        createMockReaction({ id: null, name: '🎉' }, [
          { id: 'user4', username: 'dave', bot: false },
        ])
      );
      reactions.set(
        '🚀',
        createMockReaction({ id: null, name: '🚀' }, [{ id: 'user5', username: 'eve', bot: false }])
      );

      const msg = createMockMessage({
        id: 'msg1',
        content: 'Popular message',
        reactions,
      });

      const result = await fetcher.extractReactions(msg);

      // Should only have 3 reactions (MAX_REACTIONS_PER_MESSAGE)
      expect(result).toHaveLength(3);
    });

    it('should limit users per reaction to MAX_USERS_PER_REACTION', async () => {
      // Create 10 users (more than limit of 5)
      const users: MockReactorUser[] = [];
      for (let i = 1; i <= 10; i++) {
        users.push({ id: `user${i}`, username: `user${i}`, displayName: `User ${i}`, bot: false });
      }

      const reactions = new Map<string, MockReaction>();
      reactions.set('👍', createMockReaction({ id: null, name: '👍' }, users));

      const msg = createMockMessage({
        id: 'msg1',
        content: 'Very popular message',
        reactions,
      });

      const result = await fetcher.extractReactions(msg);

      expect(result).toHaveLength(1);
      // Should only have 5 reactors (MAX_USERS_PER_REACTION)
      expect(result[0].reactors).toHaveLength(5);
    });

    it('should use username as displayName when displayName not available', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          { id: 'user1', username: 'alice_123', bot: false }, // No displayName
        ])
      );

      const msg = createMockMessage({
        id: 'msg1',
        content: 'Hello',
        reactions,
      });

      const result = await fetcher.extractReactions(msg);

      expect(result[0].reactors[0].displayName).toBe('alice_123');
    });

    it('should handle reaction user fetch errors gracefully', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set('👍', {
        emoji: { id: null, name: '👍' },
        users: {
          fetch: vi.fn().mockRejectedValue(new Error('Discord API error')),
        },
      });
      reactions.set(
        '❤️',
        createMockReaction({ id: null, name: '❤️' }, [
          { id: 'user1', username: 'alice', displayName: 'Alice', bot: false },
        ])
      );

      const msg = createMockMessage({
        id: 'msg1',
        content: 'Hello',
        reactions,
      });

      const result = await fetcher.extractReactions(msg);

      // Should skip the failed reaction but include the successful one
      expect(result).toHaveLength(1);
      expect(result[0].emoji).toBe('❤️');
    });

    it('should return empty array for messages with no reactions', async () => {
      const msg = createMockMessage({
        id: 'msg1',
        content: 'Hello',
        // No reactions
      });

      const result = await fetcher.extractReactions(msg);

      expect(result).toHaveLength(0);
    });
  });

  describe('collectReactorUsers', () => {
    it('should collect unique reactor users from reactions', () => {
      const reactions = [
        {
          emoji: '👍',
          isCustom: false,
          reactors: [
            { personaId: 'discord:user1', displayName: 'Alice' },
            { personaId: 'discord:user2', displayName: 'Bob' },
          ],
        },
        {
          emoji: '❤️',
          isCustom: false,
          reactors: [
            { personaId: 'discord:user1', displayName: 'Alice' }, // Duplicate
            { personaId: 'discord:user3', displayName: 'Carol' },
          ],
        },
      ];

      const existingUsers = new Set<string>();
      const result = fetcher.collectReactorUsers(reactions, existingUsers);

      expect(result).toHaveLength(3);
      expect(result.map(u => u.discordId).sort()).toEqual(['user1', 'user2', 'user3']);
    });

    it('should dedupe with existing users', () => {
      const reactions = [
        {
          emoji: '👍',
          isCustom: false,
          reactors: [
            { personaId: 'discord:user1', displayName: 'Alice' },
            { personaId: 'discord:user2', displayName: 'Bob' },
          ],
        },
      ];

      // user1 already exists in extended context
      const existingUsers = new Set(['user1']);
      const result = fetcher.collectReactorUsers(reactions, existingUsers);

      // Should only have user2 (user1 already exists)
      expect(result).toHaveLength(1);
      expect(result[0].discordId).toBe('user2');
    });

    it('should return empty array when all users already exist', () => {
      const reactions = [
        {
          emoji: '👍',
          isCustom: false,
          reactors: [{ personaId: 'discord:user1', displayName: 'Alice' }],
        },
      ];

      const existingUsers = new Set(['user1']);
      const result = fetcher.collectReactorUsers(reactions, existingUsers);

      expect(result).toHaveLength(0);
    });
  });

  describe('reaction integration with fetchRecentMessages', () => {
    it('should attach reactions to messages in fetchRecentMessages result', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          { id: 'user2', username: 'bob', displayName: 'Bob', bot: false },
        ])
      );

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          reactions,
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].messageMetadata?.reactions).toBeDefined();
      expect(result.messages[0].messageMetadata?.reactions).toHaveLength(1);
      expect(result.messages[0].messageMetadata?.reactions?.[0].emoji).toBe('👍');
      expect(result.messages[0].messageMetadata?.reactions?.[0].reactors[0].displayName).toBe(
        'Bob'
      );
    });

    it('should collect reactor users separate from extended context users', async () => {
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          // Reactor not in message authors
          { id: 'user3', username: 'carol', displayName: 'Carol', bot: false },
        ])
      );

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          reactions,
        }),
        createMockMessage({
          id: '2',
          content: 'Hi there',
          authorId: 'user2',
          authorUsername: 'bob',
          memberDisplayName: 'Bob',
          createdAt: new Date('2024-01-01T12:01:00Z'),
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      // Extended context users should have alice and bob (message authors)
      expect(result.extendedContextUsers).toHaveLength(2);
      expect(result.extendedContextUsers?.map(u => u.discordId).sort()).toEqual(['user1', 'user2']);

      // Reactor users should have carol (reacted but didn't author messages)
      expect(result.reactorUsers).toHaveLength(1);
      expect(result.reactorUsers?.[0].discordId).toBe('user3');
    });

    it('should dedupe reactor users with extended context users', async () => {
      // User1 is both a message author AND a reactor
      const reactions = new Map<string, MockReaction>();
      reactions.set(
        '👍',
        createMockReaction({ id: null, name: '👍' }, [
          { id: 'user1', username: 'alice', displayName: 'Alice', bot: false },
        ])
      );

      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello from Alice',
          authorId: 'user1',
          authorUsername: 'alice',
          memberDisplayName: 'Alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        }),
        createMockMessage({
          id: '2',
          content: 'Another message',
          authorId: 'user2',
          authorUsername: 'bob',
          memberDisplayName: 'Bob',
          createdAt: new Date('2024-01-01T12:01:00Z'),
          reactions, // user1 reacted to this
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      // Alice is in extended context users (message author)
      expect(result.extendedContextUsers?.some(u => u.discordId === 'user1')).toBe(true);

      // Alice should NOT be in reactor users (already in extended context)
      // reactorUsers may be undefined if all reactors are already in extended context
      const hasUser1InReactors = result.reactorUsers?.some(u => u.discordId === 'user1') ?? false;
      expect(hasUser1InReactors).toBe(false);
    });

    it('should only extract reactions from last MAX_REACTION_MESSAGES messages', async () => {
      // Create 10 messages, only last 5 should have reactions extracted
      const messages = [];
      for (let i = 1; i <= 10; i++) {
        const reactions = new Map<string, MockReaction>();
        // Each message has a unique reactor
        reactions.set(
          '👍',
          createMockReaction({ id: null, name: '👍' }, [
            { id: `reactor${i}`, username: `reactor${i}`, displayName: `Reactor ${i}`, bot: false },
          ])
        );

        messages.push(
          createMockMessage({
            id: String(i),
            content: `Message ${i}`,
            authorId: `user${i}`,
            authorUsername: `user${i}`,
            memberDisplayName: `User ${i}`,
            createdAt: new Date(`2024-01-01T12:${String(i).padStart(2, '0')}:00Z`),
            reactions,
          })
        );
      }

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      // Reactor users should only be from last 5 messages (6-10)
      // And dedupe with extended context users
      const reactorIds = result.reactorUsers?.map(u => u.discordId) ?? [];
      // Reactors 1-5 should NOT be in reactor users (from older messages)
      expect(reactorIds).not.toContain('reactor1');
      expect(reactorIds).not.toContain('reactor5');
    });

    it('should return undefined reactorUsers when no reactions', async () => {
      const messages = [
        createMockMessage({
          id: '1',
          content: 'Hello',
          authorId: 'user1',
          authorUsername: 'alice',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          // No reactions
        }),
      ];

      const channel = createMockChannel(messages);

      const result = await fetcher.fetchRecentMessages(channel, {
        botUserId: 'bot123',
      });

      // No reactions, so reactorUsers should be undefined
      expect(result.reactorUsers).toBeUndefined();
    });
  });
});
