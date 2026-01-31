/**
 * PersonalityMessageHandler Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonalityMessageHandler } from './PersonalityMessageHandler.js';
import type { Message } from 'discord.js';
import { ChannelType } from 'discord.js';
import type {
  LoadedPersonality,
  ConversationMessage,
  ReferencedMessage,
} from '@tzurot/common-types';

// Mock NSFW verification to not block normal test flow
vi.mock('../utils/nsfwVerification.js', () => ({
  handleNsfwVerification: vi.fn().mockResolvedValue({ allowed: true, wasNewVerification: false }),
  sendVerificationConfirmation: vi.fn().mockResolvedValue(undefined),
  // Keep these for backward-compatible tests
  isNsfwChannel: vi.fn().mockReturnValue(false),
  isDMChannel: vi.fn().mockReturnValue(false),
  checkNsfwVerification: vi.fn().mockResolvedValue({ nsfwVerified: true, nsfwVerifiedAt: null }),
  verifyNsfwUser: vi.fn().mockResolvedValue(null),
  trackPendingVerificationMessage: vi.fn().mockResolvedValue(undefined),
  sendNsfwVerificationMessage: vi.fn().mockResolvedValue(undefined),
  NSFW_VERIFICATION_MESSAGE: 'Please verify your age by interacting in an NSFW channel first.',
}));

// Import mocked functions for per-test manipulation
import * as nsfwVerification from '../utils/nsfwVerification.js';

describe('PersonalityMessageHandler', () => {
  let handler: PersonalityMessageHandler;
  let mockGatewayClient: {
    generate: ReturnType<typeof vi.fn>;
  };
  let mockJobTracker: {
    trackJob: ReturnType<typeof vi.fn>;
  };
  let mockContextBuilder: {
    buildContext: ReturnType<typeof vi.fn>;
  };
  let mockPersistence: {
    saveUserMessage: ReturnType<typeof vi.fn>;
  };
  let mockReferenceEnricher: {
    enrichWithPersonaNames: ReturnType<typeof vi.fn>;
  };
  let mockExtendedContextResolver: {
    resolveAll: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGatewayClient = {
      generate: vi.fn(),
    };

    mockJobTracker = {
      trackJob: vi.fn(),
    };

    mockContextBuilder = {
      buildContext: vi.fn(),
    };

    mockPersistence = {
      saveUserMessage: vi.fn().mockResolvedValue(undefined),
    };

    mockReferenceEnricher = {
      enrichWithPersonaNames: vi.fn().mockResolvedValue(undefined),
    };

    // Default: extended context disabled with full settings
    mockExtendedContextResolver = {
      resolveAll: vi.fn().mockResolvedValue({
        enabled: false,
        maxMessages: 20,
        maxAge: null,
        maxImages: 0,
        sources: {
          enabled: 'global',
          maxMessages: 'global',
          maxAge: 'global',
          maxImages: 'global',
        },
      }),
    };

    handler = new PersonalityMessageHandler(
      mockGatewayClient as any,
      mockJobTracker as any,
      mockContextBuilder as any,
      mockPersistence as any,
      mockReferenceEnricher as any,
      mockExtendedContextResolver as any
    );
  });

  describe('handleMessage', () => {
    it('should handle personality message with full workflow', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      const mockContext = {
        userMessage: 'Hello AI',
        conversationHistory: [],
        attachments: [],
        referencedMessages: [],
        environment: {
          channelName: 'test-channel',
          guildName: 'Test Server',
        },
      };

      const mockBuildResult = {
        context: mockContext,
        personaId: 'persona-123',
        messageContent: 'Hello AI',
        referencedMessages: [],
        conversationHistory: [],
      };

      mockContextBuilder.buildContext.mockResolvedValue(mockBuildResult);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      await handler.handleMessage(mockMessage, mockPersonality, 'Hello AI');

      // Should resolve extended context
      expect(mockExtendedContextResolver.resolveAll).toHaveBeenCalledWith(
        mockMessage.channel.id,
        mockPersonality
      );

      // Should build context with extended context options
      expect(mockContextBuilder.buildContext).toHaveBeenCalledWith(
        mockMessage,
        mockPersonality,
        'Hello AI',
        {
          extendedContext: {
            enabled: false,
            maxMessages: 20,
            maxAge: null,
            maxImages: 0,
            sources: {
              enabled: 'global',
              maxMessages: 'global',
              maxAge: 'global',
              maxImages: 'global',
            },
          },
          botUserId: 'bot-123',
        }
      );

      // Should save user message
      expect(mockPersistence.saveUserMessage).toHaveBeenCalledWith({
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-123',
        messageContent: 'Hello AI',
        attachments: [],
        referencedMessages: [],
      });

      // Should submit job to gateway (with triggerMessageId added)
      expect(mockGatewayClient.generate).toHaveBeenCalledWith(mockPersonality, {
        ...mockContext,
        triggerMessageId: mockMessage.id,
      });

      // Should track job
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith('job-123', mockMessage.channel, {
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-123',
        userMessageContent: 'Hello AI',
        userMessageTime: expect.any(Date),
      });
    });

    it('should enrich referenced messages when present', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      const mockReferences: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-1',
          discordUserId: 'user-1',
          authorUsername: 'alice',
          authorDisplayName: 'Alice',
          webhookId: null,
          content: 'Previous message',
        },
      ];

      const mockConversationHistory: ConversationMessage[] = [
        {
          id: 'conv-1',
          role: 'user',
          content: 'History',
          personaId: 'persona-1',
          personaName: 'Alicia',
          timestamp: new Date(),
        },
      ];

      const mockContext = {
        userMessage: 'Reply to Alice',
        conversationHistory: mockConversationHistory,
        attachments: [],
        referencedMessages: mockReferences,
        environment: {},
      };

      const mockBuildResult = {
        context: mockContext,
        personaId: 'persona-123',
        messageContent: 'Reply to Alice',
        referencedMessages: mockReferences,
        conversationHistory: mockConversationHistory,
      };

      mockContextBuilder.buildContext.mockResolvedValue(mockBuildResult);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      await handler.handleMessage(mockMessage, mockPersonality, 'Reply to Alice');

      // Should enrich references
      expect(mockReferenceEnricher.enrichWithPersonaNames).toHaveBeenCalledWith(
        mockReferences,
        mockConversationHistory,
        mockPersonality.id
      );
    });

    it('should skip enrichment when no referenced messages', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      const mockContext = {
        userMessage: 'Simple message',
        conversationHistory: [],
        attachments: [],
        referencedMessages: [], // Empty
        environment: {},
      };

      const mockBuildResult = {
        context: mockContext,
        personaId: 'persona-123',
        messageContent: 'Simple message',
        referencedMessages: [],
        conversationHistory: [],
      };

      mockContextBuilder.buildContext.mockResolvedValue(mockBuildResult);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      await handler.handleMessage(mockMessage, mockPersonality, 'Simple message');

      // Should not call enrich
      expect(mockReferenceEnricher.enrichWithPersonaNames).not.toHaveBeenCalled();
    });

    it('should pass extended context enabled to buildContext when resolved', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      // Enable extended context with channel-level settings
      const resolvedSettings = {
        enabled: true,
        maxMessages: 15,
        maxAge: 3600,
        maxImages: 5,
        sources: {
          enabled: 'channel',
          maxMessages: 'channel',
          maxAge: 'channel',
          maxImages: 'global',
        },
      };
      mockExtendedContextResolver.resolveAll.mockResolvedValue(resolvedSettings);

      const mockContext = {
        userMessage: 'Hello with extended context',
        conversationHistory: [],
        attachments: [],
        referencedMessages: [],
        environment: {},
      };

      const mockBuildResult = {
        context: mockContext,
        personaId: 'persona-123',
        messageContent: 'Hello with extended context',
        referencedMessages: [],
        conversationHistory: [],
      };

      mockContextBuilder.buildContext.mockResolvedValue(mockBuildResult);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      await handler.handleMessage(mockMessage, mockPersonality, 'Hello with extended context');

      // Should build context with extended context settings
      expect(mockContextBuilder.buildContext).toHaveBeenCalledWith(
        mockMessage,
        mockPersonality,
        'Hello with extended context',
        { extendedContext: resolvedSettings, botUserId: 'bot-123' }
      );
    });

    it('should handle voice transcript content', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      const voiceTranscript = 'This is a voice message transcript';

      const mockContext = {
        userMessage: voiceTranscript,
        conversationHistory: [],
        attachments: [],
        referencedMessages: [],
        environment: {},
      };

      const mockBuildResult = {
        context: mockContext,
        personaId: 'persona-123',
        messageContent: voiceTranscript,
        referencedMessages: [],
        conversationHistory: [],
      };

      mockContextBuilder.buildContext.mockResolvedValue(mockBuildResult);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      await handler.handleMessage(mockMessage, mockPersonality, voiceTranscript);

      // Should build context with voice transcript
      expect(mockContextBuilder.buildContext).toHaveBeenCalledWith(
        mockMessage,
        mockPersonality,
        voiceTranscript,
        expect.objectContaining({
          extendedContext: expect.objectContaining({ enabled: false }),
          botUserId: 'bot-123',
        })
      );

      // Should save with voice transcript content
      expect(mockPersistence.saveUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageContent: voiceTranscript,
        })
      );
    });

    it('should handle errors gracefully and reply to user', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      mockContextBuilder.buildContext.mockRejectedValue(new Error('Context build failed'));

      await handler.handleMessage(mockMessage, mockPersonality, 'Test message');

      // Should reply with error
      expect(mockMessage.reply).toHaveBeenCalledWith('Error: Context build failed');

      // Should not submit job
      expect(mockGatewayClient.generate).not.toHaveBeenCalled();
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('should handle non-Error thrown values', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      mockContextBuilder.buildContext.mockRejectedValue('String error');

      await handler.handleMessage(mockMessage, mockPersonality, 'Test message');

      // Should reply with stringified error
      expect(mockMessage.reply).toHaveBeenCalledWith('Error: String error');
    });

    it('should not throw if error reply fails', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      mockContextBuilder.buildContext.mockRejectedValue(new Error('Build failed'));
      (mockMessage.reply as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Channel deleted')
      );

      // Should not throw
      await expect(
        handler.handleMessage(mockMessage, mockPersonality, 'Test message')
      ).resolves.toBeUndefined();
    });

    it('should pass enriched references to persistence', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      const mockReferences: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-1',
          discordUserId: 'user-1',
          authorUsername: 'alice',
          authorDisplayName: 'Alice', // Will be enriched
          webhookId: null,
          content: 'Previous',
        },
      ];

      const mockContext = {
        userMessage: 'Reply',
        conversationHistory: [],
        attachments: [],
        referencedMessages: mockReferences,
        environment: {},
      };

      const mockBuildResult = {
        context: mockContext,
        personaId: 'persona-123',
        messageContent: 'Reply',
        referencedMessages: mockReferences,
        conversationHistory: [],
      };

      mockContextBuilder.buildContext.mockResolvedValue(mockBuildResult);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      // Mock enrichment to modify the reference
      mockReferenceEnricher.enrichWithPersonaNames.mockImplementation(async refs => {
        refs[0].authorDisplayName = 'Alicia'; // Enriched name
      });

      await handler.handleMessage(mockMessage, mockPersonality, 'Reply');

      // Should save with enriched reference
      expect(mockPersistence.saveUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          referencedMessages: [
            expect.objectContaining({
              authorDisplayName: 'Alicia', // Enriched
            }),
          ],
        })
      );
    });

    it('should include attachments in persistence', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      const mockAttachments = [
        {
          url: 'https://example.com/image.png',
          contentType: 'image/png',
          name: 'image.png',
          size: 50000,
        },
      ];

      const mockContext = {
        userMessage: 'Message with image',
        conversationHistory: [],
        attachments: mockAttachments,
        referencedMessages: [],
        environment: {},
      };

      const mockBuildResult = {
        context: mockContext,
        personaId: 'persona-123',
        messageContent: 'Message with image',
        referencedMessages: [],
        conversationHistory: [],
      };

      mockContextBuilder.buildContext.mockResolvedValue(mockBuildResult);
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      await handler.handleMessage(mockMessage, mockPersonality, 'Message with image');

      // Should save with attachments
      expect(mockPersistence.saveUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: mockAttachments,
        })
      );
    });
  });

  describe('NSFW verification', () => {
    it('should auto-verify user when in NSFW channel and continue processing', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      // Setup: handleNsfwVerification returns allowed + wasNewVerification
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValue({
        allowed: true,
        wasNewVerification: true,
      });

      const mockContext = {
        userMessage: 'Hello from NSFW channel',
        conversationHistory: [],
        attachments: [],
        referencedMessages: [],
        environment: {},
      };

      mockContextBuilder.buildContext.mockResolvedValue({
        context: mockContext,
        personaId: 'persona-123',
        messageContent: 'Hello from NSFW channel',
        referencedMessages: [],
        conversationHistory: [],
      });
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      await handler.handleMessage(mockMessage, mockPersonality, 'Hello from NSFW channel');

      // Should call handleNsfwVerification
      expect(nsfwVerification.handleNsfwVerification).toHaveBeenCalledWith(
        mockMessage,
        'PersonalityMessageHandler'
      );

      // Should send confirmation for new verification
      expect(nsfwVerification.sendVerificationConfirmation).toHaveBeenCalled();

      // Should continue processing (generate called)
      expect(mockGatewayClient.generate).toHaveBeenCalled();
    });

    it('should block unverified user and not process message', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      // Setup: handleNsfwVerification blocks the message
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValue({
        allowed: false,
        wasNewVerification: false,
      });

      await handler.handleMessage(mockMessage, mockPersonality, 'Hello via DM');

      // Should call handleNsfwVerification
      expect(nsfwVerification.handleNsfwVerification).toHaveBeenCalled();

      // Should NOT process message (generate not called)
      expect(mockGatewayClient.generate).not.toHaveBeenCalled();
    });

    it('should not send confirmation when already verified', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      // Setup: handleNsfwVerification allows but not new verification
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValue({
        allowed: true,
        wasNewVerification: false,
      });

      const mockContext = {
        userMessage: 'Hello',
        conversationHistory: [],
        attachments: [],
        referencedMessages: [],
        environment: {},
      };

      mockContextBuilder.buildContext.mockResolvedValue({
        context: mockContext,
        personaId: 'persona-123',
        messageContent: 'Hello',
        referencedMessages: [],
        conversationHistory: [],
      });
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      await handler.handleMessage(mockMessage, mockPersonality, 'Hello');

      // Should NOT send confirmation (not new verification)
      expect(nsfwVerification.sendVerificationConfirmation).not.toHaveBeenCalled();

      // Should continue processing
      expect(mockGatewayClient.generate).toHaveBeenCalled();
    });

    it('should allow verified user to proceed', async () => {
      const mockMessage = createMockMessage();
      const mockPersonality = createMockPersonality();

      // Setup: handleNsfwVerification allows
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValue({
        allowed: true,
        wasNewVerification: false,
      });

      const mockContext = {
        userMessage: 'Hello via DM',
        conversationHistory: [],
        attachments: [],
        referencedMessages: [],
        environment: {},
      };

      mockContextBuilder.buildContext.mockResolvedValue({
        context: mockContext,
        personaId: 'persona-123',
        messageContent: 'Hello via DM',
        referencedMessages: [],
        conversationHistory: [],
      });
      mockGatewayClient.generate.mockResolvedValue({ jobId: 'job-123' });

      await handler.handleMessage(mockMessage, mockPersonality, 'Hello via DM');

      // Should continue processing (generate called)
      expect(mockGatewayClient.generate).toHaveBeenCalled();
    });
  });
});

// Helper functions
function createMockMessage(): Message {
  return {
    id: 'message-123',
    author: {
      id: 'user-123',
      bot: false,
    },
    channel: {
      id: 'channel-123',
      type: ChannelType.GuildText,
    },
    client: {
      user: {
        id: 'bot-123',
      },
    },
    reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
  } as unknown as Message;
}

function createMockPersonality(): LoadedPersonality {
  return {
    id: 'personality-123',
    name: 'test-bot',
    displayName: 'Test Bot',
    systemPrompt: 'You are a test bot',
    llmConfig: {
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 1000,
    },
  } as LoadedPersonality;
}
