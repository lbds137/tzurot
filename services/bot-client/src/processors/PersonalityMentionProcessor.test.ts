/**
 * Personality Mention Processor Tests
 *
 * Tests explicit personality mention handling (e.g., @personality hello).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonalityMentionProcessor } from './PersonalityMentionProcessor.js';
import type { Message } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getConfig: vi.fn(),
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

vi.mock('../utils/personalityMentionParser.js', () => ({
  findPersonalityMention: vi.fn(),
}));

vi.mock('./VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: {
    getVoiceTranscript: vi.fn(),
  },
}));

import { getConfig } from '@tzurot/common-types';
import { findPersonalityMention } from '../utils/personalityMentionParser.js';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';

function createMockMessage(options?: { content?: string }): Message {
  return {
    id: '123456789',
    content: options?.content ?? '@lilith hello',
    author: {
      id: 'user-123',
      username: 'testuser',
      bot: false,
    },
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

describe('PersonalityMentionProcessor', () => {
  let processor: PersonalityMentionProcessor;
  let mockPersonalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityHandler: {
    handleMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      BOT_MENTION_CHAR: '@',
    });

    mockPersonalityService = {
      loadPersonality: vi.fn(),
    };

    mockPersonalityHandler = {
      handleMessage: vi.fn(),
    };

    processor = new PersonalityMentionProcessor(
      mockPersonalityService as unknown as IPersonalityLoader,
      mockPersonalityHandler as unknown as PersonalityMessageHandler
    );
  });

  describe('Personality mention detection', () => {
    it('should continue processing when no personality mention', async () => {
      const message = createMockMessage({ content: 'Hello world' });
      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue to next processor
      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
    });

    it('should handle personality mention', async () => {
      const message = createMockMessage({ content: '@lilith hello' });
      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'lilith',
        cleanContent: 'hello',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('lilith', 'user-123');
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'hello' // Clean content without @mention
      );
      expect(result).toBe(true); // Should stop processing (handled)
    });

    it('should continue processing when personality not found', async () => {
      const message = createMockMessage({ content: '@unknown hello' });
      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'unknown',
        cleanContent: 'hello',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('unknown', 'user-123');
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
      expect(result).toBe(false); // Should continue (unknown personality)
    });
  });

  describe('Voice transcript integration', () => {
    it('should use voice transcript when available', async () => {
      const message = createMockMessage({ content: '@lilith' });
      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'lilith',
        cleanContent: '',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);
      (VoiceMessageProcessor.getVoiceTranscript as ReturnType<typeof vi.fn>).mockReturnValue(
        'Voice transcript text'
      );

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Voice transcript text' // Voice transcript used instead of clean content
      );
    });

    it('should use clean content when no voice transcript', async () => {
      const message = createMockMessage({ content: '@lilith hello' });
      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'lilith',
        cleanContent: 'hello',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);
      (VoiceMessageProcessor.getVoiceTranscript as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined
      );

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'hello' // Clean content used
      );
    });
  });

  describe('Config integration', () => {
    it('should use configured mention character', async () => {
      const message = createMockMessage({ content: '!lilith hello' });
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        BOT_MENTION_CHAR: '!', // Different mention character
      });

      await processor.process(message);

      expect(findPersonalityMention).toHaveBeenCalledWith(
        '!lilith hello',
        '!',
        expect.anything(),
        'user-123'
      );
    });
  });
});
