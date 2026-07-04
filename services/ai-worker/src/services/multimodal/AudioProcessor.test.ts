/**
 * Tests for Audio Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeAudio } from './AudioProcessor.js';
import { VoiceEngineError } from '../voice/VoiceEngineClient.js';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { TimeoutError, AudioTooLongError } from '@tzurot/common-types/utils/errors';

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

const mockMistralSTT = vi.fn();
vi.mock('../voice/MistralSttClient.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../voice/MistralSttClient.js')>();
  return {
    ...actual,
    mistralTranscribeAudio: (...args: unknown[]) => mockMistralSTT(...args),
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

        const result = await transcribeAudio(attachment, { provider: 'voice-engine' });

        expect(result.text).toBe('Cached transcription from Redis');
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

        await transcribeAudio(attachment, { provider: 'voice-engine' });

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

        await transcribeAudio(attachment, { provider: 'voice-engine' });

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

        const result = await transcribeAudio(attachment, { provider: 'voice-engine' });

        expect(result.text).toBe('Fallback result');
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

        await transcribeAudio(attachment, { provider: 'voice-engine' });

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

        await transcribeAudio(attachment, { provider: 'voice-engine' });

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

        const result = await transcribeAudio(attachment, { provider: 'voice-engine' });

        expect(result.text).toBe('Voice engine transcription');
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

        const result = await transcribeAudio(attachment, { provider: 'voice-engine' });

        expect(result.text).toBe('');
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

        await expect(transcribeAudio(attachment, { provider: 'voice-engine' })).rejects.toThrow(
          'No STT provider available'
        );
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

        await expect(transcribeAudio(attachment, { provider: 'voice-engine' })).rejects.toThrow(
          'No STT provider available'
        );
      });

      it('re-throws a TimeoutError instead of laundering it into "No STT provider available"', async () => {
        // The whole point of the un-laundering fix: a voice-engine timeout must
        // propagate as a typed TimeoutError so the job can tag failureReason='timeout'
        // and the bot can say "taking too long" — NOT the generic failure message.
        vi.useFakeTimers();
        try {
          const attachment: AttachmentMetadata = {
            url: 'https://cdn.discordapp.com/audio.ogg',
            name: 'audio.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
            size: 1024,
          };

          // TimeoutError is transient → the inner withRetry retries once (3s backoff)
          // then exhausts, wrapping it in a RetryError whose lastError is the TimeoutError.
          mockVoiceEngineTranscribe.mockRejectedValue(
            new TimeoutError(TIMEOUTS.VOICE_ENGINE_API, 'voice engine request')
          );
          mockVoiceEngineClient = {
            transcribe: mockVoiceEngineTranscribe,
            getHealth: mockGetHealth,
          };
          (global.fetch as any).mockResolvedValue({
            ok: true,
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
          });

          const promise = transcribeAudio(attachment, { provider: 'voice-engine' });
          const assertion = expect(promise).rejects.toThrow(TimeoutError);
          await vi.runAllTimersAsync();
          await assertion;
        } finally {
          vi.useRealTimers();
        }
      });

      it('throws AudioTooLongError when voice-engine rejects audio as too long (413)', async () => {
        const attachment: AttachmentMetadata = {
          url: 'https://cdn.discordapp.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        };

        // 413 is non-transient → fast-fails (no retry/backoff). Must propagate as a
        // typed AudioTooLongError, not be swallowed to null.
        mockVoiceEngineTranscribe.mockRejectedValue(
          new VoiceEngineError(413, 'Audio too long (800s). Maximum is 720s.')
        );
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });

        await expect(transcribeAudio(attachment, { provider: 'voice-engine' })).rejects.toThrow(
          AudioTooLongError
        );
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

        await transcribeAudio(warmupAttachment, { provider: 'voice-engine' });

        expect(mockWaitForVoiceEngine).toHaveBeenCalledWith(mockVoiceEngineClient, 'asr');
        expect(mockWaitForVoiceEngine).toHaveBeenCalledTimes(1);
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('proceeds with transcription even when warm-up returns false (budget exhausted)', async () => {
        mockWaitForVoiceEngine.mockResolvedValue(false);
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'still works' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

        const result = await transcribeAudio(warmupAttachment, { provider: 'voice-engine' });

        expect(result.text).toBe('still works');
        expect(mockWaitForVoiceEngine).toHaveBeenCalledWith(mockVoiceEngineClient, 'asr');
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('does not call warm-up when voice engine client is null', async () => {
        // No voice engine configured — should throw "No STT provider"
        await expect(
          transcribeAudio(warmupAttachment, { provider: 'voice-engine' })
        ).rejects.toThrow('No STT provider available');
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

        const result = await transcribeAudio(attachment, { provider: 'voice-engine' });

        expect(result.text).toBe('transcribed');
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

        await expect(transcribeAudio(attachment, { provider: 'voice-engine' })).rejects.toThrow(
          'Network error'
        );
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

        await expect(transcribeAudio(attachment, { provider: 'voice-engine' })).rejects.toThrow(
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

        const error = await transcribeAudio(attachment, { provider: 'voice-engine' }).catch(e => e);
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

        await expect(transcribeAudio(attachment, { provider: 'voice-engine' })).rejects.toThrow(
          /must be from Discord CDN/
        );
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

        const result = await transcribeAudio(attachment, { provider: 'voice-engine' });

        expect(result.text).toBe('Voice message text');
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

        const result = await transcribeAudio(retryAttachment, { provider: 'voice-engine' });

        expect(result.text).toBe('Transcribed after retry');
        expect(mockVoiceEngineTranscribe).toHaveBeenCalledTimes(2);
      });

      it('should throw "No STT provider" after all retry attempts fail with transient errors', async () => {
        const fetchError = new TypeError('fetch failed');

        mockVoiceEngineTranscribe.mockRejectedValue(fetchError);

        await expect(
          transcribeAudio(retryAttachment, { provider: 'voice-engine' })
        ).rejects.toThrow('No STT provider available');
        // 2 attempts (MAX_ATTEMPTS = 2)
        expect(mockVoiceEngineTranscribe).toHaveBeenCalledTimes(2);
      });

      it('should not retry on non-transient errors (fast-fail)', async () => {
        const { VoiceEngineError } = await import('../voice/VoiceEngineClient.js');
        mockVoiceEngineTranscribe.mockRejectedValue(new VoiceEngineError(401, 'Unauthorized'));

        await expect(
          transcribeAudio(retryAttachment, { provider: 'voice-engine' })
        ).rejects.toThrow('No STT provider available');
        // Only 1 attempt — shouldRetry returned false for 401
        expect(mockVoiceEngineTranscribe).toHaveBeenCalledTimes(1);
      });
    });

    describe('voice-engine retry global-timeout short-circuit', () => {
      // Verifies the asymmetric globalTimeoutMs semantics in AudioProcessor.ts:
      // when attempt 1 consumes its full VOICE_ENGINE_API timeout (480s), the
      // global-timeout check at the head of attempt 2 fires (elapsed 483s ≥ 480s)
      // and aborts before voiceEngineClient.transcribe is invoked a second time.
      // Fast-fail attempts (a few seconds) still get retried — covered above.
      //
      // TimeoutError is classified as transient by isTransientVoiceEngineError,
      // so the catch path runs waitBeforeRetry (3s) and reaches attempt-2's head
      // check rather than fast-failing — that's the prerequisite that lets the
      // global-timeout check fire here.

      const retryAttachment: AttachmentMetadata = {
        url: 'https://cdn.discordapp.com/audio.ogg',
        name: 'audio.ogg',
        contentType: CONTENT_TYPES.AUDIO_OGG,
        size: 1024,
      };

      beforeEach(() => {
        vi.useFakeTimers();
        (global.fetch as any).mockResolvedValue({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
        });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should skip attempt 2 when attempt 1 consumes the full per-attempt timeout', async () => {
        // Simulate a full-timeout attempt: advance the fake clock by VOICE_ENGINE_API
        // before throwing. withRetry reads Date.now() (mocked by fake timers) for
        // elapsed-time tracking, so it observes 480s consumed by this attempt.
        mockVoiceEngineTranscribe.mockImplementation(async () => {
          vi.advanceTimersByTime(TIMEOUTS.VOICE_ENGINE_API);
          throw new TimeoutError(TIMEOUTS.VOICE_ENGINE_API, 'Voice Engine STT');
        });

        const promise = transcribeAudio(retryAttachment, { provider: 'voice-engine' });
        // The timeout now propagates as a typed TimeoutError (no longer laundered into
        // "No STT provider available") so the job can tag failureReason='timeout'.
        const assertion = expect(promise).rejects.toThrow(TimeoutError);

        await vi.runAllTimersAsync();
        await assertion;

        // globalTimeoutMs fires at the head of attempt 2 (elapsed 483s ≥ 480s),
        // so transcribe is invoked exactly once. With globalTimeoutMs unset or
        // set above 483s, this would be called twice.
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

        const result = await transcribeAudio(audioAttachment, {
          provider: 'elevenlabs',
          apiKey: 'sk_el_test',
        });

        expect(result.text).toBe('ElevenLabs transcription');
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

        const result = await transcribeAudio(audioAttachment, {
          provider: 'elevenlabs',
          apiKey: 'sk_el_test',
        });

        expect(result.text).toBe('Voice engine result');
        expect(mockElevenLabsSTT).toHaveBeenCalled();
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('should throw when both ElevenLabs and voice-engine fail', async () => {
        mockElevenLabsSTT.mockRejectedValue(new Error('ElevenLabs down'));
        // No voice engine configured

        await expect(
          transcribeAudio(audioAttachment, { provider: 'elevenlabs', apiKey: 'sk_el_test' })
        ).rejects.toThrow('No STT provider available');
      });

      it('should retry ElevenLabs STT on transient error and succeed', async () => {
        const { ElevenLabsApiError } = await import('../voice/ElevenLabsClient.js');
        mockElevenLabsSTT
          .mockRejectedValueOnce(new ElevenLabsApiError(429, 'Rate limited'))
          .mockResolvedValueOnce({ text: 'Retry succeeded' });

        const result = await transcribeAudio(audioAttachment, {
          provider: 'elevenlabs',
          apiKey: 'sk_el_test',
        });

        expect(result.text).toBe('Retry succeeded');
        expect(mockElevenLabsSTT).toHaveBeenCalledTimes(2);
        expect(mockVoiceEngineTranscribe).not.toHaveBeenCalled();
      });

      it('should fall back to voice-engine after ElevenLabs retries exhausted', async () => {
        const fetchError = new TypeError('fetch failed');
        mockElevenLabsSTT.mockRejectedValue(fetchError);
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Fallback result' });

        const result = await transcribeAudio(audioAttachment, {
          provider: 'elevenlabs',
          apiKey: 'sk_el_test',
        });

        expect(result.text).toBe('Fallback result');
        // 2 attempts before fallback
        expect(mockElevenLabsSTT).toHaveBeenCalledTimes(2);
        expect(mockVoiceEngineTranscribe).toHaveBeenCalled();
      });

      it('should not retry ElevenLabs STT on auth errors (fast-fail to fallback)', async () => {
        const { ElevenLabsApiError } = await import('../voice/ElevenLabsClient.js');
        mockElevenLabsSTT.mockRejectedValue(new ElevenLabsApiError(401, 'Unauthorized'));
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'Fallback after auth' });

        const result = await transcribeAudio(audioAttachment, {
          provider: 'elevenlabs',
          apiKey: 'sk_el_test',
        });

        expect(result.text).toBe('Fallback after auth');
        // Only 1 attempt — auth errors fast-fail
        expect(mockElevenLabsSTT).toHaveBeenCalledTimes(1);
      });

      it('should skip ElevenLabs when no apiKey provided', async () => {
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'voice engine result' });
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

        const result = await transcribeAudio(audioAttachment, { provider: 'voice-engine' });

        expect(mockElevenLabsSTT).not.toHaveBeenCalled();
        expect(result.text).toBe('voice engine result');
      });
    });

    describe('actualProvider attribution (regression contract)', () => {
      // Pin the contract that `actualProvider` reflects what PRODUCED the
      // text, not what was REQUESTED. Misattribution here is the bug class
      // where users reported "Mistral sounds identical to self-hosted" —
      // every BYOK failure that fell through to voice-engine was being
      // labeled as the requested provider, masking the silent-skip.
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

      it('returns actualProvider=voice-engine when provider is voice-engine and succeeds', async () => {
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'self-hosted text' });

        const result = await transcribeAudio(audioAttachment, { provider: 'voice-engine' });

        expect(result.actualProvider).toBe('voice-engine');
      });

      it('returns actualProvider=elevenlabs on a successful ElevenLabs request', async () => {
        mockElevenLabsSTT.mockResolvedValue({ text: 'elevenlabs text' });

        const result = await transcribeAudio(audioAttachment, {
          provider: 'elevenlabs',
          apiKey: 'sk_el_test',
        });

        expect(result.actualProvider).toBe('elevenlabs');
      });

      it('returns actualProvider=voice-engine when ElevenLabs was requested but failed (the lying-attribution case)', async () => {
        // Same shape as the Mistral case from the bug report — BYOK
        // provider fails, voice-engine takes over, attribution must
        // reflect what actually produced the text.
        mockElevenLabsSTT.mockRejectedValue(new Error('ElevenLabs 500'));
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'self-hosted fallback' });

        const result = await transcribeAudio(audioAttachment, {
          provider: 'elevenlabs',
          apiKey: 'sk_el_test',
        });

        // Invariant this test pins: voice-engine fallback after BYOK
        // failure must produce actualProvider='voice-engine', not the
        // requested provider. Re-introducing the requested-provider value
        // here is the misattribution class this contract guards against.
        expect(result.text).toBe('self-hosted fallback');
        expect(result.actualProvider).toBe('voice-engine');
      });

      it('returns actualProvider=voice-engine when Mistral was requested but failed (named bug case)', async () => {
        // The exact scenario from the user-reported symptom: Mistral was
        // configured, but the audio output sounded identical to self-hosted
        // because Mistral was failing silently and voice-engine was producing
        // every transcript while still being labeled as Mistral. ElevenLabs
        // covers the same code path above — this test exists to make the
        // named bug case explicit so a future change that breaks ONLY the
        // Mistral path (e.g., a regression in tryBYOKTranscription's mistral
        // branch) fails with an unambiguous message.
        const { MistralSttApiError } = await import('../voice/MistralSttClient.js');
        mockMistralSTT.mockRejectedValue(new MistralSttApiError(500, 'Mistral down'));
        mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };
        mockVoiceEngineTranscribe.mockResolvedValue({ text: 'self-hosted fallback' });

        const result = await transcribeAudio(audioAttachment, {
          provider: 'mistral',
          apiKey: 'sk_mi_test',
        });

        expect(result.text).toBe('self-hosted fallback');
        expect(result.actualProvider).toBe('voice-engine');
      });

      it('returns actualProvider=mistral on a successful Mistral request', async () => {
        mockMistralSTT.mockResolvedValue({ text: 'mistral text' });

        const result = await transcribeAudio(audioAttachment, {
          provider: 'mistral',
          apiKey: 'sk_mi_test',
        });

        expect(result.actualProvider).toBe('mistral');
      });

      it('omits actualProvider on cache hit (cache stores text only — provenance unknown)', async () => {
        const { voiceTranscriptCache } = await import('../../redis.js');
        vi.mocked(voiceTranscriptCache.get).mockResolvedValueOnce('cached text from previous turn');
        const audioAttachmentWithOriginal = {
          ...audioAttachment,
          originalUrl: 'https://cdn.example/voice.ogg',
        };

        const result = await transcribeAudio(audioAttachmentWithOriginal, {
          provider: 'elevenlabs',
          apiKey: 'sk_el_test',
        });

        expect(result.text).toBe('cached text from previous turn');
        // Cache stores text only — provenance not preserved across the
        // cache boundary. Omit attribution rather than re-claim it as the
        // currently-resolved provider; the latter would lie about a cached
        // entry that originally came from a different provider.
        expect(result.actualProvider).toBeUndefined();
      });
    });
  });
});
