/**
 * DependencyStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  JobType,
  JobStatus,
  AttachmentType,
  AIProvider,
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

// Guest mode personality with free model and free vision model (simulates resolved config for guest users)
const GUEST_EFFECTIVE_PERSONALITY: LoadedPersonality = {
  ...TEST_PERSONALITY,
  model: 'google/gemma-3-27b-it:free',
  visionModel: 'google/gemma-3-27b-it:free', // Free vision model from resolved guest config
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
              status: JobStatus.Completed,
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
              status: JobStatus.Completed,
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
              status: JobStatus.Completed,
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
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}audio-key`,
            },
            {
              jobId: 'image-job-1',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
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
              status: JobStatus.Completed,
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
              status: JobStatus.Completed,
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
              status: JobStatus.Completed,
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
    it('should process extended context image attachments using effective personality', async () => {
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
        // Config context from ConfigStep (now required for consistent behavior)
        config: {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        },
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Uses effectivePersonality from config context
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/cat.jpg' })],
        TEST_PERSONALITY,
        false,
        undefined
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
      expect(result.preprocessing?.extendedContextAttachments?.[0].description).toBe(
        'A cat sitting on a couch'
      );
    });

    it('should pass BYOK userApiKey from auth context to processAttachments', async () => {
      const processedAttachment = {
        type: AttachmentType.Image,
        description: 'A dog playing fetch',
        originalUrl: 'https://example.com/dog.jpg',
        metadata: {
          url: 'https://example.com/dog.jpg',
          name: 'dog.jpg',
          contentType: 'image/jpeg',
          size: 2048,
        },
      };

      mockProcessAttachments.mockResolvedValueOnce([processedAttachment]);

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'byok-user-789',
            userName: 'BYOKUser',
            channelId: 'channel-456',
            extendedContextAttachments: [
              {
                url: 'https://example.com/dog.jpg',
                name: 'dog.jpg',
                contentType: 'image/jpeg',
                size: 2048,
              },
            ],
          },
        }),
        // Config context from ConfigStep
        config: {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'user-personality',
        },
        // Auth context populated by AuthStep (which runs before DependencyStep)
        auth: {
          apiKey: 'user-test-key-12345',
          isGuestMode: false,
          provider: AIProvider.OpenRouter,
        },
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Verify BYOK key is passed through to processAttachments
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/dog.jpg' })],
        TEST_PERSONALITY,
        false, // isGuestMode from auth context
        'user-test-key-12345' // userApiKey from auth context (BYOK)
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });

    it('should use guest effective personality with free visionModel for guest users', async () => {
      const processedAttachment = {
        type: AttachmentType.Image,
        description: 'A bird in flight',
        originalUrl: 'https://example.com/bird.jpg',
        metadata: {
          url: 'https://example.com/bird.jpg',
          name: 'bird.jpg',
          contentType: 'image/jpeg',
          size: 1536,
        },
      };

      mockProcessAttachments.mockResolvedValueOnce([processedAttachment]);

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'guest-user-123',
            userName: 'GuestUser',
            channelId: 'channel-789',
            extendedContextAttachments: [
              {
                url: 'https://example.com/bird.jpg',
                name: 'bird.jpg',
                contentType: 'image/jpeg',
                size: 1536,
              },
            ],
          },
        }),
        // Config context with FREE effective personality (resolved by ConfigStep for guest users)
        // This is the key difference: guest users get effectivePersonality with free visionModel
        config: {
          effectivePersonality: GUEST_EFFECTIVE_PERSONALITY,
          configSource: 'user-default', // Guest users use default free config
        },
        // Auth context for guest user (no BYOK key)
        auth: {
          apiKey: 'system-openrouter-key', // System key used for guests
          isGuestMode: true,
          provider: AIProvider.OpenRouter,
        },
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Verify processAttachments receives the GUEST effective personality
      // which has visionModel: 'google/gemma-3-27b-it:free' from the resolved config
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/bird.jpg' })],
        GUEST_EFFECTIVE_PERSONALITY, // Uses resolved config with free visionModel
        true, // isGuestMode = true for guest users
        'system-openrouter-key' // System key (guests don't have BYOK)
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);

      // Verify the personality passed has the free vision model
      const passedPersonality = mockProcessAttachments.mock.calls[0][1];
      expect(passedPersonality.visionModel).toBe('google/gemma-3-27b-it:free');
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
        config: {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        },
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
        config: {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        },
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
        config: {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        },
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(mockProcessAttachments).not.toHaveBeenCalled();
      expect(result.preprocessing?.extendedContextAttachments).toBeUndefined();
    });

    it('should log warning and use system key fallback when auth context is missing', async () => {
      const processedAttachment = {
        type: AttachmentType.Image,
        description: 'An image processed without BYOK',
        originalUrl: 'https://example.com/noauth.jpg',
        metadata: {
          url: 'https://example.com/noauth.jpg',
          name: 'noauth.jpg',
          contentType: 'image/jpeg',
          size: 1024,
        },
      };

      // Reset the mock completely before setting up
      mockProcessAttachments.mockReset();
      mockProcessAttachments.mockResolvedValue([processedAttachment]);

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            extendedContextAttachments: [
              {
                url: 'https://example.com/noauth.jpg',
                name: 'noauth.jpg',
                contentType: 'image/jpeg',
                size: 1024,
              },
            ],
          },
        }),
        // Config context is present
        config: {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        },
        // NOTE: No auth context - simulates edge case where AuthStep failed/was skipped
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Verify processAttachments uses fallback values (false, undefined)
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/noauth.jpg' })],
        TEST_PERSONALITY,
        false, // isGuestMode defaults to false when auth missing
        undefined // userApiKey is undefined (system key fallback)
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });

    it('should fall back to job.data.personality when config context is missing', async () => {
      const processedAttachment = {
        type: AttachmentType.Image,
        description: 'An image processed with fallback personality',
        originalUrl: 'https://example.com/fallback.jpg',
        metadata: {
          url: 'https://example.com/fallback.jpg',
          name: 'fallback.jpg',
          contentType: 'image/jpeg',
          size: 1024,
        },
      };

      // Reset the mock completely before setting up
      mockProcessAttachments.mockReset();
      mockProcessAttachments.mockResolvedValue([processedAttachment]);

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            extendedContextAttachments: [
              {
                url: 'https://example.com/fallback.jpg',
                name: 'fallback.jpg',
                contentType: 'image/jpeg',
                size: 1024,
              },
            ],
          },
        }),
        // NOTE: No config context - simulates edge case where ConfigStep failed/was skipped
        // DependencyStep should fall back to job.data.personality
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Verify processAttachments uses job.data.personality as fallback
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/fallback.jpg' })],
        TEST_PERSONALITY, // Falls back to job.data.personality
        false,
        undefined
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });
  });
});
