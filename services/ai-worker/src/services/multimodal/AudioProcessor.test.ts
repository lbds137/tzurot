/**
 * Tests for Audio Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeAudio } from './AudioProcessor.js';
import { CONTENT_TYPES, TimeoutError, type AttachmentMetadata } from '@tzurot/common-types';

// Create mock functions
const mockVoiceTranscriptCacheGet = vi.fn().mockResolvedValue(null);
const mockVoiceEngineTranscribe = vi.fn();
const mockGetHealth = vi.fn().mockResolvedValue({ asr: true, tts: true });
let mockVoiceEngineClient: {
  transcribe: typeof mockVoiceEngineTranscribe;
  getHealth: typeof mockGetHealth;
} | null = null;

const mockWaitForVoiceEngine = vi.fn().mockResolvedValue({ ready: true, elapsedMs: 0 });
vi.mock('../voice/voiceEngineWarmup.js', () => ({
  waitForVoiceEngine: (...args: unknown[]) => mockWaitForVoiceEngine(...args),
}));

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
    mockGetHealth.mockReset().mockResolvedValue({ asr: true, tts: true });
    mockWaitForVoiceEngine.mockReset().mockResolvedValue({ ready: true, elapsedMs: 0 });
    mockElevenLabsSTT.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('transcribeAudio', () => {
    describe('Redis caching', () => {
      it('should return cached transcript when available', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://cdn.discordapp.com/attachments/123/456/audio.ogg',
          originalUrl: 'https://cdn.discordapp.com/attachments/123/456/audio.ogg',
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
          url: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

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
          url: 'https://cdn.discordapp.com/audio.ogg',
          originalUrl: '',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

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
          url: 'https://cdn.discordapp.com/audio.ogg',
          originalUrl: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceTranscriptCacheGet.mockRejectedValue(new Error('Redis connection failed'));

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Fallback result' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

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
          url: 'https://cdn.discordapp.com/audio.ogg',
          originalUrl: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceTranscriptCacheGet.mockResolvedValue(null);

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await transcribeAudio(attachment);

        expect(global.fetch).toHaveBeenCalled();
      });

      it('should skip cache when cached value is empty string', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://cdn.discordapp.com/audio.ogg',
          originalUrl: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceTranscriptCacheGet.mockResolvedValue('');

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

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
          url: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Voice engine transcription' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

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
          url: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: '' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

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
          url: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        mockVoiceEngineTranscribe.mockRejectedValue(new Error('Voice engine down'));
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await expect(transcribeAudio(attachment)).rejects.toThrow('No STT provider available');
      });

      it('should throw when no STT provider is configured', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://cdn.discordapp.com/audio.ogg',
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

    describe('voice-engine warm-up', () => {
      const warmupAttachment: AttachmentMetadata = {
        url: 'https://cdn.discordapp.com/audio.ogg',
        name: 'audio.ogg',
        contentType: CONTENT_TYPES.AUDIO_OGG,
        size: 1024,
      };

      beforeEach(() => {
        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });
      });

      it('calls waitForVoiceEngine with asr capability before transcription', async () => {
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'warm result' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

        await transcribeAudio(warmupAttachment);

        expect(mockWaitForVoiceEngine).toHaveBeenCalledWith(mockVoiceEngineClient, 'asr');
        expect(mockWaitForVoiceEngine).toHaveBeenCalledTimes(1);
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('proceeds with transcription even when warm-up returns false (budget exhausted)', async () => {
        mockWaitForVoiceEngine.mockResolvedValue(false);
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'still works' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

        const result = await transcribeAudio(warmupAttachment);

        expect(result).toBe('still works');
        expect(mockWaitForVoiceEngine).toHaveBeenCalledWith(mockVoiceEngineClient, 'asr');
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('does not call warm-up when voice engine client is null', async () => {
        // No voice engine configured — should throw "No STT provider"
        await expect(transcribeAudio(warmupAttachment)).rejects.toThrow(
          'No STT provider available'
        );
        expect(mockWaitForVoiceEngine).not.toHaveBeenCalled();
      });
    });

    describe('audio fetching', () => {
      it('should fetch audio successfully', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'transcribed' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

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
          url: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        (global.fetch as any).mockRejectedValue(new Error('Network error'));

        await expect(transcribeAudio(attachment)).rejects.toThrow('Network error');
      });

      it('should handle HTTP error responses', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://cdn.discordapp.com/audio.ogg',
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

      it('should throw TimeoutError on fetch abort', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        (global.fetch as any).mockRejectedValue(abortError);

        const error = await transcribeAudio(attachment).catch(e => e);
        expect(error).toBeInstanceOf(TimeoutError);
        expect(error.operationName).toBe('audio file download');
        expect(error.timeoutMs).toBe(30_000);
      });

      it('should reject non-allowlisted URLs with SSRF guard error before fetching', async () => {
        // Pins the invariant that validateAttachmentUrl runs before any network
        // work inside fetchAudioBuffer. A future refactor that moves the guard
        // to run after fetch (or removes it entirely) would fail this test,
        // even though the happy-path tests above use pre-validated fixtures.
        const attachment: AttachmentMetadata = {
          url: 'https://evil.example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        await expect(transcribeAudio(attachment)).rejects.toThrow(/must be from Discord CDN/);
        // Load-bearing: the SSRF guard short-circuits before fetch is invoked.
        expect(global.fetch).not.toHaveBeenCalled();
      });
    });

    describe('voice message handling', () => {
      it('should handle voice messages with duration', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://cdn.discordapp.com/voice.ogg',
          name: 'voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 8192,
          duration: 120,
          isVoiceMessage: true,
        };

        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Voice message text' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8192)),
        });

        const result = await transcribeAudio(attachment);

        expect(result).toBe('Voice message text');
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });
    });

    describe('voice-engine retry on transient errors', () => {
      const retryAttachment: AttachmentMetadata = {
        url: 'https://cdn.discordapp.com/audio.ogg',
        name: 'audio.ogg',
        contentType: CONTENT_TYPES.AUDIO_OGG,
        size: 1024,
      };

      beforeEach(() => {
        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
      });

      it('should retry on ECONNREFUSED and succeed on second attempt', async () => {
        const econnrefusedCause = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
        econnrefusedCause.code = 'ECONNREFUSED';
        const fetchError = new TypeError('fetch failed', { cause: econnrefusedCause });

        mockVoiceEngineTranscribe
          .mockRejectedValueOnce(fetchError)
          .mockResolvedValueOnce({ text: 'Transcribed after retry' });

        const result = await transcribeAudio(retryAttachment);

        expect(result).toBe('Transcribed after retry');
        expect(mockVoiceEngineTranscribe).toHaveBeenCalledTimes(2);
      });

      it('should throw "No STT provider" after all retry attempts fail with transient errors', async () => {
        const fetchError = new TypeError('fetch failed');

        mockVoiceEngineTranscribe.mockRejectedValue(fetchError);

        await expect(transcribeAudio(retryAttachment)).rejects.toThrow('No STT provider available');
        // 2 attempts (MAX_ATTEMPTS = 2)
        expect(mockVoiceEngineTranscribe).toHaveBeenCalledTimes(2);
      });

      it('should not retry on non-transient errors (fast-fail)', async () => {
        const { VoiceEngineError } = await import('../voice/VoiceEngineClient.js');
        mockVoiceEngineTranscribe.mockRejectedValue(new VoiceEngineError(401, 'Unauthorized'));

        await expect(transcribeAudio(retryAttachment)).rejects.toThrow('No STT provider available');
        // Only 1 attempt — shouldRetry returned false for 401
        expect(mockVoiceEngineTranscribe).toHaveBeenCalledTimes(1);
      });
    });

    describe('ElevenLabs STT integration', () => {
      const audioAttachment: AttachmentMetadata = {
        url: 'https://cdn.discordapp.com/audio.ogg',
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
        // Voice-engine should NOT be called when ElevenLabs succeeds (early return)
        expect(mockVoiceEngineTranscribe).not.toHaveBeenCalled();
      });

      it('should fall back to voice-engine when ElevenLabs fails', async () => {
        mockElevenLabsSTT.mockRejectedValue(new Error('ElevenLabs down'));
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
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

      it('should retry ElevenLabs STT on transient error and succeed', async () => {
        const { ElevenLabsApiError } = await import('../voice/ElevenLabsClient.js');
        mockElevenLabsSTT
          .mockRejectedValueOnce(new ElevenLabsApiError(429, 'Rate limited'))
          .mockResolvedValueOnce({ text: 'Retry succeeded' });

        const result = await transcribeAudio(audioAttachment, 'sk_el_test');

        expect(result).toBe('Retry succeeded');
        expect(mockElevenLabsSTT).toHaveBeenCalledTimes(2);
        expect(mockVoiceEngineTranscribe).not.toHaveBeenCalled();
      });

      it('should fall back to voice-engine after ElevenLabs retries exhausted', async () => {
        const fetchError = new TypeError('fetch failed');
        mockElevenLabsSTT.mockRejectedValue(fetchError);
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Fallback result' });

        const result = await transcribeAudio(audioAttachment, 'sk_el_test');

        expect(result).toBe('Fallback result');
        // 2 attempts before fallback
        expect(mockElevenLabsSTT).toHaveBeenCalledTimes(2);
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('should not retry ElevenLabs STT on auth errors (fast-fail to fallback)', async () => {
        const { ElevenLabsApiError } = await import('../voice/ElevenLabsClient.js');
        mockElevenLabsSTT.mockRejectedValue(new ElevenLabsApiError(401, 'Unauthorized'));
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Fallback after auth' });

        const result = await transcribeAudio(audioAttachment, 'sk_el_test');

        expect(result).toBe('Fallback after auth');
        // Only 1 attempt — auth errors fast-fail
        expect(mockElevenLabsSTT).toHaveBeenCalledTimes(1);
      });

      it('should skip ElevenLabs when no apiKey provided', async () => {
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'voice engine result' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

        const result = await transcribeAudio(audioAttachment);

        expect(mockElevenLabsSTT).not.toHaveBeenCalled();
        expect(result).toBe('voice engine result');
      });
    });
  });
});
