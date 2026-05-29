/**
 * Tests for Character Chat Command Handler (push-delivery model)
 *
 * Behaviors:
 * - Resolves personality / fails on unknown character
 * - Validates channel; accepts GuildText, threads, AND DM (push delivery
 *   replaces the old webhook-only restriction)
 * - Sends user message in chat mode + persists via fields-API
 * - Submits gateway job + registers slash JobTracker context
 * - Weigh-in mode: skips user-message send, anchors on latest channel msg,
 *   sets context flags, requires non-empty conversation history
 * - Random-pick mode: finalizeDeferredReply replaces the deferred indicator
 * - Errors fall through to handleChatError
 *
 * Result delivery is tested in MessageHandler.handleSlashJobResult — chat.ts
 * no longer awaits the job.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleChat } from './chat.js';
import type { GuildMember } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const mockGatewayClient = {
  generate: vi.fn(),
};

const mockJobTracker = {
  trackJob: vi.fn(),
};

const mockPersonalityService = {
  loadPersonality: vi.fn(),
};

const mockMessageContextBuilder = {
  buildContext: vi.fn(),
};

const mockConversationPersistence = {
  saveUserMessageFromFields: vi.fn().mockResolvedValue(undefined),
};

const mockPersonaResolver = {
  resolve: vi.fn().mockResolvedValue({
    config: { personaId: 'persona-123', preferredName: null },
  }),
};

vi.mock('../../services/serviceRegistry.js', () => ({
  getGatewayClient: () => mockGatewayClient,
  getPersonalityService: () => mockPersonalityService,
  getMessageContextBuilder: () => mockMessageContextBuilder,
  getConversationPersistence: () => mockConversationPersistence,
  getPersonaResolver: () => mockPersonaResolver,
  getJobTracker: () => mockJobTracker,
}));

const mockGetCachedPersonalities = vi.fn();
vi.mock('../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

// Mock clientsFor — the cache + persona resolution mocks return data
// directly, so a structurally empty userClient stub suffices.
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} })),
}));

vi.mock('../../redis.js', () => ({
  redisService: { storeWebhookMessage: vi.fn() },
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Character Chat Handler (push delivery)', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  const createMockMessage = (id: string = 'user-msg-123') => ({
    id,
    client: { user: { id: 'bot-user-123' } },
    channel: { id: 'channel-123' },
    author: { id: 'user-123' },
  });

  const createMockCollection = (entries: Array<[string, ReturnType<typeof createMockMessage>]>) => {
    const map = new Map(entries);
    return {
      ...map,
      first: () => (entries.length > 0 ? entries[0][1] : undefined),
      size: entries.length,
    };
  };

  const createMockChannel = (type: ChannelType = ChannelType.GuildText) => {
    const sentMessage = createMockMessage();
    return {
      type,
      id: 'channel-123',
      name: 'test-channel',
      send: vi.fn().mockResolvedValue(sentMessage),
      sendTyping: vi.fn().mockResolvedValue(undefined),
      messages: {
        fetch: vi
          .fn()
          .mockResolvedValue(
            createMockCollection([['latest-msg', createMockMessage('latest-msg')]])
          ),
      },
    };
  };

  const createMockGuild = () => ({ id: 'guild-123', name: 'Test Guild' });

  const createMockContext = (
    characterSlug: string | null,
    message: string | null,
    channel = createMockChannel(),
    guild: { id: string; name: string } | null = createMockGuild()
  ): DeferredCommandContext => {
    const mockMember = { displayName: 'TestUser' } as GuildMember;
    const mockUser = { id: 'user-123', displayName: 'TestUser' };

    const mockInteraction = {
      client: { user: { id: 'bot-user-123' } },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'character') return characterSlug;
          if (name === 'message') return message;
          return null;
        }),
        getBoolean: vi.fn(() => null),
      },
      replied: false,
      deferred: true,
    };

    return {
      interaction: mockInteraction,
      user: mockUser,
      member: guild ? mockMember : null,
      guild,
      guildId: guild?.id ?? null,
      channel,
      isEphemeral: false,
      editReply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeferredCommandContext;
  };

  const createMockPersonality = (overrides = {}) => ({
    id: 'pers-123',
    name: 'test-char',
    displayName: 'Test Character',
    slug: 'test-char',
    systemPrompt: 'You are a test character.',
    model: 'anthropic/claude-3.5-sonnet',
    provider: 'openrouter',
    ...overrides,
  });

  const createMockContextBuildResult = (overrides: { conversationHistory?: unknown[] } = {}) => ({
    context: {
      user: { discordId: 'user-123', username: 'testuser', displayName: 'testuser' },
      channelId: 'channel-123',
      serverId: 'guild-123',
      messageContent: 'Hello!',
      conversationHistory: overrides.conversationHistory ?? [],
      environment: {
        type: 'guild' as const,
        guild: { id: 'guild-123', name: 'Test Guild' },
        channel: { id: 'channel-123', name: 'test-channel', type: 'text' },
      },
    },
    personaId: 'persona-123',
    personaName: null,
    messageContent: 'Hello!',
    referencedMessages: [],
    conversationHistory: overrides.conversationHistory ?? [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockMessageContextBuilder.buildContext.mockResolvedValue(createMockContextBuildResult());
    mockPersonaResolver.resolve.mockResolvedValue({
      config: { personaId: 'persona-123', preferredName: null },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('character resolution + channel validation', () => {
    it('returns "not found" when personality lookup fails', async () => {
      const ctx = createMockContext('nonexistent', 'Hello!');
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      await handleChat(ctx, mockConfig);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('rejects voice channels', async () => {
      const voiceChannel = createMockChannel(ChannelType.GuildVoice);
      const ctx = createMockContext('test-char', 'Hello!', voiceChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());

      await handleChat(ctx, mockConfig);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('channel type is not supported'),
      });
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('accepts GuildText channels', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hello!', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx, mockConfig);

      expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('Hello!'));
      // Deferred reply must be resolved (deleted) so "Bot is thinking..." doesn't
      // sit in the channel until interaction-token expiry. Non-random pick path
      // delegates this to finalizeDeferredReply, which calls deleteReply.
      expect(ctx.deleteReply).toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          kind: 'slash',
          channel,
          characterSlug: 'test-char',
          isWeighInMode: false,
        })
      );
    });

    it('accepts public threads', async () => {
      const channel = createMockChannel(ChannelType.PublicThread);
      const ctx = createMockContext('test-char', 'Hello!', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx, mockConfig);

      expect(mockJobTracker.trackJob).toHaveBeenCalled();
    });

    it('accepts DM channels (push delivery removes the webhook-only restriction)', async () => {
      const channel = createMockChannel(ChannelType.DM);
      const ctx = createMockContext('test-char', 'Hello!', channel, null);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx, mockConfig);

      expect(channel.send).toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          kind: 'slash',
          channel,
          guildId: null,
        })
      );
    });
  });

  describe('chat mode (with message)', () => {
    it('sends user message and persists via the fields-API', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi there', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx, mockConfig);

      expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('Hi there'));
      expect(mockConversationPersistence.saveUserMessageFromFields).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-123',
          messageContent: 'Hi there',
          personaId: 'persona-123',
        })
      );
    });

    it('uses preferredName when persona has one', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });
      mockPersonaResolver.resolve.mockResolvedValueOnce({
        config: { personaId: 'persona-123', preferredName: 'Cool Name' },
      });

      await handleChat(ctx, mockConfig);

      expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('**Cool Name:**'));
    });

    it('passes triggerMessageId to gateway.generate', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx, mockConfig);

      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ triggerMessageId: expect.any(String) })
      );
    });
  });

  describe('weigh-in mode (no message)', () => {
    it('does not send a user message in weigh-in mode', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', null, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockMessageContextBuilder.buildContext.mockResolvedValueOnce(
        createMockContextBuildResult({ conversationHistory: [{ id: 'msg-1' }] })
      );
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });

      await handleChat(ctx, mockConfig);

      // The only send should be from a possible error path — the user message
      // send path is gated on isWeighInMode === false.
      expect(channel.send).not.toHaveBeenCalled();
      expect(mockConversationPersistence.saveUserMessageFromFields).not.toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: 'slash', channel, isWeighInMode: true })
      );
    });

    it('errors out when conversation history is empty', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      // Empty channel: messages.fetch returns empty
      channel.messages.fetch = vi.fn().mockResolvedValue(createMockCollection([]));
      const ctx = createMockContext('test-char', null, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());

      await handleChat(ctx, mockConfig);

      expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('No conversation history'));
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('errors out when buildContext returns null history (build adjusted to weigh-in)', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', null, channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      // buildContext default returns empty history → adjustContextForWeighInMode returns false
      mockMessageContextBuilder.buildContext.mockResolvedValueOnce(createMockContextBuildResult());

      await handleChat(ctx, mockConfig);

      expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('No conversation history'));
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('replies with a generic error when the personality lookup throws', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi', channel);
      mockPersonalityService.loadPersonality.mockRejectedValueOnce(new Error('boom'));

      await handleChat(ctx, mockConfig);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('something went wrong'),
      });
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('replies with a generic error when gateway.generate throws', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext('test-char', 'Hi', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockRejectedValueOnce(new Error('gateway down'));

      await handleChat(ctx, mockConfig);

      expect(ctx.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('something went wrong'),
      });
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });
  });

  describe('random-pick mode', () => {
    it('picks a random character when none supplied and registers the slash context', async () => {
      const channel = createMockChannel(ChannelType.GuildText);
      const ctx = createMockContext(null, 'Hi', channel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-1', requestId: 'req-1' });
      mockGetCachedPersonalities.mockResolvedValueOnce({
        kind: 'ok',
        value: [
          {
            name: 'test-char',
            slug: 'test-char',
            displayName: 'Test Character',
            isOwned: true,
            isGlobal: false,
          },
        ],
      });

      await handleChat(ctx, mockConfig);

      // editReply is called by finalizeDeferredReply with the picked-character notice.
      expect(ctx.editReply).toHaveBeenCalled();
      expect(mockJobTracker.trackJob).toHaveBeenCalled();
    });
  });
});
