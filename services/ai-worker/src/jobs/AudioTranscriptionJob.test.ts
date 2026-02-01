/**
 * Tests for Audio Transcription Job Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processAudioTranscriptionJob } from './AudioTranscriptionJob.js';
import type { Job } from 'bullmq';
import type { AudioTranscriptionJobData } from '@tzurot/common-types';
import { JobType, CONTENT_TYPES } from '@tzurot/common-types';

// Mock transcribeAudio and withRetry
vi.mock('../services/MultimodalProcessor.js', () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock('../utils/retry.js', () => ({
  withRetry: vi.fn(),
}));

// Import the mocked modules
import { transcribeAudio } from '../services/MultimodalProcessor.js';
import { withRetry } from '../utils/retry.js';

// Get mocked functions
const mockTranscribeAudio = vi.mocked(transcribeAudio);
const mockWithRetry = vi.mocked(withRetry);

describe('AudioTranscriptionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: transcribeAudio returns mock text
    mockTranscribeAudio.mockResolvedValue('Mocked transcription text');

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

      const result = await processAudioTranscriptionJob(job);

      expect(result).toEqual({
        requestId: 'test-req-audio-0',
        success: true,
        content: 'Mocked transcription text',
        attachmentUrl: 'https://example.com/audio.ogg',
        attachmentName: 'audio.ogg',
        metadata: {
          processingTimeMs: 1000,
          duration: 10,
        },
      });

      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxAttempts: 3,
          operationName: 'Audio transcription (audio.ogg)',
        })
      );
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

      const result = await processAudioTranscriptionJob(job);

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
      mockWithRetry.mockRejectedValue(new Error('Whisper API timeout after 3 attempts'));

      const result = await processAudioTranscriptionJob(job);

      expect(result).toMatchObject({
        requestId: 'test-req-audio-2',
        success: false,
        error: 'Whisper API timeout after 3 attempts',
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

      const result = await processAudioTranscriptionJob(job);

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

      const result = await processAudioTranscriptionJob(job);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Mocked transcription text');
      expect(mockWithRetry).toHaveBeenCalled();
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

      const result = await processAudioTranscriptionJob(job);

      expect(result.success).toBe(true);
      expect(result.metadata!.processingTimeMs).toBe(6500);
      expect(result.metadata!.duration).toBe(30);
    });
  });
});
