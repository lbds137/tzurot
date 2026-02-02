/**
 * VoiceTranscriptionService Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoiceTranscriptionService } from './VoiceTranscriptionService.js';
import type { Message } from 'discord.js';
import { MessageReferenceType } from 'discord.js';
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
    splitMessage: vi.fn((content: string) => {
      // Simple mock: split on 2000 char boundaries
      const chunks: string[] = [];
      for (let i = 0; i < content.length; i += 2000) {
        chunks.push(content.slice(i, i + 2000));
      }
      return chunks.length > 0 ? chunks : [content];
    }),
  };
});

import { splitMessage } from '@tzurot/common-types';
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

    it('should detect voice attachment in forwarded message snapshot', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.ogg',
                contentType: 'audio/ogg',
                name: 'voice.ogg',
                size: 50000,
                duration: 5.2,
              },
            ],
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(true);
    });

    it('should detect voice attachment in snapshot by duration', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.bin',
                contentType: 'application/octet-stream',
                name: 'voice.bin',
                size: 50000,
                duration: 10.0,
              },
            ],
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(true);
    });

    it('should return false when forwarded snapshot has no audio', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/image.png',
                contentType: 'image/png',
                name: 'image.png',
                size: 50000,
                duration: null,
              },
            ],
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('should return false when forwarded snapshot has empty attachments', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [],
          },
        ],
      });

      expect(service.hasVoiceAttachment(message)).toBe(false);
    });

    it('should return false when forwarded snapshot has null attachments', () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: null,
          },
        ],
      });

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
      expect((message.channel as { sendTyping?: unknown }).sendTyping).toHaveBeenCalledOnce();

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

      // Should reply with transcript (without pinging user)
      expect(message.reply).toHaveBeenCalledWith({
        content: 'This is the transcribed text',
        allowedMentions: { repliedUser: false },
      });

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

      // Should call splitMessage for chunking
      expect(splitMessage).toHaveBeenCalledWith(longTranscript);

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
      expect(message.reply).toHaveBeenCalledWith({
        content: "Sorry, I couldn't transcribe that voice message.",
        allowedMentions: { repliedUser: false },
      });
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
      expect(message.reply).toHaveBeenCalledWith({
        content: "Sorry, I couldn't transcribe that voice message.",
        allowedMentions: { repliedUser: false },
      });
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
      expect((message.channel as { sendTyping?: unknown }).sendTyping).toBeUndefined();
    });

    it('should transcribe voice from forwarded message snapshot when no direct attachments', async () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.ogg',
                contentType: 'audio/ogg',
                name: 'forwarded-voice.ogg',
                size: 45000,
                duration: 8.5,
                waveform: 'forwardedWaveformData',
              },
            ],
          },
        ],
      });

      mockGatewayClient.transcribe.mockResolvedValue({
        content: 'Transcribed from forwarded message',
      });

      const result = await service.transcribe(message, false, false);

      expect(result).toEqual({
        transcript: 'Transcribed from forwarded message',
        continueToPersonalityHandler: false,
      });

      // Should call gateway transcribe with forwarded attachment metadata
      expect(mockGatewayClient.transcribe).toHaveBeenCalledWith([
        {
          url: 'https://cdn.discord.com/voice/forwarded.ogg',
          contentType: 'audio/ogg',
          name: 'forwarded-voice.ogg',
          size: 45000,
          isVoiceMessage: true,
          duration: 8.5,
          waveform: 'forwardedWaveformData',
        },
      ]);

      // Should cache in Redis with forwarded attachment URL
      expect(voiceTranscriptCache.store).toHaveBeenCalledWith(
        'https://cdn.discord.com/voice/forwarded.ogg',
        'Transcribed from forwarded message'
      );
    });

    it('should handle forwarded snapshot with null contentType', async () => {
      const message = createMockMessage({
        attachments: [],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.bin',
                contentType: null,
                name: 'forwarded-voice.bin',
                size: 45000,
                duration: 5.0,
              },
            ],
          },
        ],
      });

      mockGatewayClient.transcribe.mockResolvedValue({
        content: 'Transcribed with fallback content type',
      });

      await service.transcribe(message, false, false);

      // Should use CONTENT_TYPES.BINARY as fallback
      const call = mockGatewayClient.transcribe.mock.calls[0][0];
      expect(call[0].contentType).toBe(CONTENT_TYPES.BINARY);
    });

    it('should prefer direct attachments over forwarded snapshots', async () => {
      const message = createMockMessage({
        attachments: [
          {
            url: 'https://cdn.discord.com/voice/direct.ogg',
            contentType: 'audio/ogg',
            name: 'direct-voice.ogg',
            size: 30000,
            duration: 3.0,
          },
        ],
        messageSnapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.ogg',
                contentType: 'audio/ogg',
                name: 'forwarded-voice.ogg',
                size: 45000,
                duration: 8.5,
              },
            ],
          },
        ],
      });

      mockGatewayClient.transcribe.mockResolvedValue({
        content: 'Transcribed direct attachment',
      });

      await service.transcribe(message, false, false);

      // Should use direct attachment, not forwarded
      const call = mockGatewayClient.transcribe.mock.calls[0][0];
      expect(call[0].url).toBe('https://cdn.discord.com/voice/direct.ogg');
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
  waveform?: string | null;
}

interface MockSnapshotAttachment {
  url: string;
  contentType: string | null;
  name: string;
  size: number;
  duration: number | null;
  waveform?: string | null;
}

interface MockMessageSnapshot {
  attachments: MockSnapshotAttachment[] | null;
}

interface MockMessageOptions {
  attachments?: MockAttachment[];
  messageSnapshots?: MockMessageSnapshot[];
  noTypingSupport?: boolean;
}

function createMockAttachmentsMap(attachmentsList: MockSnapshotAttachment[] | null): Map<
  string,
  MockSnapshotAttachment
> & {
  some: (predicate: (a: MockSnapshotAttachment) => boolean) => boolean;
} {
  const map = new Map<string, MockSnapshotAttachment>();

  if (attachmentsList) {
    attachmentsList.forEach((att, index) => {
      map.set(`snapshot-att-${index}`, att);
    });
  }

  // Add Collection-like methods
  (map as any).some = function (predicate: (a: MockSnapshotAttachment) => boolean) {
    for (const value of this.values()) {
      if (predicate(value)) {
        return true;
      }
    }
    return false;
  };

  return map as Map<string, MockSnapshotAttachment> & {
    some: (predicate: (a: MockSnapshotAttachment) => boolean) => boolean;
  };
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

  // Create messageSnapshots if provided
  let messageSnapshots:
    | Map<string, { attachments: ReturnType<typeof createMockAttachmentsMap> }>
    | undefined;
  if (options.messageSnapshots && options.messageSnapshots.length > 0) {
    messageSnapshots = new Map();
    options.messageSnapshots.forEach((snapshot, index) => {
      messageSnapshots!.set(`snapshot-${index}`, {
        attachments: createMockAttachmentsMap(snapshot.attachments),
      });
    });
  }

  const channel: any = options.noTypingSupport
    ? {}
    : {
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };

  // If messageSnapshots is provided, include forward reference type
  // This is required by the centralized forwardedMessageUtils detection
  const reference = messageSnapshots !== undefined ? { type: MessageReferenceType.Forward } : null;

  return {
    attachments,
    messageSnapshots,
    reference,
    channel,
    reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
  } as unknown as Message;
}
