/**
 * VoiceTranscriptionService Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoiceTranscriptionService } from './VoiceTranscriptionService.js';
import type { Message } from 'discord.js';
import { CONTENT_TYPES } from '@tzurot/common-types';

// Mock dependencies
vi.mock('../utils/GatewayClient.js', () => ({
  GatewayClient: vi.fn(),
}));

vi.mock('../redis.js', () => ({
  voiceTranscriptCache: {
    store: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    preserveCodeBlocks: vi.fn((content: string) => {
      // Simple mock: split on 2000 char boundaries
      const chunks: string[] = [];
      for (let i = 0; i < content.length; i += 2000) {
        chunks.push(content.slice(i, i + 2000));
      }
      return chunks.length > 0 ? chunks : [content];
    }),
  };
});

import { preserveCodeBlocks } from '@tzurot/common-types';
import { voiceTranscriptCache } from '../redis.js';

describe('VoiceTranscriptionService', () => {
  let service: VoiceTranscriptionService;
  let mockGatewayClient: {
    transcribe: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGatewayClient = {
      transcribe: vi.fn(),
    };

    service = new VoiceTranscriptionService(mockGatewayClient as any);
  });

  describe('hasVoiceAttachment', () => {
    it('should detect voice attachment by audio content type', () => {
      const message = createMockMessage({
        attachments: [
          {
            contentType: 'audio/ogg',
            duration: null,
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(true);
    });

    it('should detect voice attachment by duration property', () => {
      const message = createMockMessage({
        attachments: [
          {
            contentType: 'application/octet-stream',
            duration: 5.2,
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(true);
    });

    it('should return false for non-voice attachments', () => {
      const message = createMockMessage({
        attachments: [
          {
            contentType: 'image/png',
            duration: null,
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('should return false when no attachments', () => {
      const message = createMockMessage({ attachments: [] });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });
  });

  describe('transcribe', () => {
    it('should transcribe voice message and send to Discord', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice-message.ogg',
            size: 50000,
            duration: 5.2,
            waveform: 'base64data',
          },
        ],
      });

      mockGatewayClient.transcribe.mockResolvedValue({
        content: 'This is the transcribed text',
      });

      const result = await service.transcribe(message, false, false);

      expect(result).toEqual({
        transcript: 'This is the transcribed text',
        continueToPersonalityHandler: false,
      });

      // Should send typing indicator
      expect(message.channel.sendTyping).toHaveBeenCalledOnce();

      // Should call gateway transcribe with attachment metadata
      expect(mockGatewayClient.transcribe).toHaveBeenCalledWith([
        {
          url: 'https://cdn.discord.com/voice/123.ogg',
          contentType: 'audio/ogg',
          name: 'voice-message.ogg',
          size: 50000,
          isVoiceMessage: true,
          duration: 5.2,
          waveform: 'base64data',
        },
      ]);

      // Should reply with transcript
      expect(message.reply).toHaveBeenCalledWith('This is the transcribed text');

      // Should cache in Redis
      expect(voiceTranscriptCache.store).toHaveBeenCalledWith(
        'https://cdn.discord.com/voice/123.ogg',
        'This is the transcribed text'
      );
    });

    it('should set continueToPersonalityHandler=true when hasMention=true', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      mockGatewayClient.transcribe.mockResolvedValue({
        content: 'Transcript with mention',
      });

      const result = await service.transcribe(message, true, false);

      expect(result?.continueToPersonalityHandler).toBe(true);
    });

    it('should set continueToPersonalityHandler=true when isReply=true', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      mockGatewayClient.transcribe.mockResolvedValue({
        content: 'Transcript as reply',
      });

      const result = await service.transcribe(message, false, true);

      expect(result?.continueToPersonalityHandler).toBe(true);
    });

    it('should handle chunked transcripts', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 30.0,
          },
        ],
      });

      // Long transcript that will be chunked
      const longTranscript = 'x'.repeat(3000);
      mockGatewayClient.transcribe.mockResolvedValue({
        content: longTranscript,
      });

      await service.transcribe(message, false, false);

      // Should call preserveCodeBlocks
      expect(preserveCodeBlocks).toHaveBeenCalledWith(longTranscript);

      // Should send multiple replies (mocked to create 2 chunks)
      expect(message.reply).toHaveBeenCalledTimes(2);
    });

    it('should handle missing contentType gracefully', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.bin',
            contentType: null,
            name: 'voice.bin',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      mockGatewayClient.transcribe.mockResolvedValue({
        content: 'Transcribed text',
      });

      await service.transcribe(message, false, false);

      // Should use CONTENT_TYPES.BINARY as fallback
      const call = mockGatewayClient.transcribe.mock.calls[0][0];
      expect(call[0].contentType).toBe(CONTENT_TYPES.BINARY);
    });

    it('should return null and send error message when transcription fails', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      mockGatewayClient.transcribe.mockRejectedValue(new Error('Transcription failed'));

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
      expect(message.reply).toHaveBeenCalledWith(
        "Sorry, I couldn't transcribe that voice message."
      );
    });

    it('should return null when gateway returns empty response', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      mockGatewayClient.transcribe.mockResolvedValue(null);

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
      expect(message.reply).toHaveBeenCalledWith(
        "Sorry, I couldn't transcribe that voice message."
      );
    });

    it('should return null when gateway returns response without content', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      mockGatewayClient.transcribe.mockResolvedValue({ content: '' });

      const result = await service.transcribe(message, false, false);

      expect(result).toBeNull();
    });

    it('should not throw if error reply fails', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
      });

      mockGatewayClient.transcribe.mockRejectedValue(new Error('Transcription failed'));
      (message.reply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Channel deleted'));

      // Should not throw
      const result = await service.transcribe(message, false, false);
      expect(result).toBeNull();
    });

    it('should skip typing indicator if channel does not support it', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/123.ogg',
            contentType: 'audio/ogg',
            name: 'voice.ogg',
            size: 50000,
            duration: 5.2,
          },
        ],
        noTypingSupport: true,
      });

      mockGatewayClient.transcribe.mockResolvedValue({
        content: 'Transcript',
      });

      await service.transcribe(message, false, false);

      // Should not have called sendTyping
      expect(message.channel.sendTyping).toBeUndefined();
    });
  });
});

// Helper function to create mock Discord message
interface MockAttachment {
  url?: string;
  contentType?: string | null;
  name?: string;
  size?: number;
  duration?: number | null;
  waveform?: string;
}

interface MockMessageOptions {
  attachments?: MockAttachment[];
  noTypingSupport?: boolean;
}

function createMockMessage(options: MockMessageOptions = {}): Message {
  const attachments = new Map();

  (options.attachments || []).forEach((att, index) => {
    attachments.set(`attachment-${index}`, {
      url: att.url || `https://cdn.discord.com/file-${index}`,
      contentType: att.contentType === undefined ? 'application/octet-stream' : att.contentType,
      name: att.name || `file-${index}`,
      size: att.size || 1000,
      duration: att.duration === undefined ? null : att.duration,
      waveform: att.waveform,
    });
  });

  // Add Collection-like methods to Map (Discord.js Collection extends Map)
  (attachments as any).some = function (predicate: any) {
    for (const value of this.values()) {
      if (predicate(value)) {
        return true;
      }
    }
    return false;
  };

  const channel: any = options.noTypingSupport
    ? {}
    : {
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };

  return {
    attachments,
    channel,
    reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
  } as unknown as Message;
}
