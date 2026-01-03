/**
 * DependencyStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  JobType,
  AttachmentType,
  REDIS_KEY_PREFIXES,
  type LLMGenerationJobData,
  type LoadedPersonality,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
} from '@tzurot/common-types';
import { DependencyStep } from './DependencyStep.js';
import type { GenerationContext } from '../types.js';

// Mock common-types logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

// Mock redis service
const mockGetJobResult = vi.fn();
vi.mock('../../../../redis.js', () => ({
  redisService: {
    getJobResult: mockGetJobResult,
  },
}));

// Mock MultimodalProcessor
const mockProcessAttachments = vi.fn();
vi.mock('../../../../services/MultimodalProcessor.js', () => ({
  processAttachments: mockProcessAttachments,
}));

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-123',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  systemPrompt: 'You are a helpful assistant.',
  model: 'anthropic/claude-sonnet-4',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'A helpful test personality',
  personalityTraits: 'Helpful, friendly',
};

function createValidJobData(overrides: Partial<LLMGenerationJobData> = {}): LLMGenerationJobData {
  return {
    requestId: 'test-req-001',
    jobType: JobType.LLMGeneration,
    personality: TEST_PERSONALITY,
    message: 'Hello, how are you?',
    context: {
      userId: 'user-456',
      userName: 'TestUser',
      channelId: 'channel-789',
    },
    responseDestination: {
      type: 'discord',
      channelId: 'channel-789',
    },
    ...overrides,
  };
}

function createMockJob(data: Partial<LLMGenerationJobData> = {}): Job<LLMGenerationJobData> {
  return {
    id: 'job-123',
    data: createValidJobData(data),
  } as Job<LLMGenerationJobData>;
}

describe('DependencyStep', () => {
  let step: DependencyStep;

  beforeEach(() => {
    vi.clearAllMocks();
    step = new DependencyStep();
  });

  it('should have correct name', () => {
    expect(step.name).toBe('DependencyResolution');
  });

  describe('process', () => {
    it('should return empty preprocessing when no dependencies', async () => {
      const context: GenerationContext = {
        job: createMockJob({ dependencies: [] }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.preprocessing).toEqual({
        processedAttachments: [],
        transcriptions: [],
        referenceAttachments: {},
      });
    });

    it('should return empty preprocessing when dependencies is undefined', async () => {
      const context: GenerationContext = {
        job: createMockJob({ dependencies: undefined }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.preprocessing).toEqual({
        processedAttachments: [],
        transcriptions: [],
        referenceAttachments: {},
      });
    });

    it('should process audio transcription dependency', async () => {
      const audioResult: AudioTranscriptionResult = {
        requestId: 'test-req',
        success: true,
        content: 'Transcribed text here',
        attachmentUrl: 'https://example.com/audio.mp3',
        attachmentName: 'audio.mp3',
      };

      mockGetJobResult.mockResolvedValueOnce(audioResult);

      const context: GenerationContext = {
        job: createMockJob({
          dependencies: [
            {
              jobId: 'audio-job-1',
              type: JobType.AudioTranscription,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}audio-key`,
            },
          ],
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.preprocessing?.processedAttachments).toHaveLength(1);
      expect(result.preprocessing?.processedAttachments[0].type).toBe(AttachmentType.Audio);
      expect(result.preprocessing?.processedAttachments[0].description).toBe(
        'Transcribed text here'
      );
      expect(result.preprocessing?.transcriptions).toContain('Transcribed text here');
    });

    it('should process image description dependency', async () => {
      const imageResult: ImageDescriptionResult = {
        requestId: 'test-req',
        success: true,
        descriptions: [{ url: 'https://example.com/image.png', description: 'A beautiful sunset' }],
      };

      mockGetJobResult.mockResolvedValueOnce(imageResult);

      const context: GenerationContext = {
        job: createMockJob({
          dependencies: [
            {
              jobId: 'image-job-1',
              type: JobType.ImageDescription,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}image-key`,
            },
          ],
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.preprocessing?.processedAttachments).toHaveLength(1);
      expect(result.preprocessing?.processedAttachments[0].type).toBe(AttachmentType.Image);
      expect(result.preprocessing?.processedAttachments[0].description).toBe('A beautiful sunset');
    });

    it('should route attachments with sourceReferenceNumber to referenceAttachments', async () => {
      const imageResult: ImageDescriptionResult = {
        requestId: 'test-req',
        success: true,
        descriptions: [{ url: 'https://example.com/image.png', description: 'Referenced image' }],
        sourceReferenceNumber: 1,
      };

      mockGetJobResult.mockResolvedValueOnce(imageResult);

      const context: GenerationContext = {
        job: createMockJob({
          dependencies: [
            {
              jobId: 'image-job-1',
              type: JobType.ImageDescription,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}image-key`,
            },
          ],
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.preprocessing?.processedAttachments).toHaveLength(0);
      expect(result.preprocessing?.referenceAttachments[1]).toHaveLength(1);
      expect(result.preprocessing?.referenceAttachments[1][0].description).toBe('Referenced image');
    });

    it('should handle multiple dependencies', async () => {
      const audioResult: AudioTranscriptionResult = {
        requestId: 'test-req',
        success: true,
        content: 'Audio content',
        attachmentUrl: 'https://example.com/audio.mp3',
        attachmentName: 'audio.mp3',
      };

      const imageResult: ImageDescriptionResult = {
        requestId: 'test-req',
        success: true,
        descriptions: [{ url: 'https://example.com/image.png', description: 'Image content' }],
      };

      mockGetJobResult.mockResolvedValueOnce(audioResult);
      mockGetJobResult.mockResolvedValueOnce(imageResult);

      const context: GenerationContext = {
        job: createMockJob({
          dependencies: [
            {
              jobId: 'audio-job-1',
              type: JobType.AudioTranscription,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}audio-key`,
            },
            {
              jobId: 'image-job-1',
              type: JobType.ImageDescription,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}image-key`,
            },
          ],
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.preprocessing?.processedAttachments).toHaveLength(2);
    });

    it('should handle failed dependency gracefully', async () => {
      const failedResult: AudioTranscriptionResult = {
        requestId: 'test-req',
        success: false,
        error: 'Transcription failed',
      };

      mockGetJobResult.mockResolvedValueOnce(failedResult);

      const context: GenerationContext = {
        job: createMockJob({
          dependencies: [
            {
              jobId: 'audio-job-1',
              type: JobType.AudioTranscription,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}audio-key`,
            },
          ],
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.preprocessing?.processedAttachments).toHaveLength(0);
      expect(result.preprocessing?.transcriptions).toHaveLength(0);
    });

    it('should handle Redis fetch error gracefully', async () => {
      mockGetJobResult.mockRejectedValueOnce(new Error('Redis connection failed'));

      const context: GenerationContext = {
        job: createMockJob({
          dependencies: [
            {
              jobId: 'audio-job-1',
              type: JobType.AudioTranscription,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}audio-key`,
            },
          ],
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Should not throw, just return empty
      expect(result.preprocessing?.processedAttachments).toHaveLength(0);
    });

    it('should use jobId as key when resultKey is missing', async () => {
      const audioResult: AudioTranscriptionResult = {
        requestId: 'test-req',
        success: true,
        content: 'Transcribed text',
        attachmentUrl: 'https://example.com/audio.mp3',
        attachmentName: 'audio.mp3',
      };

      mockGetJobResult.mockResolvedValueOnce(audioResult);

      const context: GenerationContext = {
        job: createMockJob({
          dependencies: [
            {
              jobId: 'audio-job-fallback',
              type: JobType.AudioTranscription,
              // No resultKey
            },
          ],
        }),
        startTime: Date.now(),
      };

      await step.process(context);

      expect(mockGetJobResult).toHaveBeenCalledWith('audio-job-fallback');
    });
  });

  describe('extended context attachments', () => {
    it('should process extended context image attachments', async () => {
      const processedAttachment = {
        type: AttachmentType.Image,
        description: 'A cat sitting on a couch',
        originalUrl: 'https://example.com/cat.jpg',
        metadata: {
          url: 'https://example.com/cat.jpg',
          name: 'cat.jpg',
          contentType: 'image/jpeg',
          size: 1024,
        },
      };

      mockProcessAttachments.mockResolvedValueOnce([processedAttachment]);

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            extendedContextAttachments: [
              {
                url: 'https://example.com/cat.jpg',
                name: 'cat.jpg',
                contentType: 'image/jpeg',
                size: 1024,
              },
            ],
          },
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/cat.jpg' })],
        TEST_PERSONALITY
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
      expect(result.preprocessing?.extendedContextAttachments?.[0].description).toBe(
        'A cat sitting on a couch'
      );
    });

    it('should filter out non-image attachments from extended context', async () => {
      mockProcessAttachments.mockResolvedValueOnce([]);

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            extendedContextAttachments: [
              {
                url: 'https://example.com/doc.pdf',
                name: 'doc.pdf',
                contentType: 'application/pdf',
                size: 2048,
              },
            ],
          },
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Should not call processAttachments since no images (filter returns empty before calling)
      expect(mockProcessAttachments).not.toHaveBeenCalled();
      // Returns empty array when filtering removes all non-image attachments
      expect(result.preprocessing?.extendedContextAttachments).toEqual([]);
    });

    it('should handle errors in extended context image processing gracefully', async () => {
      mockProcessAttachments.mockRejectedValueOnce(new Error('Vision API failed'));

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            extendedContextAttachments: [
              {
                url: 'https://example.com/image.png',
                name: 'image.png',
                contentType: 'image/png',
                size: 1024,
              },
            ],
          },
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Should not throw, just return empty
      expect(result.preprocessing?.extendedContextAttachments).toEqual([]);
    });

    it('should handle empty extended context attachments array', async () => {
      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            extendedContextAttachments: [],
          },
        }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(mockProcessAttachments).not.toHaveBeenCalled();
      expect(result.preprocessing?.extendedContextAttachments).toBeUndefined();
    });
  });
});
