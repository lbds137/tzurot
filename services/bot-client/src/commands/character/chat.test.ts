/**
 * Tests for Character Chat Command Handler
 *
 * Tests /character chat subcommand:
 * - Character not found
 * - Unsupported channel type
 * - Successful chat flow
 * - Job polling timeout
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleChat } from './chat.js';
import type { ChatInputCommandInteraction, TextChannel, GuildMember } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';

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

const mockConversationHistoryService = {
  getRecentHistory: vi.fn(),
};

const mockPersonaResolver = {
  resolve: vi.fn(),
};

vi.mock('../../services/serviceRegistry.js', () => ({
  getGatewayClient: () => mockGatewayClient,
  getWebhookManager: () => mockWebhookManager,
  getPersonalityService: () => mockPersonalityService,
  getConversationHistoryService: () => mockConversationHistoryService,
  getPersonaResolver: () => mockPersonaResolver,
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

  const createMockInteraction = (
    characterSlug: string,
    message: string,
    channel = createMockChannel(),
    guild = createMockGuild()
  ) => {
    const mockMember = {
      displayName: 'TestUser',
    } as GuildMember;

    return {
      user: {
        id: 'user-123',
        displayName: 'TestUser',
      },
      member: mockMember,
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
      channel,
      guild,
      deleteReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      replied: false,
      deferred: true, // Simulates top-level handler having already deferred
    } as unknown as ChatInputCommandInteraction;
  };

  const createMockPersonality = (overrides = {}) => ({
    name: 'test-char',
    displayName: 'Test Character',
    slug: 'test-char',
    systemPrompt: 'You are a test character.',
    model: 'anthropic/claude-3.5-sonnet',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default: empty conversation history
    mockConversationHistoryService.getRecentHistory.mockResolvedValue([]);
    // Default: PersonaResolver returns empty preferredName (will use Discord name)
    mockPersonaResolver.resolve.mockResolvedValue({
      config: { personaId: 'persona-123', preferredName: null },
      source: 'user-default',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('handleChat', () => {
    // Note: deferReply is handled by top-level interactionCreate handler
    // (character chat is in NON_EPHEMERAL_COMMANDS so it's non-ephemeral)

    it('should return error when character not found', async () => {
      const mockInteraction = createMockInteraction('nonexistent', 'Hello!');
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      await handleChat(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('should reject unsupported channel types', async () => {
      const voiceChannel = createMockChannel(ChannelType.GuildVoice);
      const mockInteraction = createMockInteraction('test-char', 'Hello!', voiceChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());

      await handleChat(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('text channels or threads'),
      });
    });

    it('should support text channels', async () => {
      const textChannel = createMockChannel(ChannelType.GuildText);
      const mockInteraction = createMockInteraction('test-char', 'Hello!', textChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockInteraction.deleteReply).toHaveBeenCalled();
      expect(textChannel.send).toHaveBeenCalled();
    });

    it('should support public threads', async () => {
      const threadChannel = createMockChannel(ChannelType.PublicThread);
      const mockInteraction = createMockInteraction('test-char', 'Hello!', threadChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockInteraction.deleteReply).toHaveBeenCalled();
    });

    it('should support private threads', async () => {
      const threadChannel = createMockChannel(ChannelType.PrivateThread);
      const mockInteraction = createMockInteraction('test-char', 'Hello!', threadChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockInteraction.deleteReply).toHaveBeenCalled();
    });

    it('should delete deferred reply and send user message', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello AI!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Hello there!',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockInteraction.deleteReply).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalledWith('**TestUser:** Hello AI!');
    });

    it('should submit job to gateway with correct context', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      const personality = createMockPersonality();
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        personality,
        expect.objectContaining({
          messageContent: 'Hello!',
          userId: 'user-123',
          userName: 'TestUser',
        })
      );
    });

    it('should fetch and include conversation history in context', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      const personality = createMockPersonality({ id: 'personality-uuid-123' });

      // Mock conversation history with sample messages
      const mockHistory = [
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
      mockConversationHistoryService.getRecentHistory.mockResolvedValue(mockHistory);

      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      // Verify conversation history was fetched with correct parameters
      expect(mockConversationHistoryService.getRecentHistory).toHaveBeenCalledWith(
        'channel-123', // channel ID from mock
        'personality-uuid-123', // personality ID
        100 // MESSAGE_LIMITS.MAX_HISTORY_FETCH
      );

      // Verify context includes conversation history with ISO timestamps
      expect(mockGatewayClient.generate).toHaveBeenCalledWith(
        personality,
        expect.objectContaining({
          conversationHistory: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Previous message 1',
              createdAt: '2025-12-07T10:00:00.000Z',
              personaId: 'persona-1',
              personaName: 'User1',
            },
            {
              id: 'msg-2',
              role: 'assistant',
              content: 'Previous response 1',
              createdAt: '2025-12-07T10:01:00.000Z',
              personaId: 'persona-2',
              personaName: null,
            },
          ],
        })
      );
    });

    it('should poll for job result', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockGatewayClient.pollJobUntilComplete).toHaveBeenCalledWith('job-123', {
        maxWaitMs: 120000,
        pollIntervalMs: 1000,
      });
    });

    it('should send response via webhook on success', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      const personality = createMockPersonality();
      mockPersonalityService.loadPersonality.mockResolvedValue(personality);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Hello there, friend!',
        metadata: { modelUsed: 'test-model' },
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        personality,
        expect.stringContaining('Hello there, friend!')
      );
    });

    it('should append model footer to response', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response text',
        metadata: { modelUsed: 'anthropic/claude-3.5-sonnet' },
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        expect.anything(),
        expect.stringContaining('anthropic/claude-3.5-sonnet')
      );
    });

    it('should append guest mode footer when applicable', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: { isGuestMode: true },
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        expect.anything(),
        expect.stringContaining('free model')
      );
    });

    it('should send fallback message when result has no content', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: '',
        metadata: {},
      });

      await handleChat(mockInteraction, mockConfig);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('having trouble responding')
      );
    });

    it('should send fallback message when result is null', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue(null);

      await handleChat(mockInteraction, mockConfig);

      // First call is user message, second is fallback
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
      expect(mockChannel.send).toHaveBeenLastCalledWith(
        expect.stringContaining('having trouble responding')
      );
    });

    it('should show typing indicator while processing', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

      await handleChat(mockInteraction, mockConfig);

      expect(mockChannel.sendTyping).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      Object.assign(mockInteraction, { replied: false, deferred: true });
      mockPersonalityService.loadPersonality.mockRejectedValue(new Error('Database error'));

      await handleChat(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('something went wrong'),
      });
    });

    it('should handle no channel gracefully in error handler', async () => {
      const mockInteraction = createMockInteraction('test-char', 'Hello!');
      Object.assign(mockInteraction, { channel: null });
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      // Should not throw
      await expect(handleChat(mockInteraction, mockConfig)).resolves.not.toThrow();
    });

    it('should handle gateway job submission failure', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      Object.assign(mockInteraction, { replied: false, deferred: true });
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockRejectedValue(new Error('Gateway unavailable'));

      await handleChat(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('something went wrong'),
      });
    });

    it('should handle webhook send failure gracefully', async () => {
      const mockChannel = createMockChannel();
      const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
      // Set deferred=true so the error handler tries editReply
      Object.assign(mockInteraction, { replied: false, deferred: true });
      mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
      mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
        content: 'Response',
        metadata: {},
      });
      mockWebhookManager.sendAsPersonality.mockRejectedValue(new Error('Webhook error'));

      await handleChat(mockInteraction, mockConfig);

      // Error should be caught and editReply should be called (since deferred=true)
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('something went wrong'),
      });
    });

    describe('persona preferred name lookup', () => {
      it('should use persona preferredName from user default', async () => {
        const mockChannel = createMockChannel();
        const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
        const personality = createMockPersonality({ id: 'personality-uuid-123' });
        mockPersonalityService.loadPersonality.mockResolvedValue(personality);
        mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
        mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
          content: 'Response',
          metadata: {},
        });
        mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

        // Mock PersonaResolver returning user-default persona with preferredName
        mockPersonaResolver.resolve.mockResolvedValue({
          config: { personaId: 'persona-1', preferredName: 'Lila' },
          source: 'user-default',
        });

        await handleChat(mockInteraction, mockConfig);

        // User message should use preferredName instead of Discord name
        expect(mockChannel.send).toHaveBeenCalledWith('**Lila:** Hello!');
        // Context should include preferredName
        expect(mockGatewayClient.generate).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            userName: 'Lila',
          })
        );
      });

      it('should use persona preferredName from personality-specific override', async () => {
        const mockChannel = createMockChannel();
        const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
        const personality = createMockPersonality({ id: 'personality-uuid-123' });
        mockPersonalityService.loadPersonality.mockResolvedValue(personality);
        mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
        mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
          content: 'Response',
          metadata: {},
        });
        mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

        // Mock PersonaResolver returning context-override persona
        mockPersonaResolver.resolve.mockResolvedValue({
          config: { personaId: 'override-persona', preferredName: 'Override Name' },
          source: 'context-override',
        });

        await handleChat(mockInteraction, mockConfig);

        // User message should use override's preferredName
        expect(mockChannel.send).toHaveBeenCalledWith('**Override Name:** Hello!');
        expect(mockGatewayClient.generate).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            userName: 'Override Name',
          })
        );
      });

      it('should use Discord name when PersonaResolver throws', async () => {
        const mockChannel = createMockChannel();
        const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
        mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
        mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
        mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
          content: 'Response',
          metadata: {},
        });
        mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

        // Mock PersonaResolver throwing
        mockPersonaResolver.resolve.mockRejectedValue(new Error('Database error'));

        await handleChat(mockInteraction, mockConfig);

        // Should fall back to Discord display name
        expect(mockChannel.send).toHaveBeenCalledWith('**TestUser:** Hello!');
      });

      it('should use Discord name when persona has null preferredName', async () => {
        const mockChannel = createMockChannel();
        const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
        mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
        mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
        mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
          content: 'Response',
          metadata: {},
        });
        mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

        // Mock PersonaResolver returning persona with null preferredName
        mockPersonaResolver.resolve.mockResolvedValue({
          config: { personaId: 'persona-1', preferredName: null },
          source: 'user-default',
        });

        await handleChat(mockInteraction, mockConfig);

        // Should fall back to Discord display name
        expect(mockChannel.send).toHaveBeenCalledWith('**TestUser:** Hello!');
      });

      it('should use Discord name when persona has empty preferredName', async () => {
        const mockChannel = createMockChannel();
        const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
        mockPersonalityService.loadPersonality.mockResolvedValue(createMockPersonality());
        mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
        mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
          content: 'Response',
          metadata: {},
        });
        mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

        // Mock PersonaResolver returning persona with empty preferredName
        mockPersonaResolver.resolve.mockResolvedValue({
          config: { personaId: 'persona-1', preferredName: '' },
          source: 'user-default',
        });

        await handleChat(mockInteraction, mockConfig);

        // Should fall back to Discord display name
        expect(mockChannel.send).toHaveBeenCalledWith('**TestUser:** Hello!');
      });

      it('should call PersonaResolver with userId and personalityId', async () => {
        const mockChannel = createMockChannel();
        const mockInteraction = createMockInteraction('test-char', 'Hello!', mockChannel);
        const personality = createMockPersonality({ id: 'personality-uuid-456' });
        mockPersonalityService.loadPersonality.mockResolvedValue(personality);
        mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123', requestId: 'req-123' });
        mockGatewayClient.pollJobUntilComplete.mockResolvedValue({
          content: 'Response',
          metadata: {},
        });
        mockWebhookManager.sendAsPersonality.mockResolvedValue({ id: 'msg-123' });

        await handleChat(mockInteraction, mockConfig);

        // Verify PersonaResolver was called with correct userId and personalityId
        expect(mockPersonaResolver.resolve).toHaveBeenCalledWith(
          'user-123',
          'personality-uuid-456'
        );
      });
    });
  });
});
