/**
 * Tests for Audio Transcription Job Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processAudioTranscriptionJob } from './AudioTranscriptionJob.js';
import type { Job } from 'bullmq';
import type { AudioTranscriptionJobData } from '@tzurot/common-types/types/jobs';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { JobType } from '@tzurot/common-types/constants/queue';
import { TimeoutError, AudioTooLongError } from '@tzurot/common-types/utils/errors';

// Mock transcribeAudio and withRetry
vi.mock('../services/multimodal/AudioProcessor.js', () => ({
  transcribeAudio: vi.fn(),
}));

// Override ONLY withRetry — keep the real RetryError class, which the job's catch
// uses (`error instanceof RetryError`) to unwrap the root cause for failureReason.
vi.mock('../utils/retry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/retry.js')>();
  return { ...actual, withRetry: vi.fn() };
});

// Import the mocked modules
import { transcribeAudio } from '../services/multimodal/AudioProcessor.js';
import { withRetry, RetryError } from '../utils/retry.js';
import { MAX_QUEUE_AGE_MS } from '../utils/jobAgeGate.js';

// Get mocked functions
const mockTranscribeAudio = vi.mocked(transcribeAudio);
const mockWithRetry = vi.mocked(withRetry);

describe('AudioTranscriptionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: transcribeAudio returns mock result with actualProvider
    mockTranscribeAudio.mockResolvedValue({
      text: 'Mocked transcription text',
      actualProvider: 'voice-engine',
    });

    // Default: withRetry calls the function and returns successful result
    mockWithRetry.mockImplementation(async fn => {
      const value = await fn();
      return {
        value,
        attempts: 1,
        totalTimeMs: 1000,
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processAudioTranscriptionJob', () => {
    it('should successfully transcribe audio attachment', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-audio-0',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
          duration: 10,
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'audio-test-req-audio-0',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      const result = await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      expect(result).toEqual({
        requestId: 'test-req-audio-0',
        success: true,
        content: 'Mocked transcription text',
        attachmentUrl: 'https://example.com/audio.ogg',
        attachmentName: 'audio.ogg',
        provider: 'voice-engine',
        metadata: {
          processingTimeMs: 1000,
          duration: 10,
        },
      });

      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxAttempts: 3,
          shouldRetry: expect.any(Function),
          operationName: 'Audio transcription (audio.ogg)',
        })
      );
    });

    it('omits provider field on the result when transcribeAudio returns actualProvider undefined (cache hit)', async () => {
      // The conditional spread `...(actualProvider !== undefined ? { provider } : {})`
      // is its own code path. The transcribeAudio-boundary attribution tests
      // in AudioProcessor.test.ts don't exercise it. This test pins the
      // job-level invariant: cache hits (where the original provider isn't
      // recorded) must NOT carry a `provider` field on the result, so the
      // bot-client-side attribution badge is omitted rather than lying.
      mockTranscribeAudio.mockResolvedValueOnce({
        text: 'Cached transcription text',
        actualProvider: undefined,
      });

      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-cache-hit',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
          duration: 10,
        },
        context: { userId: 'user-123', channelId: 'channel-456' },
        responseDestination: { type: 'discord', channelId: 'channel-456' },
      };
      const job = {
        id: 'audio-test-cache-hit',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      const result = await processAudioTranscriptionJob(job, { provider: 'mistral' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Cached transcription text');
      // The key invariant: no `provider` field on cache hits, so the
      // bot-client renders no attribution badge rather than re-claiming the
      // currently-resolved provider over a transcript with unknown provenance.
      expect('provider' in result).toBe(false);
    });

    it('should not retry permanent config errors (no STT provider)', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-config-error',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
          duration: 10,
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'audio-config-error',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      mockWithRetry.mockImplementation(async fn => {
        const value = await fn();
        return { value, attempts: 1, totalTimeMs: 100 };
      });

      await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      // Verify shouldRetry callback rejects config errors
      const retryOpts = mockWithRetry.mock.calls[0][1];
      const shouldRetry = retryOpts!.shouldRetry!;
      expect(shouldRetry(new Error('No STT provider available: configure...'))).toBe(false);
      expect(shouldRetry(new Error('fetch failed'))).toBe(true);
      // A plain Error whose message merely mentions a timeout is NOT a typed
      // TimeoutError (name !== 'TimeoutError') → still retryable.
      expect(shouldRetry(new Error('Voice engine request timed out'))).toBe(true);
      // Typed timeout + too-long ARE non-retryable: re-running them just grinds the
      // (now larger) budget for a guaranteed-identical failure.
      expect(shouldRetry(new TimeoutError(1000, 'voice engine request'))).toBe(false);
      expect(shouldRetry(new AudioTooLongError('Audio too long'))).toBe(false);
    });

    it('tags failureReason="timeout" when the root cause is a TimeoutError', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-timeout',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/long.ogg',
          name: 'long.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
          duration: 400,
        },
        context: { userId: 'user-123', channelId: 'channel-456' },
        responseDestination: { type: 'discord', channelId: 'channel-456' },
      };
      const job = { id: 'audio-timeout', data: jobData } as Job<AudioTranscriptionJobData>;

      // withRetry wraps the cause in a RetryError (lastError = the TimeoutError).
      mockWithRetry.mockRejectedValue(
        new RetryError(
          'Audio transcription failed',
          1,
          new TimeoutError(480000, 'voice engine request')
        )
      );

      const result = await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('timeout');
    });

    it('tags failureReason="too_long" when the root cause is an AudioTooLongError', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-toolong',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/huge.ogg',
          name: 'huge.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
          duration: 900,
        },
        context: { userId: 'user-123', channelId: 'channel-456' },
        responseDestination: { type: 'discord', channelId: 'channel-456' },
      };
      const job = { id: 'audio-toolong', data: jobData } as Job<AudioTranscriptionJobData>;

      mockWithRetry.mockRejectedValue(
        new RetryError(
          'Audio transcription failed',
          1,
          new AudioTooLongError('Audio too long (900s).')
        )
      );

      const result = await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('too_long');
    });

    it('tags failureReason="unavailable" for a no-provider failure', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-unavail',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        },
        context: { userId: 'user-123', channelId: 'channel-456' },
        responseDestination: { type: 'discord', channelId: 'channel-456' },
      };
      const job = { id: 'audio-unavail', data: jobData } as Job<AudioTranscriptionJobData>;

      mockWithRetry.mockRejectedValue(
        new RetryError(
          'Audio transcription failed',
          1,
          new Error('No STT provider available: voice-engine failed')
        )
      );

      const result = await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('unavailable');
    });

    it('should use withRetry wrapper for transcription', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-audio-1',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/voice.ogg',
          name: 'voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 4096,
          isVoiceMessage: true,
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'audio-test-req-audio-1',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      // Simulate retry succeeding on 2nd attempt
      mockWithRetry.mockImplementation(async fn => {
        const result = await fn();
        return {
          value: result,
          attempts: 2,
          totalTimeMs: 3500,
        };
      });

      const result = await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Mocked transcription text');
      expect(result.metadata!.processingTimeMs).toBe(3500);
      expect(mockWithRetry).toHaveBeenCalledTimes(1);
    });

    it('should return failure result when all retries exhausted', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-audio-2',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/failed.ogg',
          name: 'failed.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'audio-test-req-audio-2',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      // Simulate withRetry failing after all attempts
      mockWithRetry.mockRejectedValue(new Error('STT API timeout after 3 attempts'));

      const result = await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      expect(result).toMatchObject({
        requestId: 'test-req-audio-2',
        success: false,
        error: 'STT API timeout after 3 attempts',
        metadata: {
          processingTimeMs: expect.any(Number),
          duration: undefined,
        },
      });
    });

    it('should reject invalid attachment type (image instead of audio)', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-audio-3',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/image.png',
          name: 'image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 1024,
        } as any, // Type mismatch intentional for test
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'audio-test-req-audio-3',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      const result = await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      expect(result).toMatchObject({
        requestId: 'test-req-audio-3',
        success: false,
        error: expect.stringContaining('Invalid attachment type'),
        metadata: expect.any(Object),
      });

      // Should NOT call withRetry for invalid input
      expect(mockWithRetry).not.toHaveBeenCalled();
    });

    it('should accept voice message attachments', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-audio-4',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/voice.ogg',
          name: 'voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 8192,
          isVoiceMessage: true,
          duration: 45,
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'audio-test-req-audio-4',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      const result = await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Mocked transcription text');
      expect(mockWithRetry).toHaveBeenCalled();
    });

    it('should pass elevenlabsApiKey to transcribeAudio when provided', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-audio-key',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
          duration: 10,
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'audio-test-key',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      const testApiKey = 'el-test-key-123';
      const sttOpts = { provider: 'elevenlabs' as const, apiKey: testApiKey };
      await processAudioTranscriptionJob(job, sttOpts);

      // Verify withRetry was called with a function that passes the key
      expect(mockWithRetry).toHaveBeenCalledTimes(1);
      const retryFn = mockWithRetry.mock.calls[0][0];
      await retryFn();
      expect(mockTranscribeAudio).toHaveBeenCalledWith(jobData.attachment, sttOpts);
    });

    it('passes the resolved STT options through to transcribeAudio', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-audio-nokey',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.ogg',
          name: 'audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 2048,
          duration: 10,
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'audio-test-nokey',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      const sttOpts = { provider: 'voice-engine' as const };
      await processAudioTranscriptionJob(job, sttOpts);

      // Verify withRetry was called with a function that forwards the opts unchanged
      expect(mockWithRetry).toHaveBeenCalledTimes(1);
      const retryFn = mockWithRetry.mock.calls[0][0];
      await retryFn();
      expect(mockTranscribeAudio).toHaveBeenCalledWith(jobData.attachment, sttOpts);
    });

    describe('queue-age gate', () => {
      // Pinned clock per project standard (02-code-standards.md "Fake Timers
      // ALWAYS Use"). The other tests in this file don't depend on Date.now(),
      // so the fake-timer setup lives only in this nested describe to avoid
      // affecting the rest of the suite. `toFake: ['Date']` keeps setTimeout
      // real so any retry-path code in the call chain still resolves naturally.
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should throw ExpiredJobError when queue-age exceeds threshold', async () => {
        const jobData: AudioTranscriptionJobData = {
          requestId: 'test-req-expired',
          jobType: JobType.AudioTranscription,
          attachment: {
            url: 'https://cdn.discordapp.com/expired.ogg',
            name: 'expired.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
            size: 2048,
            duration: 10,
          },
          context: { userId: 'user-123', channelId: 'channel-456' },
          responseDestination: { type: 'discord', channelId: 'channel-456' },
        };

        // +1 min past the threshold so the test pins "just-over" rather than
        // a hardcoded "way over" value. Survives MAX_QUEUE_AGE_MS tuning.
        const justOverThreshold = Date.now() - MAX_QUEUE_AGE_MS - 60_000;
        const job = {
          id: 'audio-test-expired',
          data: jobData,
          timestamp: justOverThreshold,
        } as Job<AudioTranscriptionJobData>;

        await expect(
          processAudioTranscriptionJob(job, { provider: 'voice-engine' })
        ).rejects.toThrow(/likely expired/);
        // Load-bearing: gate must fire BEFORE any transcription work. Neither
        // withRetry nor transcribeAudio should have been called.
        expect(mockWithRetry).not.toHaveBeenCalled();
        expect(mockTranscribeAudio).not.toHaveBeenCalled();
      });
    });

    it('should throw on invalid job data (Zod validation failure)', async () => {
      const invalidJobData = {
        requestId: 'test-req-invalid',
        // Missing jobType, attachment, context, responseDestination
      };

      const job = {
        id: 'audio-test-invalid',
        data: invalidJobData,
      } as Job<AudioTranscriptionJobData>;

      await expect(processAudioTranscriptionJob(job, { provider: 'voice-engine' })).rejects.toThrow(
        'Audio transcription job validation failed'
      );

      // Should NOT attempt transcription for invalid payloads
      expect(mockWithRetry).not.toHaveBeenCalled();
    });

    it('should include retry metadata in result', async () => {
      const jobData: AudioTranscriptionJobData = {
        requestId: 'test-req-audio-5',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.mp3',
          name: 'audio.mp3',
          contentType: CONTENT_TYPES.AUDIO_MP3,
          size: 4096,
          duration: 30,
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'audio-test-req-audio-5',
        data: jobData,
      } as Job<AudioTranscriptionJobData>;

      // Simulate 3 attempts with total time
      mockWithRetry.mockImplementation(async fn => {
        const result = await fn();
        return {
          value: result,
          attempts: 3,
          totalTimeMs: 6500,
        };
      });

      const result = await processAudioTranscriptionJob(job, { provider: 'voice-engine' });

      expect(result.success).toBe(true);
      expect(result.metadata!.processingTimeMs).toBe(6500);
      expect(result.metadata!.duration).toBe(30);
    });
  });
});
