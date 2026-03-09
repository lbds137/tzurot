/**
 * Tests for Audio Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeAudio } from './AudioProcessor.js';
import type { AttachmentMetadata } from '@tzurot/common-types';
import { CONTENT_TYPES } from '@tzurot/common-types';

// Create mock functions
const mockVoiceTranscriptCacheGet = vi.fn().mockResolvedValue(null);
const mockVoiceEngineTranscribe = vi.fn();
let mockVoiceEngineClient: { transcribe: typeof mockVoiceEngineTranscribe } | null = null;

vi.mock('../../redis.js', () => ({
  voiceTranscriptCache: {
    get: mockVoiceTranscriptCacheGet,
    store: vi.fn(),
  },
}));

vi.mock('../voice/VoiceEngineClient.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../voice/VoiceEngineClient.js')>();
  return {
    ...actual,
    getVoiceEngineClient: () => mockVoiceEngineClient,
    resetVoiceEngineClient: vi.fn(),
  };
});

const mockElevenLabsSTT = vi.fn();
vi.mock('../voice/ElevenLabsClient.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../voice/ElevenLabsClient.js')>();
  return {
    ...actual,
    elevenLabsSTT: (...args: unknown[]) => mockElevenLabsSTT(...args),
  };
});

// Mock fetch
global.fetch = vi.fn();

describe('AudioProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceTranscriptCacheGet.mockResolvedValue(null);
    mockVoiceEngineClient = null;
    mockVoiceEngineTranscribe.mockReset();
    mockElevenLabsSTT.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('transcribeAudio', () => {
    describe('Redis caching', () => {
      it('should return cached transcript when available', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://cdn.discord.com/attachments/123/456/audio.ogg',
          originalUrl: 'https://cdn.discord.com/attachments/123/456/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceTranscriptCacheGet.mockResolvedValue('Cached transcription from Redis');

        const result = await transcribeAudio(attachment);

        expect(result).toBe('Cached transcription from Redis');
        expect(mockVoiceTranscriptCacheGet).toHaveBeenCalledWith(attachment.originalUrl);
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('should skip cache when originalUrl is not provided', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment);

        expect(mockVoiceTranscriptCacheGet).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalled();
      });

      it('should skip cache when originalUrl is empty string', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          originalUrl: '',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment);

        expect(mockVoiceTranscriptCacheGet).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalled();
      });

      it('should proceed with transcription if cache check fails', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          originalUrl: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceTranscriptCacheGet.mockRejectedValue(new Error('Redis connection failed'));

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Fallback result' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        const result = await transcribeAudio(attachment);

        expect(result).toBe('Fallback result');
        expect(global.fetch).toHaveBeenCalled();
      });

      it('should skip cache when cached value is null', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          originalUrl: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceTranscriptCacheGet.mockResolvedValue(null);

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment);

        expect(global.fetch).toHaveBeenCalled();
      });

      it('should skip cache when cached value is empty string', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          originalUrl: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceTranscriptCacheGet.mockResolvedValue('');

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment);

        expect(global.fetch).toHaveBeenCalled();
      });
    });

    describe('voice-engine integration', () => {
      it('should use voice-engine when configured and healthy', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Voice engine transcription' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        const result = await transcribeAudio(attachment);

        expect(result).toBe('Voice engine transcription');
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('should return empty string from voice-engine without falling back', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: '' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        const result = await transcribeAudio(attachment);

        expect(result).toBe('');
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('should throw when voice-engine fails and no other provider available', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockRejectedValue(new Error('Voice engine down'));
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await expect(transcribeAudio(attachment)).rejects.toThrow('No STT provider available');
      });

      it('should throw when no STT provider is configured', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        // No voice engine, no ElevenLabs key

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await expect(transcribeAudio(attachment)).rejects.toThrow('No STT provider available');
      });
    });

    describe('audio fetching', () => {
      it('should fetch audio successfully', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2048)),
        });

        const result = await transcribeAudio(attachment);

        expect(result).toBe('transcribed');
        expect(global.fetch).toHaveBeenCalledWith(
          attachment.url,
          expect.objectContaining({
            signal: expect.any(AbortSignal),
          })
        );
      });

      it('should handle fetch failure', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        (global.fetch as any).mockRejectedValue(new Error('Network error'));

        await expect(transcribeAudio(attachment)).rejects.toThrow('Network error');
      });

      it('should handle HTTP error responses', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        (global.fetch as any).mockResolvedValue({
          ok: false,
          statusText: 'Not Found',
        });

        await expect(transcribeAudio(attachment)).rejects.toThrow(
          'Failed to fetch audio: Not Found'
        );
      });

      it('should handle fetch timeout with AbortError', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        (global.fetch as any).mockRejectedValue(abortError);

        await expect(transcribeAudio(attachment)).rejects.toThrow('Audio file download timed out');
      });
    });

    describe('voice message handling', () => {
      it('should handle voice messages with duration', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/voice.ogg',
          name: 'voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 8192,
          duration: 120,
          isVoiceMessage: true,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Voice message text' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8192)),
        });

        const result = await transcribeAudio(attachment);

        expect(result).toBe('Voice message text');
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });
    });

    describe('ElevenLabs STT integration', () => {
      const audioAttachment: AttachmentMetadata = {
        url: 'https://example.com/audio.ogg',
        name: 'audio.ogg',
        contentType: CONTENT_TYPES.AUDIO_OGG,
        size: 2048,
      };

      beforeEach(() => {
        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2048)),
        });
      });

      it('should use ElevenLabs STT when apiKey is provided', async () => {
        mockElevenLabsSTT.mockResolvedValue({ text: 'ElevenLabs transcription' });

        const result = await transcribeAudio(audioAttachment, 'sk_el_test');

        expect(result).toBe('ElevenLabs transcription');
        expect(mockElevenLabsSTT).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKey: 'sk_el_test',
            filename: 'audio.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
          })
        );
      });

      it('should fall back to voice-engine when ElevenLabs fails', async () => {
        mockElevenLabsSTT.mockRejectedValue(new Error('ElevenLabs down'));
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Voice engine result' });

        const result = await transcribeAudio(audioAttachment, 'sk_el_test');

        expect(result).toBe('Voice engine result');
        expect(mockElevenLabsSTT).toHaveBeenCalled();
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('should throw when both ElevenLabs and voice-engine fail', async () => {
        mockElevenLabsSTT.mockRejectedValue(new Error('ElevenLabs down'));
        // No voice engine configured

        await expect(transcribeAudio(audioAttachment, 'sk_el_test')).rejects.toThrow(
          'No STT provider available'
        );
      });

      it('should skip ElevenLabs when no apiKey provided', async () => {
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'voice engine result' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe };

        const result = await transcribeAudio(audioAttachment);

        expect(mockElevenLabsSTT).not.toHaveBeenCalled();
        expect(result).toBe('voice engine result');
      });
    });
  });
});
