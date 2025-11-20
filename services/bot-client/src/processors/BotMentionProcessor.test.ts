/**
 * Bot Mention Processor Tests
 *
 * Tests generic bot mention handling with default personality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BotMentionProcessor } from './BotMentionProcessor.js';
import type { Message } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';

// Mock VoiceMessageProcessor
vi.mock('./VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: {
    getVoiceTranscript: vi.fn(),
  },
}));

import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';

function createMockMessage(options?: { content?: string; hasBotMention?: boolean }): Message {
  const botId = '987654321'; // Numeric ID like real Discord
  return {
    id: '123456789',
    content: options?.content ?? 'Test message',
    author: {
      id: '111222333',
      username: 'testuser',
      bot: false,
    },
    client: {
      user: {
        id: botId,
      },
    },
    mentions: {
      has: vi.fn().mockReturnValue(options?.hasBotMention ?? false),
    },
  } as unknown as Message;
}

const mockDefaultPersonality: LoadedPersonality = {
  id: 'default-id',
  name: 'default',
  slug: 'default',
  systemPrompt: 'Default personality',
  model: 'anthropic/claude-sonnet-4.5',
  temperature: 0.7,
  avatarUrl: null,
  requiresImageSupport: false,
  requiredCapabilities: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'system',
};

describe('BotMentionProcessor', () => {
  let processor: BotMentionProcessor;
  let mockPersonalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityHandler: {
    handleMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPersonalityService = {
      loadPersonality: vi.fn(),
    };

    mockPersonalityHandler = {
      handleMessage: vi.fn(),
    };

    processor = new BotMentionProcessor(
      mockPersonalityService as unknown as IPersonalityLoader,
      mockPersonalityHandler as unknown as PersonalityMessageHandler
    );
  });

  describe('Bot mention detection', () => {
    it('should continue processing when no bot mention', async () => {
      const message = createMockMessage({ hasBotMention: false });

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue to next processor
      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
    });

    it('should handle generic bot mention with default personality', async () => {
      const message = createMockMessage({ content: '<@987654321> hello', hasBotMention: true });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockDefaultPersonality);

      const result = await processor.process(message);

      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('default');
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockDefaultPersonality,
        'hello' // Discord mention tags removed
      );
      expect(result).toBe(true); // Should stop processing (handled)
    });

    it('should continue processing when default personality not configured', async () => {
      const message = createMockMessage({ hasBotMention: true });
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('default');
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
      expect(result).toBe(false); // Should continue (no default personality)
    });
  });

  describe('Content cleaning', () => {
    it('should remove Discord mention tags from content', async () => {
      const message = createMockMessage({
        content: '<@123456789> <@!987654321> test message',
        hasBotMention: true,
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockDefaultPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockDefaultPersonality,
        'test message' // Mentions stripped
      );
    });

    it('should handle empty content after mention removal', async () => {
      const message = createMockMessage({ content: '<@987654321>', hasBotMention: true });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockDefaultPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockDefaultPersonality,
        '' // Empty after mention removal
      );
    });
  });

  describe('Voice transcript integration', () => {
    it('should use voice transcript when available', async () => {
      const message = createMockMessage({ hasBotMention: true });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockDefaultPersonality);
      (VoiceMessageProcessor.getVoiceTranscript as ReturnType<typeof vi.fn>).mockReturnValue(
        'Voice transcript text'
      );

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockDefaultPersonality,
        'Voice transcript text' // Voice transcript used instead of cleaned content
      );
    });

    it('should use cleaned content when no voice transcript', async () => {
      const message = createMockMessage({ content: '<@987654321> hello', hasBotMention: true });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockDefaultPersonality);
      (VoiceMessageProcessor.getVoiceTranscript as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined
      );

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockDefaultPersonality,
        'hello' // Cleaned content used
      );
    });
  });
});
