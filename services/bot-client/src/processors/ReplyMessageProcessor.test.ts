/**
 * Reply Message Processor Tests
 *
 * Tests reply-to-personality-webhook handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReplyMessageProcessor } from './ReplyMessageProcessor.js';
import type { Message } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { ReplyResolutionService } from '../services/ReplyResolutionService.js';
import type { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';

// Mock VoiceMessageProcessor
vi.mock('./VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: {
    getVoiceTranscript: vi.fn(),
  },
}));

import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';

function createMockMessage(options?: { content?: string; hasReference?: boolean }): Message {
  return {
    id: '123456789',
    content: options?.content ?? 'Reply message',
    author: {
      id: 'user-123',
      username: 'testuser',
      bot: false,
    },
    reference: options?.hasReference
      ? ({
          messageId: 'referenced-message-id',
        } as Message['reference'])
      : null,
  } as unknown as Message;
}

const mockLilithPersonality = {
  id: 'lilith-id',
  name: 'Lilith',
  slug: 'lilith',
  systemPrompt: 'Lilith personality',
  model: 'anthropic/claude-sonnet-4.5',
  temperature: 0.8,
  avatarUrl: 'https://example.com/lilith.png',
} as unknown as LoadedPersonality;

describe('ReplyMessageProcessor', () => {
  let processor: ReplyMessageProcessor;
  let mockReplyResolver: {
    resolvePersonality: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityHandler: {
    handleMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockReplyResolver = {
      resolvePersonality: vi.fn(),
    };

    mockPersonalityHandler = {
      handleMessage: vi.fn(),
    };

    processor = new ReplyMessageProcessor(
      mockReplyResolver as unknown as ReplyResolutionService,
      mockPersonalityHandler as unknown as PersonalityMessageHandler
    );
  });

  describe('Reply detection', () => {
    it('should continue processing when not a reply', async () => {
      const message = createMockMessage({ hasReference: false });

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue to next processor
      expect(mockReplyResolver.resolvePersonality).not.toHaveBeenCalled();
    });

    it('should handle reply to personality webhook', async () => {
      const message = createMockMessage({ content: 'Hello again', hasReference: true });
      mockReplyResolver.resolvePersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      expect(mockReplyResolver.resolvePersonality).toHaveBeenCalledWith(message, 'user-123');
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Hello again' // Message content
      );
      expect(result).toBe(true); // Should stop processing (handled)
    });

    it('should continue processing when reply is not to a personality', async () => {
      const message = createMockMessage({ hasReference: true });
      mockReplyResolver.resolvePersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockReplyResolver.resolvePersonality).toHaveBeenCalledWith(message, 'user-123');
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
      expect(result).toBe(false); // Should continue (not a personality reply)
    });
  });

  describe('Voice transcript integration', () => {
    it('should use voice transcript when available', async () => {
      const message = createMockMessage({ content: 'Text content', hasReference: true });
      mockReplyResolver.resolvePersonality.mockResolvedValue(mockLilithPersonality);
      (VoiceMessageProcessor.getVoiceTranscript as ReturnType<typeof vi.fn>).mockReturnValue(
        'Voice transcript text'
      );

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Voice transcript text' // Voice transcript used instead of message content
      );
    });

    it('should use message content when no voice transcript', async () => {
      const message = createMockMessage({ content: 'Text content', hasReference: true });
      mockReplyResolver.resolvePersonality.mockResolvedValue(mockLilithPersonality);
      (VoiceMessageProcessor.getVoiceTranscript as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined
      );

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Text content' // Message content used
      );
    });
  });
});
