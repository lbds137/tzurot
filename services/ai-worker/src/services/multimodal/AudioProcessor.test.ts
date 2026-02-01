/**
 * Tests for Audio Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeAudio } from './AudioProcessor.js';
import type { AttachmentMetadata, LoadedPersonality } from '@tzurot/common-types';
import { CONTENT_TYPES } from '@tzurot/common-types';

// Create mock functions
const mockWhisperCreate = vi.fn().mockResolvedValue('Mocked transcription');
const mockVoiceTranscriptCacheGet = vi.fn().mockResolvedValue(null);

// Mock dependencies
vi.mock('openai', () => ({
  default: class MockOpenAI {
    audio = {
      transcriptions: {
        create: mockWhisperCreate,
      },
    };
  },
}));

vi.mock('../../redis.js', () => ({
  voiceTranscriptCache: {
    get: mockVoiceTranscriptCacheGet,
    store: vi.fn(),
  },
}));

// Mock fetch
global.fetch = vi.fn();

describe('AudioProcessor', () => {
  const mockPersonality = {
    id: 'test',
    name: 'Test',
    displayName: 'Test',
    slug: 'test',
    systemPrompt: 'Test prompt',
    model: 'gpt-4',
    visionModel: undefined,
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 8000,
    characterInfo: '',
    personalityTraits: '',
  } as LoadedPersonality;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhisperCreate.mockResolvedValue('Mocked transcription');
    mockVoiceTranscriptCacheGet.mockResolvedValue(null);
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

        const result = await transcribeAudio(attachment, mockPersonality);

        expect(result).toBe('Cached transcription from Redis');
        expect(mockVoiceTranscriptCacheGet).toHaveBeenCalledWith(attachment.originalUrl);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(mockWhisperCreate).not.toHaveBeenCalled();
      });

      it('should skip cache when originalUrl is not provided', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          // No originalUrl
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment, mockPersonality);

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

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment, mockPersonality);

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

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        const result = await transcribeAudio(attachment, mockPersonality);

        expect(result).toBe('Mocked transcription');
        expect(global.fetch).toHaveBeenCalled();
        expect(mockWhisperCreate).toHaveBeenCalled();
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

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment, mockPersonality);

        expect(global.fetch).toHaveBeenCalled();
        expect(mockWhisperCreate).toHaveBeenCalled();
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

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment, mockPersonality);

        expect(global.fetch).toHaveBeenCalled();
        expect(mockWhisperCreate).toHaveBeenCalled();
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

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2048)),
        });

        const result = await transcribeAudio(attachment, mockPersonality);

        expect(result).toBe('Mocked transcription');
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

        await expect(transcribeAudio(attachment, mockPersonality)).rejects.toThrow('Network error');
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

        await expect(transcribeAudio(attachment, mockPersonality)).rejects.toThrow(
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

        await expect(transcribeAudio(attachment, mockPersonality)).rejects.toThrow(
          'Audio file download timed out'
        );
      });
    });

    describe('Whisper transcription', () => {
      it('should transcribe audio successfully', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'test-audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 4096,
          duration: 30,
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4096)),
        });

        mockWhisperCreate.mockResolvedValue('This is a transcribed message');

        const result = await transcribeAudio(attachment, mockPersonality);

        expect(result).toBe('This is a transcribed message');
        expect(mockWhisperCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            file: expect.any(File),
            model: expect.any(String),
            language: expect.any(String),
            response_format: 'text',
          })
        );
      });

      it('should create File object with correct name', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'my-recording.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment, mockPersonality);

        const fileArg = mockWhisperCreate.mock.calls[0][0].file;
        expect(fileArg.name).toBe('my-recording.ogg');
      });

      it('should use default name when attachment name is missing', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          // No name
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment, mockPersonality);

        const fileArg = mockWhisperCreate.mock.calls[0][0].file;
        expect(fileArg.name).toBe('audio.ogg');
      });

      it('should use default name when attachment name is empty', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: '',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment, mockPersonality);

        const fileArg = mockWhisperCreate.mock.calls[0][0].file;
        expect(fileArg.name).toBe('audio.ogg');
      });

      it('should handle Whisper API errors', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        mockWhisperCreate.mockRejectedValue(new Error('Whisper API error'));

        await expect(transcribeAudio(attachment, mockPersonality)).rejects.toThrow(
          'Whisper API error'
        );
      });
    });

    describe('different audio formats', () => {
      const testFormats = [
        { contentType: CONTENT_TYPES.AUDIO_OGG, name: 'OGG format' },
        { contentType: 'audio/mpeg', name: 'MP3 format' },
        { contentType: 'audio/wav', name: 'WAV format' },
        { contentType: 'audio/webm', name: 'WebM format' },
      ];

      testFormats.forEach(({ contentType, name }) => {
        it(`should handle ${name}`, async () => {
          const attachment: AttachmentMetadata = {
            url: 'https://example.com/audio',
            name: 'audio',
            contentType,
            size: 1024,
          };

          (global.fetch as any).mockResolvedValue({
            ok: true,
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
          });

          const result = await transcribeAudio(attachment, mockPersonality);

          expect(result).toBe('Mocked transcription');
          const fileArg = mockWhisperCreate.mock.calls[0][0].file;
          expect(fileArg.type).toBe(contentType);
        });
      });
    });

    describe('voice message handling', () => {
      it('should handle voice messages with duration', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/voice.ogg',
          name: 'voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 8192,
          duration: 120, // 2 minutes
          isVoiceMessage: true,
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8192)),
        });

        const result = await transcribeAudio(attachment, mockPersonality);

        expect(result).toBe('Mocked transcription');
        expect(mockWhisperCreate).toHaveBeenCalled();
      });

      it('should handle very long voice messages', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://example.com/long-voice.ogg',
          name: 'long-voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 32768,
          duration: 900, // 15 minutes
          isVoiceMessage: true,
        };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(32768)),
        });

        mockWhisperCreate.mockResolvedValue('Very long transcription...');

        const result = await transcribeAudio(attachment, mockPersonality);

        expect(result).toBe('Very long transcription...');
      });
    });
  });
});
