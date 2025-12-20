/**
 * Tests for MessageHandler
 *
 * Tests the Chain of Responsibility pattern for message processing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageHandler } from './MessageHandler.js';
import type { IMessageProcessor } from '../processors/IMessageProcessor.js';
import type { Message } from 'discord.js';

// Mock dependencies
const mockResponseSender = {
  sendResponse: vi.fn(),
};

const mockPersistence = {
  updateUserMessage: vi.fn(),
  saveAssistantMessage: vi.fn(),
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
        mockProcessor1.process.mock.invocationCallOrder[0],
        mockProcessor2.process.mock.invocationCallOrder[0],
        mockProcessor3.process.mock.invocationCallOrder[0],
      ];
      expect(calls[0]).toBeLessThan(calls[1]);
      expect(calls[1]).toBeLessThan(calls[2]);
    });

    it('should stop chain when a processor handles the message', async () => {
      const message = createMockMessage();

      // Second processor handles the message
      mockProcessor2.process.mockResolvedValue(true);

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
      mockProcessor1.process.mockResolvedValue(false);
      mockProcessor2.process.mockResolvedValue(false);
      mockProcessor3.process.mockResolvedValue(false);

      await messageHandler.handleMessage(message);

      // All processors should be called
      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).toHaveBeenCalledWith(message);
      expect(mockProcessor3.process).toHaveBeenCalledWith(message);
    });

    it('should handle errors gracefully and reply to user', async () => {
      const message = createMockMessage();

      // First processor throws an error
      mockProcessor1.process.mockRejectedValue(new Error('Processor error'));

      await messageHandler.handleMessage(message);

      // Should send error reply to user
      expect(message.reply).toHaveBeenCalledWith(
        'Sorry, I encountered an error processing your message.'
      );
    });

    it('should not throw if error reply fails', async () => {
      const message = createMockMessage();

      mockProcessor1.process.mockRejectedValue(new Error('Processor error'));
      (message.reply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Channel deleted'));

      // Should not throw
      await expect(messageHandler.handleMessage(message)).resolves.toBeUndefined();
    });

    it('should stop at first processor that handles the message', async () => {
      const message = createMockMessage();

      // First processor handles it
      mockProcessor1.process.mockResolvedValue(true);

      await messageHandler.handleMessage(message);

      expect(mockProcessor1.process).toHaveBeenCalledWith(message);
      expect(mockProcessor2.process).not.toHaveBeenCalled();
      expect(mockProcessor3.process).not.toHaveBeenCalled();
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
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith({
        content: 'AI response text',
        personality: mockContext.personality,
        message: mockMessage,
        modelUsed: 'anthropic/claude-sonnet-4.5',
      });

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
      const result = { content: 'Some content' };

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
      expect(mockResponseSender.sendResponse).toHaveBeenCalledWith({
        content: 'Sorry, I encountered an error generating a response. Please try again later.',
        personality: mockPersonality,
        message: mockMessage,
      });
    });

    it('should handle chunked messages correctly', async () => {
      const jobId = 'job-chunked';
      const result = {
        requestId: 'req-chunked',
        success: true,
        content: 'Very long response that will be chunked across multiple Discord messages',
      };

      const mockContext = {
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
      };

      const mockMessage = {
        reply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
      } as unknown as Message;

      const mockContext = {
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
});
