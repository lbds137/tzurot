/**
 * Voice Message Processor Tests
 *
 * Tests voice message auto-transcription, forwarded message handling,
 * and processor chain behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';
import type { Message } from 'discord.js';
import type { VoiceTranscriptionService } from '../services/VoiceTranscriptionService.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';

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

import { getConfig } from '@tzurot/common-types';
import { findPersonalityMention } from '../utils/personalityMentionParser.js';

function createMockMessage(overrides: Record<string, unknown> = {}): Message {
  return {
    id: '123456789',
    content: (overrides.content as string) ?? 'Test message',
    author: {
      id: 'user-123',
      username: 'testuser',
      bot: false,
    },
    client: {
      user: {
        id: 'bot-123',
      },
    },
    mentions: {
      has: vi.fn().mockReturnValue(false),
    },
    reference: (overrides.reference as Message['reference']) ?? null,
    attachments: new Map(),
    messageSnapshots: new Map(),
    ...overrides,
  } as unknown as Message;
}

describe('VoiceMessageProcessor', () => {
  let processor: VoiceMessageProcessor;
  let mockVoiceService: {
    hasVoiceAttachment: ReturnType<typeof vi.fn>;
    transcribe: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockVoiceService = {
      hasVoiceAttachment: vi.fn(),
      transcribe: vi.fn(),
    };

    mockPersonalityService = {
      loadPersonality: vi.fn(),
    };

    processor = new VoiceMessageProcessor(
      mockVoiceService as unknown as VoiceTranscriptionService,
      mockPersonalityService as unknown as IPersonalityLoader
    );
  });

  describe('Configuration checks', () => {
    it('should continue processing when AUTO_TRANSCRIBE_VOICE is disabled', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'false',
        BOT_MENTION_CHAR: '@',
      });

      const message = createMockMessage();
      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue to next processor
      expect(mockVoiceService.hasVoiceAttachment).not.toHaveBeenCalled();
    });

    it('should continue processing when no voice attachment', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });

      mockVoiceService.hasVoiceAttachment.mockReturnValue(false);

      const message = createMockMessage();
      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue to next processor
      expect(mockVoiceService.hasVoiceAttachment).toHaveBeenCalledWith(message);
    });
  });

  describe('Voice-only messages', () => {
    beforeEach(() => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });
    });

    it('should continue chain for voice-only messages (for activated channels)', async () => {
      const message = createMockMessage({ content: '' });
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Voice transcript',
        continueToPersonalityHandler: false, // Voice-only (no mention/reply)
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockVoiceService.transcribe).toHaveBeenCalledWith(message, false, false);
      // Should continue to next processor so ActivatedChannelProcessor can handle if channel is activated
      expect(result).toBe(false);
    });

    it('should store transcript on message object for voice-only messages', async () => {
      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Stored transcript',
        continueToPersonalityHandler: false,
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await processor.process(message);

      // Should be able to retrieve transcript
      const transcript = VoiceMessageProcessor.getVoiceTranscript(message);
      expect(transcript).toBe('Stored transcript');
    });
  });

  describe('Voice + personality targeting', () => {
    beforeEach(() => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });
    });

    it('should continue processing for voice+mention', async () => {
      const message = createMockMessage({ content: '@lilith' });
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Voice transcript',
        continueToPersonalityHandler: true, // Has mention
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'lilith',
        cleanContent: '',
      });

      const result = await processor.process(message);

      expect(mockVoiceService.transcribe).toHaveBeenCalledWith(message, true, false);
      expect(result).toBe(false); // Should continue to personality handler
    });

    it('should continue processing for voice+reply', async () => {
      const message = createMockMessage({
        content: '',
        reference: { messageId: 'ref-123' } as Message['reference'],
      });
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Voice transcript',
        continueToPersonalityHandler: true, // Is reply
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockVoiceService.transcribe).toHaveBeenCalledWith(message, false, true);
      expect(result).toBe(false); // Should continue to personality handler
    });

    it('should continue processing for voice+bot mention', async () => {
      const message = createMockMessage({ content: '' });
      message.mentions.has = vi.fn().mockReturnValue(true); // Direct bot mention

      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Voice transcript',
        continueToPersonalityHandler: true,
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockVoiceService.transcribe).toHaveBeenCalledWith(message, true, false);
      expect(result).toBe(false); // Should continue to personality handler
    });

    it('should store transcript on message object when continuing to personality handler', async () => {
      const message = createMockMessage({ content: '@lilith' });
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Transcript for personality',
        continueToPersonalityHandler: true,
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityName: 'lilith',
        cleanContent: '',
      });

      await processor.process(message);

      // Transcript should be stored for personality handler to use
      const transcript = VoiceMessageProcessor.getVoiceTranscript(message);
      expect(transcript).toBe('Transcript for personality');
    });
  });

  describe('Forwarded message handling', () => {
    beforeEach(() => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });
    });

    it('should detect voice attachments in forwarded message snapshots', async () => {
      const message = createMockMessage();
      // hasVoiceAttachment checks both direct attachments and snapshots
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Forwarded voice transcript',
        continueToPersonalityHandler: false,
      });

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await processor.process(message);

      // Should transcribe forwarded audio and continue chain (for activated channels)
      expect(mockVoiceService.hasVoiceAttachment).toHaveBeenCalledWith(message);
      expect(mockVoiceService.transcribe).toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe('Error handling', () => {
    beforeEach(() => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        AUTO_TRANSCRIBE_VOICE: 'true',
        BOT_MENTION_CHAR: '@',
      });
    });

    it('should stop processing when transcription fails', async () => {
      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue(null); // Transcription failed

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await processor.process(message);

      // Should stop processing (transcription failed, error sent to user)
      expect(result).toBe(true);
    });

    it('should not store transcript when transcription fails', async () => {
      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue(null);

      (findPersonalityMention as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await processor.process(message);

      // Should not have stored a transcript
      const transcript = VoiceMessageProcessor.getVoiceTranscript(message);
      expect(transcript).toBeUndefined();
    });
  });

  describe('Static helper', () => {
    it('should return undefined for messages without stored transcript', () => {
      const message = createMockMessage();

      const transcript = VoiceMessageProcessor.getVoiceTranscript(message);

      expect(transcript).toBeUndefined();
    });
  });
});
