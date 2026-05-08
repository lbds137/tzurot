/**
 * Tests for MessageHandler
 *
 * Tests the Chain of Responsibility pattern for message processing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageType } from 'discord.js';
import { MessageHandler } from './MessageHandler.js';
import type { IMessageProcessor } from '../processors/IMessageProcessor.js';
import type { Message } from 'discord.js';
import type { LLMGenerationResult } from '@tzurot/common-types';

// Mock serviceRegistry to provide getGatewayClient
const mockGatewayClient = {
  updateDiagnosticResponseIds: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../services/serviceRegistry.js', () => ({
  getGatewayClient: () => mockGatewayClient,
}));

// Mock dependencies
const mockResponseSender = {
  sendResponse: vi.fn(),
};

const mockPersistence = {
  updateUserMessage: vi.fn(),
  saveAssistantMessage: vi.fn(),
  saveAssistantMessageFromFields: vi.fn().mockResolvedValue(undefined),
};

const mockJobTracker = {
  getContext: vi.fn(),
  completeJob: vi.fn(),
};

describe('MessageHandler', () => {
  let messageHandler: MessageHandler;
  let mockProcessor1: IMessageProcessor;
  let mockProcessor2: IMessageProcessor;
  let mockProcessor3: IMessageProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayClient.updateDiagnosticResponseIds.mockResolvedValue(undefined);

    // Create mock processors
    mockProcessor1 = {
      process: vi.fn().mockResolvedValue(false),
    };

    mockProcessor2 = {
      process: vi.fn().mockResolvedValue(false),
    };

    mockProcessor3 = {
      process: vi.fn().mockResolvedValue(false),
    };

    messageHandler = new MessageHandler(
      [mockProcessor1, mockProcessor2, mockProcessor3],
      mockResponseSender as any,
      mockPersistence as any,
      mockJobTracker as any
    );
  });

  describe('handleMessage - Chain of Responsibility', () => {
    function createMockMessage(overrides = {}): Message {
      return {
        id: 'msg-123',
        type: MessageType.Default, // Required for system message filtering
        author: {
          tag: 'TestUser#1234',
          bot: false,
        },
        reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
        ...overrides,
      } as unknown as Message;
    }

    it('should pass message through processor chain in order', async () => {
      const message = createMockMessage();

      await messageHandler.handleMessage(message);

      // All processors should be called in order
      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).toHaveBeenCalledWith(message);
      expect(mockProcessor3.process).toHaveBeenCalledWith(message);

      // Verify order
      const calls = [
        vi.mocked(mockProcessor1.process).mock.invocationCallOrder[0],
        vi.mocked(mockProcessor2.process).mock.invocationCallOrder[0],
        vi.mocked(mockProcessor3.process).mock.invocationCallOrder[0],
      ];
      expect(calls[0]).toBeLessThan(calls[1]);
      expect(calls[1]).toBeLessThan(calls[2]);
    });

    it('should stop chain when a processor handles the message', async () => {
      const message = createMockMessage();

      // Second processor handles the message
      vi.mocked(mockProcessor2.process).mockResolvedValue(true);

      await messageHandler.handleMessage(message);

      // First and second processors called
      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).toHaveBeenCalledWith(message);

      // Third processor should NOT be called
      expect(mockProcessor3.process).not.toHaveBeenCalled();
    });

    it('should handle all processors when none handle the message', async () => {
      const message = createMockMessage();

      // All processors return false
      vi.mocked(mockProcessor1.process).mockResolvedValue(false);
      vi.mocked(mockProcessor2.process).mockResolvedValue(false);
      vi.mocked(mockProcessor3.process).mockResolvedValue(false);

      await messageHandler.handleMessage(message);

      // All processors should be called
      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).toHaveBeenCalledWith(message);
      expect(mockProcessor3.process).toHaveBeenCalledWith(message);
    });

    it('should handle errors gracefully and reply to user', async () => {
      const message = createMockMessage();

      // First processor throws an error
      vi.mocked(mockProcessor1.process).mockRejectedValue(new Error('Processor error'));

      await messageHandler.handleMessage(message);

      // Should send error reply to user
      expect(message.reply).toHaveBeenCalledWith(
        'Sorry, I encountered an error processing your message.'
      );
    });

    it('should not throw if error reply fails', async () => {
      const message = createMockMessage();

      vi.mocked(mockProcessor1.process).mockRejectedValue(new Error('Processor error'));
      (message.reply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Channel deleted'));

      // Should not throw
      await expect(messageHandler.handleMessage(message)).resolves.toBeUndefined();
    });

    it('should stop at first processor that handles the message', async () => {
      const message = createMockMessage();

      // First processor handles it
      vi.mocked(mockProcessor1.process).mockResolvedValue(true);

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).not.toHaveBeenCalled();
      expect(mockProcessor3.process).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage - System Message Filtering', () => {
    function createMockMessage(overrides = {}): Message {
      return {
        id: 'msg-123',
        type: MessageType.Default,
        author: {
          tag: 'TestUser#1234',
          bot: false,
        },
        reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
        ...overrides,
      } as unknown as Message;
    }

    it('should ignore ThreadCreated system messages', async () => {
      const message = createMockMessage({ type: MessageType.ThreadCreated });

      await messageHandler.handleMessage(message);

      // No processors should be called for system messages
      expect(mockProcessor1.process).not.toHaveBeenCalled();
      expect(mockProcessor2.process).not.toHaveBeenCalled();
      expect(mockProcessor3.process).not.toHaveBeenCalled();
    });

    it('should ignore ChannelPinnedMessage system messages', async () => {
      const message = createMockMessage({ type: MessageType.ChannelPinnedMessage });

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).not.toHaveBeenCalled();
    });

    it('should ignore UserJoin system messages', async () => {
      const message = createMockMessage({ type: MessageType.UserJoin });

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).not.toHaveBeenCalled();
    });

    it('should ignore GuildBoost system messages', async () => {
      const message = createMockMessage({ type: MessageType.GuildBoost });

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).not.toHaveBeenCalled();
    });

    it('should process Default messages normally', async () => {
      const message = createMockMessage({ type: MessageType.Default });

      await messageHandler.handleMessage(message);

      // Processors should be called for normal messages
      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
    });

    it('should process Reply messages normally', async () => {
      const message = createMockMessage({ type: MessageType.Reply });

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
    });
  });

  describe('handleJobResult - Async Job Completion', () => {
    it('should handle successful job result and update/save messages', async () => {
      const jobId = 'job-123';
      const result = {
        requestId: 'req-123',
        success: true,
        content: 'AI response text',
        attachmentDescriptions: '[Image: cat.jpg]\nA cute cat',
        referencedMessagesDescriptions: '[Previous message context]',
        metadata: {
          modelUsed: 'anthropic/claude-sonnet-4.5',
        },
      };

      const mockMessage = {
        id: 'msg-123',
      } as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'personality-123', name: 'TestBot' },
        personaId: 'persona-456',
        userMessageContent: 'User message',
        userMessageTime: new Date('2025-11-14T12:00:00Z'),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockResponseSender.sendResponse.mockResolvedValue({
        chunkMessageIds: ['discord-1', 'discord-2'],
      });

      await messageHandler.handleJobResult(jobId, result);

      // Should get job context
      expect(mockJobTracker.getContext).toHaveBeenCalledWith(jobId);

      // Should complete the job (clear typing, remove from tracker)
      expect(mockJobTracker.completeJob).toHaveBeenCalledWith(jobId);

      // Should update user message with enriched content
      expect(mockPersistence.updateUserMessage).toHaveBeenCalledWith({
        message: mockMessage,
        personality: mockContext.personality,
        personaId: 'persona-456',
        messageContent: 'User message',
        attachmentDescriptions: '[Image: cat.jpg]\nA cute cat',
      });

      // Should send response to Discord
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'AI response text',
          personality: mockContext.personality,
          channel: mockContext.channel,
          guildId: mockContext.guildId,
          clientId: mockContext.clientId,
          modelUsed: 'anthropic/claude-sonnet-4.5',
        })
      );

      // Should save assistant message to conversation history
      expect(mockPersistence.saveAssistantMessage).toHaveBeenCalledWith({
        message: mockMessage,
        personality: mockContext.personality,
        personaId: 'persona-456',
        content: 'AI response text',
        chunkMessageIds: ['discord-1', 'discord-2'],
        userMessageTime: mockContext.userMessageTime,
      });
    });

    it('should ignore results for unknown jobs', async () => {
      const jobId = 'unknown-job';
      const result = {
        requestId: 'req-unknown',
        success: true,
        content: 'Some content',
      } as LLMGenerationResult;

      mockJobTracker.getContext.mockReturnValue(null);

      await messageHandler.handleJobResult(jobId, result);

      // Should not call any other methods
      expect(mockJobTracker.completeJob).not.toHaveBeenCalled();
      expect(mockPersistence.updateUserMessage).not.toHaveBeenCalled();
      expect(mockResponseSender.sendResponse).not.toHaveBeenCalled();
      expect(mockPersistence.saveAssistantMessage).not.toHaveBeenCalled();
    });

    it('should handle job result without metadata', async () => {
      const jobId = 'job-456';
      const result = {
        requestId: 'req-456',
        success: true,
        content: 'Response without metadata',
      };

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: {} as Message,
        personality: { id: 'p-1', name: 'Bot' },
        personaId: 'persona-1',
        userMessageContent: 'Message',
        userMessageTime: new Date(),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['msg-1'] });

      await messageHandler.handleJobResult(jobId, result);

      // Should send response with undefined modelUsed
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          modelUsed: undefined,
        })
      );
    });

    it('should handle errors gracefully without throwing', async () => {
      const jobId = 'job-789';
      const result = {
        requestId: 'req-789',
        success: true,
        content: 'Content',
      };

      const mockMessage = {
        id: 'msg-error',
        reply: vi.fn().mockResolvedValue({ id: 'error-reply-123' }),
      } as unknown as Message;

      const mockPersonality = { id: 'p-1', name: 'Bot' };

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: mockPersonality,
        personaId: 'persona-1',
        userMessageContent: 'Message',
        userMessageTime: new Date(),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockPersistence.updateUserMessage.mockRejectedValue(new Error('Database error'));

      // Should NOT throw - handle error gracefully
      await expect(messageHandler.handleJobResult(jobId, result)).resolves.toBeUndefined();

      // Should still complete the job
      expect(mockJobTracker.completeJob).toHaveBeenCalledWith(jobId);

      // Should notify user of error via webhook (not direct reply)
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Sorry, I encountered an error generating a response. Please try again later.',
          personality: mockPersonality,
          channel: mockContext.channel,
          guildId: mockContext.guildId,
          clientId: mockContext.clientId,
        })
      );
    });

    it('should handle chunked messages correctly', async () => {
      const jobId = 'job-chunked';
      const result = {
        requestId: 'req-chunked',
        success: true,
        content: 'Very long response that will be chunked across multiple Discord messages',
      };

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: {} as Message,
        personality: { id: 'p-1', name: 'Bot' },
        personaId: 'persona-1',
        userMessageContent: 'Message',
        userMessageTime: new Date(),
      };

      // Reset mocks from previous test
      mockPersistence.updateUserMessage.mockResolvedValue(undefined);
      mockPersistence.saveAssistantMessage.mockResolvedValue(undefined);

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockResponseSender.sendResponse.mockResolvedValue({
        chunkMessageIds: ['chunk-1', 'chunk-2', 'chunk-3'],
      });

      await messageHandler.handleJobResult(jobId, result);

      // Should save all chunk IDs
      expect(mockPersistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chunkMessageIds: ['chunk-1', 'chunk-2', 'chunk-3'],
        })
      );
    });

    it('should strip error spoiler from content when saving failed job to history', async () => {
      const jobId = 'job-failed';
      const result = {
        requestId: 'req-failed',
        success: false,
        error: 'API rate limit exceeded',
        errorInfo: {
          category: 'rate_limit' as const,
          referenceId: 'ref-123',
        },
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'ErrorBot' },
        personaId: 'persona-err',
        userMessageContent: 'Trigger error',
        userMessageTime: new Date(),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockPersistence.saveAssistantMessage.mockResolvedValue(undefined);
      mockResponseSender.sendResponse.mockResolvedValue({
        chunkMessageIds: ['err-msg-1'],
      });

      await messageHandler.handleJobResult(jobId, result);

      // Should save message with stripped error spoiler (no ||*(...))*|| pattern)
      expect(mockPersistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('||*('),
        })
      );
      // The content should still contain the user-facing error message
      expect(mockPersistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.any(String),
        })
      );
    });

    it('should include metadata in error responses for explicit failures', async () => {
      const jobId = 'job-meta-error';
      const result = {
        requestId: 'req-meta-error',
        success: false,
        error: 'API quota exceeded',
        errorInfo: {
          category: 'quota_exceeded' as const,
          referenceId: 'ref-quota-123',
        },
        metadata: {
          modelUsed: 'anthropic/claude-3-5-sonnet',
          isGuestMode: true,
          focusModeEnabled: false,
          incognitoModeActive: true,
        },
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'MetaBot' },
        personaId: 'persona-meta',
        userMessageContent: 'Trigger quota error',
        userMessageTime: new Date(),
        isAutoResponse: false,
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockPersistence.saveAssistantMessage.mockResolvedValue(undefined);
      mockResponseSender.sendResponse.mockResolvedValue({
        chunkMessageIds: ['meta-msg-1'],
      });

      await messageHandler.handleJobResult(jobId, result);

      // Should include all metadata fields in the error response
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          modelUsed: 'anthropic/claude-3-5-sonnet',
          isGuestMode: true,
          focusModeEnabled: false,
          incognitoModeActive: true,
          isAutoResponse: false,
        })
      );
    });

    it('should handle error response when result.metadata is undefined', async () => {
      const jobId = 'job-no-meta';
      const result = {
        requestId: 'req-no-meta',
        success: false,
        error: 'Network timeout',
        errorInfo: {
          category: 'network_error' as const,
          referenceId: 'ref-net-123',
        },
        // Note: metadata is completely missing
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'NoMetaBot' },
        personaId: 'persona-nometa',
        userMessageContent: 'Trigger network error',
        userMessageTime: new Date(),
        isAutoResponse: true,
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockPersistence.saveAssistantMessage.mockResolvedValue(undefined);
      mockResponseSender.sendResponse.mockResolvedValue({
        chunkMessageIds: ['nometa-msg-1'],
      });

      await messageHandler.handleJobResult(jobId, result);

      // Should still call sendResponse with undefined metadata fields (no crash)
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          modelUsed: undefined,
          isGuestMode: undefined,
          isAutoResponse: true,
        })
      );
    });

    it('should include metadata in error response for invalid content', async () => {
      const jobId = 'job-invalid-meta';
      const result = {
        requestId: 'req-invalid-meta',
        success: true,
        content: '', // Empty content triggers error path
        metadata: {
          modelUsed: 'openai/gpt-4o',
          isGuestMode: false,
          focusModeEnabled: true,
        },
      };

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'InvalidMetaBot' },
        personaId: 'persona-invmeta',
        userMessageContent: 'Trigger invalid content',
        userMessageTime: new Date(),
        isAutoResponse: false,
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockPersistence.saveAssistantMessage.mockResolvedValue(undefined);
      mockResponseSender.sendResponse.mockResolvedValue({
        chunkMessageIds: ['invmeta-msg-1'],
      });

      await messageHandler.handleJobResult(jobId, result);

      // Should include metadata even when content validation fails
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          modelUsed: 'openai/gpt-4o',
          isGuestMode: false,
          focusModeEnabled: true,
        })
      );
    });

    it('should handle error response with missing referenceId gracefully', async () => {
      const jobId = 'job-no-ref';
      const result = {
        requestId: 'req-no-ref',
        success: false,
        error: 'Provider error without reference',
        errorInfo: {
          category: 'provider_error' as const,
          // referenceId is intentionally undefined
        },
      } as unknown as LLMGenerationResult;

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'NoRefBot' },
        personaId: 'persona-noref',
        userMessageContent: 'Trigger error without ref',
        userMessageTime: new Date(),
        isAutoResponse: false,
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockPersistence.saveAssistantMessage.mockResolvedValue(undefined);
      mockResponseSender.sendResponse.mockResolvedValue({
        chunkMessageIds: ['noref-msg-1'],
      });

      await messageHandler.handleJobResult(jobId, result);

      // Should not include 'undefined' in the content
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('undefined'),
        })
      );
      // Should not include reference footer at all when referenceId is missing
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('reference:'),
        })
      );
    });

    it('should strip error spoiler when saving invalid content error to history', async () => {
      const jobId = 'job-invalid';
      const result = {
        requestId: 'req-invalid',
        success: true,
        content: '', // Empty content triggers error path
      };

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
        kind: 'message' as const,
        channel: { id: 'channel-test' } as any,
        guildId: 'guild-test',
        clientId: 'bot-test',
        message: mockMessage,
        personality: { id: 'p-1', name: 'InvalidBot' },
        personaId: 'persona-inv',
        userMessageContent: 'Some message',
        userMessageTime: new Date(),
      };

      mockJobTracker.getContext.mockReturnValue(mockContext);
      mockPersistence.saveAssistantMessage.mockResolvedValue(undefined);
      mockResponseSender.sendResponse.mockResolvedValue({
        chunkMessageIds: ['inv-msg-1'],
      });

      await messageHandler.handleJobResult(jobId, result);

      // Should save message with stripped error spoiler
      expect(mockPersistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.not.stringContaining('||*('),
        })
      );
    });
  });

  describe('handleJobResult - Slash dispatch', () => {
    function createSlashContext(overrides: Record<string, unknown> = {}) {
      return {
        kind: 'slash' as const,
        channel: { id: 'channel-slash', send: vi.fn().mockResolvedValue({ id: 'fb-1' }) } as any,
        guildId: 'guild-slash',
        clientId: 'bot-slash',
        userMessageTime: new Date('2026-05-08T10:00:00Z'),
        personality: { id: 'pers-slash', name: 'SlashBot' } as any,
        personaId: 'persona-slash',
        characterSlug: 'slash-char',
        isWeighInMode: false,
        ...overrides,
      };
    }

    it('routes successful slash result to DiscordResponseSender with full metadata', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1', 'm-2'] });

      const result = {
        requestId: 'req-slash',
        success: true,
        content: 'Slash response',
        metadata: {
          modelUsed: 'anthropic/claude',
          providerUsed: 'openrouter',
          isGuestMode: false,
          ttsAudioKey: 'tts-key-1',
          ttsAudioContentType: 'audio/ogg',
          thinkingContent: 'reasoning...',
          showThinking: true,
        },
      } as unknown as LLMGenerationResult;

      await messageHandler.handleJobResult('job-slash-1', result);

      // Slash branch dispatches with channel/guildId/clientId from context
      // (no `message` field — that's the parity-gain compared to the old polling sender).
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Slash response',
          channel: ctx.channel,
          guildId: 'guild-slash',
          clientId: 'bot-slash',
          modelUsed: 'anthropic/claude',
          ttsAudioKey: 'tts-key-1',
          thinkingContent: 'reasoning...',
          showThinking: true,
        })
      );
    });

    it('persists assistant message via saveAssistantMessageFromFields (no Message anchor)', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1'] });

      await messageHandler.handleJobResult('job-slash-2', {
        requestId: 'req-slash',
        success: true,
        content: 'Hi',
      } as unknown as LLMGenerationResult);

      expect(mockPersistence.saveAssistantMessageFromFields).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-slash',
          guildId: 'guild-slash',
          personaId: 'persona-slash',
          chunkMessageIds: ['m-1'],
          content: 'Hi',
          userMessageTime: ctx.userMessageTime,
        })
      );
      // Message-flavored persistence stays untouched on slash path.
      expect(mockPersistence.saveAssistantMessage).not.toHaveBeenCalled();
    });

    it('skips assistant persistence in weigh-in mode', async () => {
      const ctx = createSlashContext({ isWeighInMode: true });
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1'] });

      await messageHandler.handleJobResult('job-weighin', {
        requestId: 'req-slash',
        success: true,
        content: 'Weighing in',
      } as unknown as LLMGenerationResult);

      expect(mockPersistence.saveAssistantMessageFromFields).not.toHaveBeenCalled();
    });

    it('updates diagnostic response IDs with the slash requestId', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1', 'm-2'] });

      await messageHandler.handleJobResult('job-diag', {
        requestId: 'req-slash',
        success: true,
        content: 'Hi',
      } as unknown as LLMGenerationResult);

      // Wait a tick for the fire-and-forget update
      await new Promise(resolve => setImmediate(resolve));

      expect(mockGatewayClient.updateDiagnosticResponseIds).toHaveBeenCalledWith('req-slash', [
        'm-1',
        'm-2',
      ]);
    });

    it('routes explicit failure (success: false) through error path', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-1'] });

      await messageHandler.handleJobResult('job-fail', {
        requestId: 'req-slash',
        success: false,
        error: 'rate limited',
        errorInfo: { category: 'rate_limit_error', referenceId: 'ref-1' },
      } as unknown as LLMGenerationResult);

      // sendResponse called with error content (not 'Hi')
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: ctx.channel,
          guildId: 'guild-slash',
        })
      );
      const sentContent = mockResponseSender.sendResponse.mock.calls[0][0].content;
      expect(typeof sentContent).toBe('string');
      expect(sentContent.length).toBeGreaterThan(0);
    });

    it('falls back to channel.send when responseSender throws on the error path', async () => {
      const channelSend = vi.fn().mockResolvedValue({ id: 'fb-1' });
      const ctx = createSlashContext({
        channel: { id: 'channel-slash', send: channelSend } as any,
      });
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockRejectedValueOnce(new Error('webhook down'));

      await messageHandler.handleJobResult('job-fb', {
        requestId: 'req-slash',
        success: false,
        error: 'something',
        errorInfo: { category: 'unknown_error' },
      } as unknown as LLMGenerationResult);

      expect(channelSend).toHaveBeenCalled();
    });

    it('completes the JobTracker entry on slash result delivery', async () => {
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['m-1'] });

      await messageHandler.handleJobResult('job-complete', {
        requestId: 'req-slash',
        success: true,
        content: 'Hi',
      } as unknown as LLMGenerationResult);

      expect(mockJobTracker.completeJob).toHaveBeenCalledWith('job-complete');
    });

    it('routes truthy-but-empty content (success=true, content="") through the error path', async () => {
      // Distinct from `success: false` — an ai-worker can mark the job
      // successful while returning empty content (model produced nothing
      // visible). The slash branch must still send an error to the user
      // rather than silently dispatching an empty webhook message.
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-empty-1'] });

      await messageHandler.handleJobResult('job-empty', {
        requestId: 'req-slash',
        success: true,
        content: '',
      } as unknown as LLMGenerationResult);

      // sendResponse called with a non-empty error message (not the empty content).
      expect(mockResponseSender.sendResponse).toHaveBeenCalledTimes(1);
      const sentContent = mockResponseSender.sendResponse.mock.calls[0][0].content;
      expect(typeof sentContent).toBe('string');
      expect(sentContent.length).toBeGreaterThan(0);
    });

    it('routes null content (success=true, content=null) through the error path', async () => {
      // sendSlashErrorResponse still persists even on the error path, so we can't use
      // saveAssistantMessageFromFields as a proxy for "took the error path" here.
      const ctx = createSlashContext();
      mockJobTracker.getContext.mockReturnValue(ctx);
      mockResponseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-null-1'] });

      await messageHandler.handleJobResult('job-null', {
        requestId: 'req-slash',
        success: true,
        content: null,
      } as unknown as LLMGenerationResult);

      expect(mockResponseSender.sendResponse).toHaveBeenCalledTimes(1);
      const sentContent = mockResponseSender.sendResponse.mock.calls[0][0].content;
      expect(typeof sentContent).toBe('string');
      expect(sentContent.length).toBeGreaterThan(0);
    });
  });
});
