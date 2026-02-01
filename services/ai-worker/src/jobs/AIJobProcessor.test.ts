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
    markMessageProcessing: vi.fn().mockResolvedValue(true),
    releaseMessageLock: vi.fn().mockResolvedValue(undefined),
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

// Mock LLMGenerationHandler with a mock processJob function we can control
const mockProcessJob = vi.fn().mockResolvedValue({
  requestId: 'req-llm-123',
  success: true,
  content: 'AI response',
  metadata: {
    tokensIn: 100,
    tokensOut: 50,
    modelUsed: 'test-model',
    providerUsed: 'openrouter',
  },
});

vi.mock('./handlers/LLMGenerationHandler.js', () => ({
  LLMGenerationHandler: class MockLLMGenerationHandler {
    processJob = mockProcessJob;
  },
}));

// Import mocked modules
import { redisService } from '../redis.js';
import { processAudioTranscriptionJob } from './AudioTranscriptionJob.js';
import { processImageDescriptionJob } from './ImageDescriptionJob.js';
import { cleanupOldJobResults } from './CleanupJobResults.js';

// Create mock factories
function createMockPrisma(): PrismaClient {
  return {
    jobResult: {
      create: vi.fn().mockResolvedValue({ id: 'result-123' }),
    },
    usageLog: {
      create: vi.fn().mockResolvedValue({ id: 'usage-123' }),
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
    // Reset the mockProcessJob to default behavior
    mockProcessJob.mockResolvedValue({
      requestId: 'req-llm-123',
      success: true,
      content: 'AI response',
      metadata: {
        tokensIn: 100,
        tokensOut: 50,
        modelUsed: 'test-model',
        providerUsed: 'openrouter',
      },
    });
    processor = new AIJobProcessor({ prisma: mockPrisma, ragService: mockRAGService });
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

      it('should NOT persist audio result to database (preprocessing job)', async () => {
        vi.mocked(processAudioTranscriptionJob).mockResolvedValue(audioResult);
        const job = createMockJob(audioJobData, 'audio-job-123');

        await processor.processJob(job);

        // Audio transcription is a preprocessing job - doesn't need delivery tracking
        expect(mockPrisma.jobResult.create).not.toHaveBeenCalled();
      });

      it('should NOT publish audio result to Redis stream (preprocessing job)', async () => {
        vi.mocked(processAudioTranscriptionJob).mockResolvedValue(audioResult);
        const job = createMockJob(audioJobData, 'audio-job-123');

        await processor.processJob(job);

        // Audio transcription is a preprocessing job - it uses wait=true pattern
        // and doesn't need async delivery to bot-client
        expect(redisService.publishJobResult).not.toHaveBeenCalled();
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

        // processImageDescriptionJob receives job and apiKeyResolver (for guest mode detection)
        expect(processImageDescriptionJob).toHaveBeenCalledWith(job, expect.any(Object));
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

      it('should NOT persist image result to database (preprocessing job)', async () => {
        vi.mocked(processImageDescriptionJob).mockResolvedValue(imageResult);
        const job = createMockJob(imageJobData, 'image-job-123');

        await processor.processJob(job);

        // Image description is a preprocessing job - doesn't need delivery tracking
        expect(mockPrisma.jobResult.create).not.toHaveBeenCalled();
      });

      it('should NOT publish image result to Redis stream (preprocessing job)', async () => {
        vi.mocked(processImageDescriptionJob).mockResolvedValue(imageResult);
        const job = createMockJob(imageJobData, 'image-job-123');

        await processor.processJob(job);

        // Image description is a preprocessing job - it uses wait=true pattern
        // and doesn't need async delivery to bot-client
        expect(redisService.publishJobResult).not.toHaveBeenCalled();
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

  describe('LLM generation jobs', () => {
    const baseLLMJobData: LLMGenerationJobData = {
      requestId: 'req-llm-123',
      jobType: JobType.LLMGeneration,
      message: 'Hello, AI!',
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
      context: {
        ...baseContext,
        userInternalId: 'user-internal-uuid-123',
      },
      responseDestination: baseResponseDestination,
    };

    it('should route LLM generation jobs to the LLM handler', async () => {
      const job = createMockJob(baseLLMJobData, 'llm-job-123');

      const result = await processor.processJob(job);

      expect(result.success).toBe(true);
      expect(result.content).toBe('AI response');
    });

    it('should log usage when job succeeds with userInternalId', async () => {
      const job = createMockJob(baseLLMJobData, 'llm-job-123');

      await processor.processJob(job);

      expect(mockPrisma.usageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-internal-uuid-123',
          provider: 'openrouter',
          model: 'test-model',
          tokensIn: 100,
          tokensOut: 50,
          requestType: 'llm_generation',
        }),
      });
    });

    it('should skip usage logging when userInternalId is undefined', async () => {
      const jobDataWithoutInternalId = {
        ...baseLLMJobData,
        context: { ...baseContext }, // No userInternalId
      };
      const job = createMockJob(jobDataWithoutInternalId, 'llm-job-123');

      await processor.processJob(job);

      expect(mockPrisma.usageLog.create).not.toHaveBeenCalled();
    });

    it('should skip usage logging when userInternalId is empty string', async () => {
      const jobDataWithEmptyInternalId = {
        ...baseLLMJobData,
        context: { ...baseContext, userInternalId: '' },
      };
      const job = createMockJob(jobDataWithEmptyInternalId, 'llm-job-123');

      await processor.processJob(job);

      expect(mockPrisma.usageLog.create).not.toHaveBeenCalled();
    });

    it('should skip usage logging when job fails', async () => {
      // Override the mock to return a failed result
      mockProcessJob.mockResolvedValueOnce({
        requestId: 'req-llm-123',
        success: false,
        error: 'AI generation failed',
      });

      const job = createMockJob(baseLLMJobData, 'llm-job-123');

      await processor.processJob(job);

      expect(mockPrisma.usageLog.create).not.toHaveBeenCalled();
    });

    it('should use personality model when modelUsed is missing from metadata', async () => {
      mockProcessJob.mockResolvedValueOnce({
        requestId: 'req-llm-123',
        success: true,
        content: 'AI response',
        metadata: {
          tokensIn: 100,
          tokensOut: 50,
          // modelUsed is missing
        },
      });

      const job = createMockJob(baseLLMJobData, 'llm-job-123');

      await processor.processJob(job);

      expect(mockPrisma.usageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          model: 'test-model', // Falls back to personality.model
        }),
      });
    });

    it('should default to openrouter provider when providerUsed is missing', async () => {
      mockProcessJob.mockResolvedValueOnce({
        requestId: 'req-llm-123',
        success: true,
        content: 'AI response',
        metadata: {
          tokensIn: 100,
          tokensOut: 50,
          modelUsed: 'test-model',
          // providerUsed is missing
        },
      });

      const job = createMockJob(baseLLMJobData, 'llm-job-123');

      await processor.processJob(job);

      expect(mockPrisma.usageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: 'openrouter', // Default
        }),
      });
    });

    it('should not fail job when usage logging fails after all retries', async () => {
      vi.mocked(mockPrisma.usageLog.create).mockRejectedValue(
        new Error('Database error during usage logging')
      );

      const job = createMockJob(baseLLMJobData, 'llm-job-123');

      // Should not throw - usage logging errors are non-fatal
      const result = await processor.processJob(job);
      expect(result.success).toBe(true);

      // Should have attempted 3 times (with retry)
      expect(mockPrisma.usageLog.create).toHaveBeenCalledTimes(3);
    });

    it('should succeed on retry after initial failure', async () => {
      // First call fails, second succeeds
      vi.mocked(mockPrisma.usageLog.create)
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce({ id: 'usage-123' } as ReturnType<
          typeof mockPrisma.usageLog.create
        >);

      const job = createMockJob(baseLLMJobData, 'llm-job-123');

      const result = await processor.processJob(job);
      expect(result.success).toBe(true);

      // Should have called twice (initial + one retry)
      expect(mockPrisma.usageLog.create).toHaveBeenCalledTimes(2);
    });

    it('should succeed on third retry after two failures', async () => {
      // First two calls fail, third succeeds
      vi.mocked(mockPrisma.usageLog.create)
        .mockRejectedValueOnce(new Error('Transient error 1'))
        .mockRejectedValueOnce(new Error('Transient error 2'))
        .mockResolvedValueOnce({ id: 'usage-123' } as ReturnType<
          typeof mockPrisma.usageLog.create
        >);

      const job = createMockJob(baseLLMJobData, 'llm-job-123');

      const result = await processor.processJob(job);
      expect(result.success).toBe(true);

      // Should have called three times
      expect(mockPrisma.usageLog.create).toHaveBeenCalledTimes(3);
    });

    it('should default tokens to 0 when missing from metadata', async () => {
      mockProcessJob.mockResolvedValueOnce({
        requestId: 'req-llm-123',
        success: true,
        content: 'AI response',
        metadata: {
          modelUsed: 'test-model',
          // tokensIn and tokensOut are missing
        },
      });

      const job = createMockJob(baseLLMJobData, 'llm-job-123');

      await processor.processJob(job);

      expect(mockPrisma.usageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokensIn: 0,
          tokensOut: 0,
        }),
      });
    });

    describe('idempotency', () => {
      it('should skip processing when message was already processed', async () => {
        vi.mocked(redisService.markMessageProcessing).mockResolvedValueOnce(false);

        const jobDataWithTriggerMessageId = {
          ...baseLLMJobData,
          context: { ...baseLLMJobData.context, triggerMessageId: 'discord-msg-123' },
        };
        const job = createMockJob(jobDataWithTriggerMessageId, 'llm-job-123');

        const result = await processor.processJob(job);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Duplicate message - already processed');
        expect(mockProcessJob).not.toHaveBeenCalled();
        expect(redisService.releaseMessageLock).not.toHaveBeenCalled();
      });

      it('should process message and keep lock on success', async () => {
        vi.mocked(redisService.markMessageProcessing).mockResolvedValueOnce(true);

        const jobDataWithTriggerMessageId = {
          ...baseLLMJobData,
          context: { ...baseLLMJobData.context, triggerMessageId: 'discord-msg-123' },
        };
        const job = createMockJob(jobDataWithTriggerMessageId, 'llm-job-123');

        const result = await processor.processJob(job);

        expect(result.success).toBe(true);
        expect(mockProcessJob).toHaveBeenCalled();
        // Lock should NOT be released on success
        expect(redisService.releaseMessageLock).not.toHaveBeenCalled();
      });

      it('should release lock when processing fails', async () => {
        vi.mocked(redisService.markMessageProcessing).mockResolvedValueOnce(true);
        mockProcessJob.mockRejectedValueOnce(new Error('LLM API timeout'));

        const jobDataWithTriggerMessageId = {
          ...baseLLMJobData,
          context: { ...baseLLMJobData.context, triggerMessageId: 'discord-msg-123' },
        };
        const job = createMockJob(jobDataWithTriggerMessageId, 'llm-job-123');

        await expect(processor.processJob(job)).rejects.toThrow('LLM API timeout');

        // Lock should be released on failure to allow retries
        expect(redisService.releaseMessageLock).toHaveBeenCalledWith('discord-msg-123');
      });

      it('should not check idempotency when triggerMessageId is undefined', async () => {
        const jobDataWithoutTriggerMessageId = {
          ...baseLLMJobData,
          context: { ...baseLLMJobData.context }, // No triggerMessageId
        };
        const job = createMockJob(jobDataWithoutTriggerMessageId, 'llm-job-123');

        await processor.processJob(job);

        expect(redisService.markMessageProcessing).not.toHaveBeenCalled();
      });
    });
  });

  describe('cleanup job results', () => {
    it('should not fail when cleanup throws an error', async () => {
      // Make cleanup throw an error
      vi.mocked(cleanupOldJobResults).mockRejectedValueOnce(new Error('Cleanup failed'));

      vi.mocked(processAudioTranscriptionJob).mockResolvedValue({
        requestId: 'req-audio-123',
        success: true,
        transcript: 'Test transcript',
      });

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

      // Should not throw - cleanup errors are non-critical
      const result = await processor.processJob(job);
      expect(result.success).toBe(true);
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
