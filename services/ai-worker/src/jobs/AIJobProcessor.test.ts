/**
 * Unit Tests for AIJobProcessor
 *
 * These tests complement the component tests (AIJobProcessor.component.test.ts)
 * by testing paths not covered by the component tests, including:
 * - Audio transcription job routing and result storage
 * - Image description job routing and result storage
 * - Error handling in persistAndPublishResult
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIJobProcessor } from './AIJobProcessor.js';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types';
import type { ConversationalRAGService } from '../services/ConversationalRAGService.js';
import {
  JobType,
  CONTENT_TYPES,
  type AudioTranscriptionJobData,
  type ImageDescriptionJobData,
  type LLMGenerationJobData,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
  type LLMGenerationResult,
} from '@tzurot/common-types';

// Mock modules
vi.mock('../redis.js', () => ({
  redisService: {
    storeJobResult: vi.fn().mockResolvedValue(undefined),
    publishJobResult: vi.fn().mockResolvedValue(undefined),
    getJobResult: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('./AudioTranscriptionJob.js', () => ({
  processAudioTranscriptionJob: vi.fn(),
}));

vi.mock('./ImageDescriptionJob.js', () => ({
  processImageDescriptionJob: vi.fn(),
}));

vi.mock('./CleanupJobResults.js', () => ({
  cleanupOldJobResults: vi.fn().mockResolvedValue(undefined),
}));

// Import mocked modules
import { redisService } from '../redis.js';
import { processAudioTranscriptionJob } from './AudioTranscriptionJob.js';
import { processImageDescriptionJob } from './ImageDescriptionJob.js';

// Create mock factories
function createMockPrisma(): PrismaClient {
  return {
    jobResult: {
      create: vi.fn().mockResolvedValue({ id: 'result-123' }),
    },
  } as unknown as PrismaClient;
}

function createMockRAGService(): ConversationalRAGService {
  return {
    generateResponse: vi.fn().mockResolvedValue({
      content: 'Mocked AI response',
      tokensIn: 80,
      tokensOut: 20,
      retrievedMemories: 5,
      modelUsed: 'test-model',
    }),
  } as unknown as ConversationalRAGService;
}

function createMockJob<T>(data: T, id = 'job-123'): Job<T> {
  return {
    id,
    data,
    progress: vi.fn(),
    updateProgress: vi.fn(),
    log: vi.fn(),
  } as unknown as Job<T>;
}

// Common test data
const baseContext = {
  userId: 'user-123',
  channelId: 'channel-123',
};

const baseResponseDestination = {
  type: 'discord' as const,
  channelId: 'channel-123',
};

describe('AIJobProcessor', () => {
  let processor: AIJobProcessor;
  let mockPrisma: PrismaClient;
  let mockRAGService: ConversationalRAGService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    mockRAGService = createMockRAGService();
    processor = new AIJobProcessor(mockPrisma, undefined, mockRAGService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with injected dependencies', () => {
      expect(processor).toBeInstanceOf(AIJobProcessor);
    });
  });

  describe('healthCheck', () => {
    it('should return true', () => {
      expect(processor.healthCheck()).toBe(true);
    });
  });

  describe('processJob - job routing', () => {
    describe('audio transcription jobs', () => {
      const audioJobData: AudioTranscriptionJobData = {
        requestId: 'req-audio-123',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          name: 'voice-message.ogg',
          size: 2048,
          isVoiceMessage: true,
        },
        context: baseContext,
        responseDestination: baseResponseDestination,
      };

      const audioResult: AudioTranscriptionResult = {
        requestId: 'req-audio-123',
        success: true,
        transcript: 'Hello, this is a voice message',
        metadata: {
          processingTimeMs: 1500,
        },
      };

      it('should route audio transcription jobs to the audio handler', async () => {
        vi.mocked(processAudioTranscriptionJob).mockResolvedValue(audioResult);
        const job = createMockJob(audioJobData, 'audio-job-123');

        const result = await processor.processJob(job);

        expect(processAudioTranscriptionJob).toHaveBeenCalledWith(job);
        expect(result).toEqual(audioResult);
      });

      it('should store audio result in Redis with user-namespaced key', async () => {
        vi.mocked(processAudioTranscriptionJob).mockResolvedValue(audioResult);
        const job = createMockJob(audioJobData, 'audio-job-123');

        await processor.processJob(job);

        expect(redisService.storeJobResult).toHaveBeenCalledWith(
          'user-123:audio-job-123',
          audioResult
        );
      });

      it('should persist audio result to database', async () => {
        vi.mocked(processAudioTranscriptionJob).mockResolvedValue(audioResult);
        const job = createMockJob(audioJobData, 'audio-job-123');

        await processor.processJob(job);

        expect(mockPrisma.jobResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            jobId: 'audio-job-123',
            requestId: 'req-audio-123',
            status: 'PENDING_DELIVERY',
          }),
        });
      });

      it('should publish audio result to Redis stream', async () => {
        vi.mocked(processAudioTranscriptionJob).mockResolvedValue(audioResult);
        const job = createMockJob(audioJobData, 'audio-job-123');

        await processor.processJob(job);

        expect(redisService.publishJobResult).toHaveBeenCalledWith(
          'audio-job-123',
          'req-audio-123',
          audioResult
        );
      });

      it('should use requestId as fallback when job.id is undefined', async () => {
        vi.mocked(processAudioTranscriptionJob).mockResolvedValue(audioResult);
        const job = createMockJob(audioJobData);
        job.id = undefined;

        await processor.processJob(job);

        expect(redisService.storeJobResult).toHaveBeenCalledWith(
          'user-123:req-audio-123',
          audioResult
        );
      });

      it('should use "unknown" userId when context.userId is missing', async () => {
        vi.mocked(processAudioTranscriptionJob).mockResolvedValue(audioResult);
        const jobDataWithoutUserId = {
          ...audioJobData,
          context: { channelId: 'channel-123' } as AudioTranscriptionJobData['context'],
        };
        const job = createMockJob(jobDataWithoutUserId, 'audio-job-123');

        await processor.processJob(job);

        expect(redisService.storeJobResult).toHaveBeenCalledWith(
          'unknown:audio-job-123',
          audioResult
        );
      });
    });

    describe('image description jobs', () => {
      const imageJobData: ImageDescriptionJobData = {
        requestId: 'req-image-123',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            name: 'photo.png',
            size: 4096,
          },
        ],
        personality: {
          id: 'personality-123',
          name: 'TestBot',
          displayName: 'Test Bot',
          slug: 'testbot',
          systemPrompt: 'You are a helpful assistant.',
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        context: baseContext,
        responseDestination: baseResponseDestination,
      };

      const imageResult: ImageDescriptionResult = {
        requestId: 'req-image-123',
        success: true,
        descriptions: ['A beautiful landscape photo'],
        metadata: {
          processingTimeMs: 2000,
          imageCount: 1,
        },
      };

      it('should route image description jobs to the image handler', async () => {
        vi.mocked(processImageDescriptionJob).mockResolvedValue(imageResult);
        const job = createMockJob(imageJobData, 'image-job-123');

        const result = await processor.processJob(job);

        expect(processImageDescriptionJob).toHaveBeenCalledWith(job);
        expect(result).toEqual(imageResult);
      });

      it('should store image result in Redis with user-namespaced key', async () => {
        vi.mocked(processImageDescriptionJob).mockResolvedValue(imageResult);
        const job = createMockJob(imageJobData, 'image-job-123');

        await processor.processJob(job);

        expect(redisService.storeJobResult).toHaveBeenCalledWith(
          'user-123:image-job-123',
          imageResult
        );
      });

      it('should persist image result to database', async () => {
        vi.mocked(processImageDescriptionJob).mockResolvedValue(imageResult);
        const job = createMockJob(imageJobData, 'image-job-123');

        await processor.processJob(job);

        expect(mockPrisma.jobResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            jobId: 'image-job-123',
            requestId: 'req-image-123',
            status: 'PENDING_DELIVERY',
          }),
        });
      });

      it('should publish image result to Redis stream', async () => {
        vi.mocked(processImageDescriptionJob).mockResolvedValue(imageResult);
        const job = createMockJob(imageJobData, 'image-job-123');

        await processor.processJob(job);

        expect(redisService.publishJobResult).toHaveBeenCalledWith(
          'image-job-123',
          'req-image-123',
          imageResult
        );
      });

      it('should use "unknown" userId when context.userId is missing', async () => {
        vi.mocked(processImageDescriptionJob).mockResolvedValue(imageResult);
        const jobDataWithoutUserId = {
          ...imageJobData,
          context: { channelId: 'channel-123' } as ImageDescriptionJobData['context'],
        };
        const job = createMockJob(jobDataWithoutUserId, 'image-job-123');

        await processor.processJob(job);

        expect(redisService.storeJobResult).toHaveBeenCalledWith(
          'unknown:image-job-123',
          imageResult
        );
      });
    });

    describe('unknown job types', () => {
      it('should throw error for unknown job type', async () => {
        const unknownJobData = {
          requestId: 'req-unknown-123',
          jobType: 'unknown-type' as JobType,
          context: baseContext,
          responseDestination: baseResponseDestination,
        };
        const job = createMockJob(unknownJobData, 'unknown-job-123');

        await expect(processor.processJob(job)).rejects.toThrow('Unknown job type: unknown-type');
      });
    });
  });

  describe('persistAndPublishResult - error handling', () => {
    it('should not throw when database persistence fails', async () => {
      vi.mocked(processAudioTranscriptionJob).mockResolvedValue({
        requestId: 'req-audio-123',
        success: true,
        transcript: 'Test transcript',
      });
      vi.mocked(mockPrisma.jobResult.create).mockRejectedValue(
        new Error('Database connection failed')
      );

      const audioJobData: AudioTranscriptionJobData = {
        requestId: 'req-audio-123',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          name: 'voice.ogg',
          size: 1024,
        },
        context: baseContext,
        responseDestination: baseResponseDestination,
      };
      const job = createMockJob(audioJobData, 'audio-job-123');

      // Should not throw - errors are caught to let BullMQ complete the job
      const result = await processor.processJob(job);
      expect(result.success).toBe(true);
    });

    it('should not throw when Redis publish fails', async () => {
      vi.mocked(processAudioTranscriptionJob).mockResolvedValue({
        requestId: 'req-audio-123',
        success: true,
        transcript: 'Test transcript',
      });
      vi.mocked(redisService.publishJobResult).mockRejectedValue(
        new Error('Redis connection failed')
      );

      const audioJobData: AudioTranscriptionJobData = {
        requestId: 'req-audio-123',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          name: 'voice.ogg',
          size: 1024,
        },
        context: baseContext,
        responseDestination: baseResponseDestination,
      };
      const job = createMockJob(audioJobData, 'audio-job-123');

      // Should not throw - errors are caught to let BullMQ complete the job
      const result = await processor.processJob(job);
      expect(result.success).toBe(true);
    });
  });
});
