/**
 * Voice Message Processor Tests
 *
 * Tests voice message auto-transcription, forwarded message handling,
 * and processor chain behavior using config cascade settings.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';
import type { Message } from 'discord.js';
import type { VoiceTranscriptionService } from '../services/VoiceTranscriptionService.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';

// Mock dependencies
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  getAdminSettingsCached: vi.fn(),
}));

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: vi.fn(),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

vi.mock('../utils/personalityMentionParser.js', () => ({
  findPersonalityMentions: vi.fn(),
}));

import { getConfig } from '@tzurot/common-types/config/config';
import { findPersonalityMentions } from '../utils/personalityMentionParser.js';
import { getAdminSettingsCached } from '../utils/gatewayServiceCalls.js';

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

    vi.mocked(getAdminSettingsCached).mockResolvedValue({
      configDefaults: { voiceTranscriptionEnabled: true },
    } as Awaited<ReturnType<typeof getAdminSettingsCached>>);

    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      BOT_MENTION_CHAR: '@',
    });

    processor = new VoiceMessageProcessor(
      mockVoiceService as unknown as VoiceTranscriptionService,
      mockPersonalityService as unknown as IPersonalityLoader
    );
  });

  describe('Configuration checks', () => {
    it('should skip gateway call when no voice attachment', async () => {
      mockVoiceService.hasVoiceAttachment.mockReturnValue(false);

      const message = createMockMessage();
      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue to next processor
      expect(mockVoiceService.hasVoiceAttachment).toHaveBeenCalledWith(message);
      expect(vi.mocked(getAdminSettingsCached)).not.toHaveBeenCalled();
    });

    it('should continue processing when voiceTranscriptionEnabled is false via admin cascade', async () => {
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      vi.mocked(getAdminSettingsCached).mockResolvedValue({
        configDefaults: { voiceTranscriptionEnabled: false },
      } as Awaited<ReturnType<typeof getAdminSettingsCached>>);

      const message = createMockMessage();
      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue to next processor
      expect(mockVoiceService.transcribe).not.toHaveBeenCalled();
    });

    it('should default to enabled when admin settings are null', async () => {
      vi.mocked(getAdminSettingsCached).mockResolvedValue(null);

      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'test',
        continueToPersonalityHandler: false,
      });

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await processor.process(message);

      expect(result).toBe(false);
      // Should proceed to transcription (transcription enabled by default)
      expect(mockVoiceService.transcribe).toHaveBeenCalled();
    });

    it('should default to enabled when configDefaults is null', async () => {
      vi.mocked(getAdminSettingsCached).mockResolvedValue({
        configDefaults: null,
      } as Awaited<ReturnType<typeof getAdminSettingsCached>>);

      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'test',
        continueToPersonalityHandler: false,
      });

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await processor.process(message);

      expect(result).toBe(false);
      expect(mockVoiceService.transcribe).toHaveBeenCalled();
    });

    it('should default to enabled when getAdminSettings throws', async () => {
      vi.mocked(getAdminSettingsCached).mockRejectedValue(new Error('Gateway unreachable'));

      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'test',
        continueToPersonalityHandler: false,
      });

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await processor.process(message);

      expect(result).toBe(false);
      // Should still transcribe using hardcoded default (enabled)
      expect(mockVoiceService.transcribe).toHaveBeenCalled();
    });
  });

  describe('Voice-only messages', () => {
    it('should continue chain for voice-only messages (for activated channels)', async () => {
      const message = createMockMessage({ content: '' });
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Voice transcript',
        continueToPersonalityHandler: false, // Voice-only (no mention/reply)
      });

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

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

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await processor.process(message);

      // Should be able to retrieve transcript
      const transcript = VoiceMessageProcessor.getVoiceTranscript(message);
      expect(transcript).toBe('Stored transcript');
    });
  });

  describe('Voice + personality targeting', () => {
    it('should continue processing for voice+mention', async () => {
      const message = createMockMessage({ content: '@lilith' });
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Voice transcript',
        continueToPersonalityHandler: true, // Has mention
      });

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          personality: { id: 'mock-id-lilith', name: 'lilith' },
          startIndex: 0,
        },
      ]);

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

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

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

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

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

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          personality: { id: 'mock-id-lilith', name: 'lilith' },
          startIndex: 0,
        },
      ]);

      await processor.process(message);

      // Transcript should be stored for personality handler to use
      const transcript = VoiceMessageProcessor.getVoiceTranscript(message);
      expect(transcript).toBe('Transcript for personality');
    });
  });

  describe('Forwarded message handling', () => {
    it('should detect voice attachments in forwarded message snapshots', async () => {
      const message = createMockMessage();
      // hasVoiceAttachment checks both direct attachments and snapshots
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'Forwarded voice transcript',
        continueToPersonalityHandler: false,
      });

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await processor.process(message);

      // Should transcribe forwarded audio and continue chain (for activated channels)
      expect(mockVoiceService.hasVoiceAttachment).toHaveBeenCalledWith(message);
      expect(mockVoiceService.transcribe).toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should stop processing when transcription fails', async () => {
      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue(null); // Transcription failed

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await processor.process(message);

      // Should stop processing (transcription failed, error sent to user)
      expect(result).toBe(true);
    });

    it('should not store transcript when transcription fails', async () => {
      const message = createMockMessage();
      mockVoiceService.hasVoiceAttachment.mockReturnValue(true);
      mockVoiceService.transcribe.mockResolvedValue(null);

      (findPersonalityMentions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

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
