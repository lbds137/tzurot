/**
 * Tests for Character Chat Command Handler
 *
 * Tests /character chat subcommand:
 * - Character not found
 * - Unsupported channel type
 * - Successful chat flow (regular mode)
 * - Weigh-in mode (no message provided)
 * - Job polling timeout
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleChat } from './chat.js';
import type { GuildMember } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock service registry
const mockGatewayClient = {
  generate: vi.fn(),
  pollJobUntilComplete: vi.fn(),
};

const mockWebhookManager = {
  sendAsPersonality: vi.fn(),
};

const mockPersonalityService = {
  loadPersonality: vi.fn(),
};

const mockMessageContextBuilder = {
  buildContextFromInteraction: vi.fn(),
};

const mockConversationPersistence = {
  saveUserMessageFromFields: vi.fn().mockResolvedValue(undefined),
  saveAssistantMessageFromFields: vi.fn().mockResolvedValue(undefined),
};

const mockExtendedContextResolver = {
  resolveAll: vi.fn().mockResolvedValue({
    enabled: true,
    maxMessages: 100,
    maxAge: undefined,
    maxImages: 10,
    sources: ['database', 'discord'],
  }),
};

vi.mock('../../services/serviceRegistry.js', () => ({
  getGatewayClient: () => mockGatewayClient,
  getWebhookManager: () => mockWebhookManager,
  getPersonalityService: () => mockPersonalityService,
  getMessageContextBuilder: () => mockMessageContextBuilder,
  getConversationPersistence: () => mockConversationPersistence,
  getExtendedContextResolver: () => mockExtendedContextResolver,
}));

// Mock redis service
vi.mock('../../redis.js', () => ({
  redisService: {
    storeWebhookMessage: vi.fn(),
  },
}));

// Mock common-types logger
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

describe('Character Chat Handler', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  const createMockChannel = (type: ChannelType = ChannelType.GuildText) => ({
    type,
    id: 'channel-123',
    name: 'test-channel',
    send: vi.fn().mockResolvedValue({ id: 'user-msg-123' }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  });

  const createMockGuild = () => ({
    id: 'guild-123',
    name: 'Test Guild',
  });

  /**
   * Create a mock DeferredCommandContext for testing
   *
   * @param characterSlug - The character slug option
   * @param message - The message option (null for weigh-in mode)
   * @param channel - Mock channel
   * @param guild - Mock guild
   */
  const createMockContext = (
    characterSlug: string,
    message: string | null,
    channel = createMockChannel(),
    guild = createMockGuild()
  ): DeferredCommandContext => {
    const mockMember = {
      displayName: 'TestUser',
    } as GuildMember;

    const mockUser = {
      id: 'user-123',
      displayName: 'TestUser',
    };

    // Mock interaction nested inside context
    const mockInteraction = {
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'character') {
            return characterSlug;
          }
          if (name === 'message') {
            return message;
          }
          return null;
        }),
      },
      replied: false,
      deferred: true, // Simulates top-level handler having already deferred
    };

    return {
      interaction: mockInteraction,
      user: mockUser,
      member: mockMember,
      guild,
      channel,
      isEphemeral: false,
      editReply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeferredCommandContext;
  };

  const createMockPersonality = (overrides = {}) => ({
    name: 'test-char',
    displayName: 'Test Character',
    slug: 'test-char',
    systemPrompt: 'You are a test character.',
    model: 'anthropic/claude-3.5-sonnet',
    ...overrides,
  });

  const createMockHistory = () => [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Previous message 1',
      createdAt: new Date('2025-12-07T10:00:00Z'),
      personaId: 'persona-1',
      personaName: 'User1',
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: 'Previous response 1',
      createdAt: new Date('2025-12-07T10:01:00Z'),
      personaId: 'persona-2',
      personaName: null,
    },
  ];

  /**
   * Create a mock context build result
   */
  const createMockContextBuildResult = (
    overrides: {
      personaName?: string | null;
      conversationHistory?: unknown[];
      messageContent?: string;
    } = {}
  ) => ({
    context: {
      userId: 'user-123',
      userInternalId: 'internal-user-123',
      userName: 'TestUser',
      discordUsername: 'TestUser',
      channelId: 'channel-123',
      serverId: 'guild-123',
      messageContent: overrides.messageContent ?? 'Hello!',
      activePersonaId: 'persona-123',
      activePersonaName: overrides.personaName ?? undefined,
      conversationHistory: overrides.conversationHistory ?? [],
      environment: {
        type: 'guild' as const,
        guild: { id: 'guild-123', name: 'Test Guild' },
        channel: { id: 'channel-123', name: 'test-channel', type: 'text' },
      },
    },
    userId: 'internal-user-123',
    personaId: 'persona-123',
    personaName: overrides.personaName ?? null,
    messageContent: 'Hello!',
    referencedMessages: [],
    conversationHistory: overrides.conversationHistory ?? [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default: MessageContextBuilder returns result with empty history and null personaName
    mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
      createMockContextBuildResult()
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('handleChat - regular mode', () => {
    // Note: deferReply is handled by top-level handler via SafeCommandContext
    // character chat uses DeferredCommandContext (deferred non-ephemeral)

    it('should return error when character not found', async () => {
      const mockContext = createMockContext('nonexistent', 'Hello!');
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      await handleChat(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('should reject unsupported channel types', async () => {
      const voiceChannel = createMockChannel(ChannelType.GuildVoice);
      const mockContext = createMockContext('test-char', 'Hello!', voiceChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());

      await handleChat(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('text channels or threads'),
      });
    });

    it('should support text channels', async () => {
      const textChannel = createMockChannel(ChannelType.GuildText);
      const mockContext = createMockContext('test-char', 'Hello!', textChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockContext.deleteReply).toHaveBeenCalled();
      expect(textChannel.send).toHaveBeenCalled();
    });

    it('should support public threads', async () => {
      const threadChannel = createMockChannel(ChannelType.PublicThread);
      const mockContext = createMockContext('test-char', 'Hello!', threadChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockContext.deleteReply).toHaveBeenCalled();
    });

    it('should support private threads', async () => {
      const threadChannel = createMockChannel(ChannelType.PrivateThread);
      const mockContext = createMockContext('test-char', 'Hello!', threadChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockContext.deleteReply).toHaveBeenCalled();
    });

    it('should delete deferred reply and send user message', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello AI!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Hello there!',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockContext.deleteReply).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalledWith('**TestUser:** Hello AI!');
    });

    it('should submit job to gateway with correct context', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      const personality = createMockPersonality();
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        personality,
        expect.objectContaining({
          messageContent: 'Hello!',
          userId: 'user-123',
          userName: 'TestUser',
        })
      );
    });

    it('should use MessageContextBuilder to build context with history', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-123' });

      // Mock context builder returning history
      const mockHistory = createMockHistory();
      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({ conversationHistory: mockHistory })
      );

      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      // Verify MessageContextBuilder was called with correct parameters
      expect(mockMessageContextBuilder.buildContextFromInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          channelId: 'channel-123',
        }),
        personality,
        'Hello!', // message content
        expect.objectContaining({ extendedContext: expect.any(Object) })
      );

      // Verify context was passed to generate
      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        personality,
        expect.objectContaining({})
      );
    });

    it('should poll for job result', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockGatewayClient.pollJobUntilComplete).toHaveBeenCalledWith('job-123', {
        maxWaitMs: 120000,
        pollIntervalMs: 1000,
      });
    });

    it('should send response via webhook on success', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      const personality = createMockPersonality();
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Hello there, friend!',
        metadata: { modelUsed: 'test-model' },
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        personality,
        expect.stringContaining('Hello there, friend!')
      );
    });

    it('should append model footer to response', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response text',
        metadata: { modelUsed: 'anthropic/claude-3.5-sonnet' },
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        expect.anything(),
        expect.stringContaining('anthropic/claude-3.5-sonnet')
      );
    });

    it('should append guest mode footer when applicable', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: { isGuestMode: true },
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        expect.anything(),
        expect.stringContaining('free model')
      );
    });

    it('should send fallback message when result has no content', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: '',
        metadata: {},
      });

      await handleChat(mockContext, mockConfig);

      // First call is user message, second is fallback
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
      expect(mockChannel.send).toHaveBeenNthCalledWith(1, '**TestUser:** Hello!');
      expect(mockChannel.send).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('having trouble responding')
      );
    });

    it('should send fallback message when result is null', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue(null);

      await handleChat(mockContext, mockConfig);

      // First call is user message, second is fallback
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
      expect(mockChannel.send).toHaveBeenLastCalledWith(
        expect.stringContaining('having trouble responding')
      );
    });

    it('should show typing indicator while processing', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      expect(mockChannel.sendTyping).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      // Set interaction state for error handler
      Object.assign(mockContext.interaction, { replied: false, deferred: true });
      mockPersonalityService.loadPersonality.mockRejectedValue(new Error('Database error'));

      await handleChat(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('something went wrong'),
      });
    });

    it('should handle no channel gracefully in error handler', async () => {
      const mockContext = createMockContext('test-char', 'Hello!');
      Object.assign(mockContext, { channel: null });
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      // Should not throw
      await expect(handleChat(mockContext, mockConfig)).resolves.not.toThrow();
    });

    it('should handle gateway job submission failure', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      Object.assign(mockContext.interaction, { replied: false, deferred: true });
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockRejectedValue(new Error('Gateway unavailable'));

      await handleChat(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('something went wrong'),
      });
    });

    it('should handle webhook send failure gracefully', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      // Set deferred=true so the error handler tries editReply
      Object.assign(mockContext.interaction, { replied: false, deferred: true });
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockRejectedValue(new Error('Webhook error'));

      await handleChat(mockContext, mockConfig);

      // Error should be caught and editReply should be called (since deferred=true)
      expect(mockContext.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('something went wrong'),
      });
    });
  });

  describe('handleChat - weigh-in mode', () => {
    // Weigh-in mode: message is null or empty, character contributes to ongoing conversation

    it('should detect weigh-in mode when message is null', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', null, mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-123' });

      // Weigh-in mode uses special message and requires conversation history
      const weighInMessage =
        '[The user has summoned you to join this conversation. Contribute naturally based on the context above.]';
      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({
          conversationHistory: createMockHistory(),
          messageContent: weighInMessage,
        })
      );
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Weigh-in response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      // Should NOT send user message to channel in weigh-in mode
      expect(mockChannel.send).not.toHaveBeenCalledWith(
        expect.stringMatching(/^\*\*TestUser:\*\*/)
      );

      // Should use special weigh-in message for AI
      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        personality,
        expect.objectContaining({
          messageContent: expect.stringContaining('summoned you to join this conversation'),
        })
      );
    });

    it('should detect weigh-in mode when message is empty string', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', '', mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-123' });

      const weighInMessage =
        '[The user has summoned you to join this conversation. Contribute naturally based on the context above.]';
      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({
          conversationHistory: createMockHistory(),
          messageContent: weighInMessage,
        })
      );
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Weigh-in response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      // Should use special weigh-in message for AI
      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        personality,
        expect.objectContaining({
          messageContent: expect.stringContaining('summoned you to join this conversation'),
        })
      );
    });

    it('should detect weigh-in mode when message is whitespace only', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', '   ', mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-123' });

      const weighInMessage =
        '[The user has summoned you to join this conversation. Contribute naturally based on the context above.]';
      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({
          conversationHistory: createMockHistory(),
          messageContent: weighInMessage,
        })
      );
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Weigh-in response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      // Should use special weigh-in message for AI
      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        personality,
        expect.objectContaining({
          messageContent: expect.stringContaining('summoned you to join this conversation'),
        })
      );
    });

    it('should require conversation history for weigh-in mode', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', null, mockChannel);
      const personality = createMockPersonality({ displayName: 'Test Char' });

      // Empty conversation history
      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({ conversationHistory: [] })
      );
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);

      await handleChat(mockContext, mockConfig);

      // Should return error about no conversation history in this channel
      expect(mockContext.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No conversation history found in this channel'),
      });

      // Should NOT submit job
      expect(mockGatewayClient.generate).not.toHaveBeenCalled();
    });

    it('should not send user message to channel in weigh-in mode', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', null, mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-123' });

      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({ conversationHistory: createMockHistory() })
      );
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Weigh-in response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      // channel.send should only be called if webhook fails (fallback)
      // In successful case, only webhook is used for response
      // User message is NOT sent in weigh-in mode
      const sendCalls = mockChannel.send.mock.calls;
      for (const call of sendCalls) {
        expect(call[0]).not.toMatch(/^\*\*TestUser:\*\*/);
      }
    });

    it('should include conversation history in weigh-in mode context', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', null, mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-123' });

      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({ conversationHistory: createMockHistory() })
      );
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Weigh-in response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      // Verify conversation history is included
      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        personality,
        expect.objectContaining({
          conversationHistory: expect.arrayContaining([
            expect.objectContaining({ content: 'Previous message 1' }),
            expect.objectContaining({ content: 'Previous response 1' }),
          ]),
        })
      );
    });

    it('should successfully complete weigh-in flow', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', null, mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-123' });

      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({ conversationHistory: createMockHistory() })
      );
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'I agree with the previous point.',
        metadata: { modelUsed: 'test-model' },
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      // Verify full flow completed
      expect(mockContext.deleteReply).toHaveBeenCalled();
      expect(mockGatewayClient.generate).toHaveBeenCalled();
      expect(mockGatewayClient.pollJobUntilComplete).toHaveBeenCalled();
      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        personality,
        expect.stringContaining('I agree with the previous point.')
      );
    });
  });

  describe('persona preferred name lookup', () => {
    it('should use persona preferredName from MessageContextBuilder result', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-123' });
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      // Mock MessageContextBuilder returning persona with preferredName
      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({ personaName: 'Lila' })
      );

      await handleChat(mockContext, mockConfig);

      // User message should use preferredName instead of Discord name
      expect(mockChannel.send).toHaveBeenCalledWith('**Lila:** Hello!');
    });

    it('should use Discord name when persona has null preferredName', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      // Mock MessageContextBuilder returning persona with null preferredName
      mockMessageContextBuilder.buildContextFromInteraction.mockResolvedValue(
        createMockContextBuildResult({ personaName: null })
      );

      await handleChat(mockContext, mockConfig);

      // Should fall back to Discord display name
      expect(mockChannel.send).toHaveBeenCalledWith('**TestUser:** Hello!');
    });

    it('should call MessageContextBuilder with userId and personality', async () => {
      const mockChannel = createMockChannel();
      const mockContext = createMockContext('test-char', 'Hello!', mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-456' });
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockContext, mockConfig);

      // Verify MessageContextBuilder was called with correct parameters
      expect(mockMessageContextBuilder.buildContextFromInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
        }),
        personality,
        'Hello!',
        expect.objectContaining({ extendedContext: expect.any(Object) })
      );
    });
  });
});
