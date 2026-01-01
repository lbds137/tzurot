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
    resolve: ReturnType<typeof vi.fn>;
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

    // Default: extended context disabled
    mockExtendedContextResolver = {
      resolve: vi.fn().mockResolvedValue({ enabled: false, source: 'global' }),
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
      expect(mockExtendedContextResolver.resolve).toHaveBeenCalledWith(
        mockMessage.channel.id,
        mockPersonality
      );

      // Should build context with extended context options
      expect(mockContextBuilder.buildContext).toHaveBeenCalledWith(
        mockMessage,
        mockPersonality,
        'Hello AI',
        { useExtendedContext: false, botUserId: 'bot-123' }
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

      // Should submit job to gateway
      expect(mockGatewayClient.generate).toHaveBeenCalledWith(mockPersonality, mockContext);

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

      // Enable extended context
      mockExtendedContextResolver.resolve.mockResolvedValue({
        enabled: true,
        source: 'channel',
      });

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

      // Should build context with extended context enabled
      expect(mockContextBuilder.buildContext).toHaveBeenCalledWith(
        mockMessage,
        mockPersonality,
        'Hello with extended context',
        { useExtendedContext: true, botUserId: 'bot-123' }
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
        { useExtendedContext: false, botUserId: 'bot-123' }
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
});

// Helper functions
function createMockMessage(): Message {
  return {
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
