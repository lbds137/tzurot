/**
 * DependencyStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { JobType, JobStatus, REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import {
  type LLMGenerationJobData,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
} from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { DependencyStep, deriveExtendedContextImages } from './DependencyStep.js';
import type { GenerationContext } from '../types.js';

// Mock common-types logger
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

// Mock redis service. Mock factories are hoisted by vitest, so we wrap the
// `vi.fn()` references in arrow-function thunks — the closures defer the
// reference resolution until the mocked module is actually invoked, sidestepping
// the temporal-dead-zone error that otherwise fires when transitive imports
// (e.g., visionAuthResolver) trigger redis.js loading at module-init time.
const mockGetJobResult = vi.fn();
const mockStoreFailure = vi.fn();
vi.mock('../../../../redis.js', () => ({
  redisService: {
    getJobResult: (...args: unknown[]) => mockGetJobResult(...args),
  },
  visionDescriptionCache: {
    storeFailure: (...args: unknown[]) => mockStoreFailure(...args),
  },
  visionFallbackQuota: {
    tryConsume: () => Promise.resolve(true),
  },
}));

// Mock MultimodalProcessor
const mockProcessAttachments = vi.fn();
vi.mock('../../../../services/MultimodalProcessor.js', () => ({
  processAttachments: mockProcessAttachments,
  deriveApiKeySource: (isGuestMode: boolean, userApiKey: string | undefined): 'user' | 'system' =>
    !isGuestMode && userApiKey !== undefined ? 'user' : 'system',
}));

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-123',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  ownerId: 'owner-uuid-test',
  systemPrompt: 'You are a helpful assistant.',
  model: 'anthropic/claude-sonnet-4',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'A helpful test personality',
  personalityTraits: 'Helpful, friendly',
  voiceEnabled: false,
};

// Guest mode personality with free model and free vision model (simulates resolved config for guest users)
const GUEST_EFFECTIVE_PERSONALITY: LoadedPersonality = {
  ...TEST_PERSONALITY,
  model: 'google/gemma-3-27b-it:free',
  provider: 'openrouter',
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

  describe('vision-description persistence', () => {
    const makeWriter = () => ({
      persistTriggerDescriptions: vi.fn().mockResolvedValue(undefined),
      persistReferenceDescriptions: vi.fn().mockResolvedValue(undefined),
    });

    it('persists trigger descriptions post-vision when attachments were processed', async () => {
      const imageResult: ImageDescriptionResult = {
        requestId: 'test-req',
        success: true,
        descriptions: [{ url: 'https://example.com/image.png', description: 'A beautiful sunset' }],
      };
      mockGetJobResult.mockResolvedValueOnce(imageResult);
      const writer = makeWriter();
      const stepWithWriter = new DependencyStep(undefined, writer as never);

      await stepWithWriter.process({
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
      });

      expect(writer.persistTriggerDescriptions).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-123',
          message: 'Hello, how are you?',
          personalityId: TEST_PERSONALITY.id,
          jobContext: expect.objectContaining({ channelId: 'channel-789' }),
          processedAttachments: [expect.objectContaining({ description: 'A beautiful sunset' })],
        })
      );
    });

    it('does not invoke the writer when no trigger attachments were processed', async () => {
      const writer = makeWriter();
      const stepWithWriter = new DependencyStep(undefined, writer as never);

      await stepWithWriter.process({
        job: createMockJob({ dependencies: [] }),
        startTime: Date.now(),
      });

      expect(writer.persistTriggerDescriptions).not.toHaveBeenCalled();
      expect(writer.persistReferenceDescriptions).not.toHaveBeenCalled();
    });

    it('persists reference descriptions when a referenced-image dependency was processed', async () => {
      const imageResult: ImageDescriptionResult = {
        requestId: 'test-req',
        success: true,
        descriptions: [{ url: 'https://example.com/ref.png', description: 'A quoted image' }],
        sourceReferenceNumber: 1,
      };
      mockGetJobResult.mockResolvedValueOnce(imageResult);
      const writer = makeWriter();
      const stepWithWriter = new DependencyStep(undefined, writer as never);

      await stepWithWriter.process({
        job: createMockJob({
          dependencies: [
            {
              jobId: 'ref-image-job-1',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}ref-image-key`,
            },
          ],
        }),
        startTime: Date.now(),
      });

      // Reference attachments route here, not to trigger descriptions
      expect(writer.persistTriggerDescriptions).not.toHaveBeenCalled();
      expect(writer.persistReferenceDescriptions).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-123',
          personalityId: TEST_PERSONALITY.id,
          jobContext: expect.objectContaining({ channelId: 'channel-789' }),
          processedReferenceAttachments: expect.objectContaining({
            1: [expect.objectContaining({ description: 'A quoted image' })],
          }),
        })
      );
    });
  });

  describe('deriveExtendedContextImages', () => {
    const img = (id: string): { url: string; contentType: string; id: string } => ({
      url: `https://cdn/${id}.png`,
      contentType: 'image/png',
      id,
    });

    it('returns undefined when the envelope carries no raw image list', () => {
      expect(deriveExtendedContextImages(undefined, 10)).toBeUndefined();
    });

    it('returns undefined when maxImages disables the feature (bot parity)', () => {
      // The bot ships undefined for maxImages <= 0, not [].
      expect(deriveExtendedContextImages([img('a')], 0)).toBeUndefined();
      expect(deriveExtendedContextImages([img('a')], undefined)).toBeUndefined();
    });

    it('caps to the most recent maxImages via slice(-cap), matching the bot rule', () => {
      const result = deriveExtendedContextImages([img('a'), img('b'), img('c')], 2);
      expect(result?.map(i => i.id)).toEqual(['b', 'c']);
    });

    it('passes the full list through when under the cap', () => {
      const result = deriveExtendedContextImages([img('a')], 10);
      expect(result?.map(i => i.id)).toEqual(['a']);
    });
  });

  describe('extended context attachments', () => {
    it('derives the image list from the raw envelope when the payload field is absent (thin payload)', async () => {
      const processedAttachment = {
        type: AttachmentType.Image,
        description: 'derived image',
        originalUrl: 'https://cdn/raw1.png',
        metadata: { url: 'https://cdn/raw1.png', contentType: 'image/png' },
      };
      mockProcessAttachments.mockResolvedValueOnce([processedAttachment]);

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            // No extendedContextAttachments — thin payload shape.
            rawAssemblyInputs: {
              rawMessageContent: 'hi',
              rawExtendedContextImageAttachments: [
                { url: 'https://cdn/raw0.png', contentType: 'image/png', id: 'raw0' },
                { url: 'https://cdn/raw1.png', contentType: 'image/png', id: 'raw1' },
              ],
            },
          },
        }),
        config: { effectivePersonality: TEST_PERSONALITY, configSource: 'personality' },
        configOverrides: { maxImages: 1 } as never,
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Capped to the most recent 1 of the 2 raw images.
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'raw1' })],
        TEST_PERSONALITY,
        expect.anything()
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });

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
        expect.objectContaining({
          isGuestMode: false,
          loggingContext: expect.objectContaining({ apiKeySource: 'system' }),
        })
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
          audioProviderKeys: new Map(),
        },
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Verify BYOK key is passed through to processAttachments
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/dog.jpg' })],
        TEST_PERSONALITY,
        expect.objectContaining({
          isGuestMode: false,
          userApiKey: 'user-test-key-12345',
          loggingContext: expect.objectContaining({
            userId: 'byok-user-789',
            apiKeySource: 'user',
          }),
        })
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
          audioProviderKeys: new Map(),
        },
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Verify processAttachments receives the GUEST effective personality
      // which has visionModel: 'google/gemma-3-27b-it:free' from the resolved config.
      // Critical: apiKeySource MUST be 'system' for guest users — even though the
      // `userApiKey` arg is non-undefined (it's the system key passed via auth.apiKey),
      // a guest doesn't have a BYOK and shouldn't see "[your API key was rejected]"
      // wording on AUTH failures.
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/bird.jpg' })],
        GUEST_EFFECTIVE_PERSONALITY, // Uses resolved config with free visionModel
        expect.objectContaining({
          isGuestMode: true,
          userApiKey: 'system-openrouter-key',
          loggingContext: expect.objectContaining({
            userId: 'guest-user-123',
            apiKeySource: 'system',
          }),
        })
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
        expect.objectContaining({
          isGuestMode: false,
          loggingContext: expect.objectContaining({ apiKeySource: 'system' }),
        })
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
        expect.objectContaining({
          isGuestMode: false,
          loggingContext: expect.objectContaining({ apiKeySource: 'system' }),
        })
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });
  });

  describe('cross-provider vision auth (with injected apiKeyResolver)', () => {
    // Personality with cross-provider config: main=z.ai-coding, vision=OpenRouter
    const CROSS_PROVIDER_PERSONALITY: LoadedPersonality = {
      ...TEST_PERSONALITY,
      model: 'glm-5.1', // → ZaiCoding via detectVisionProvider
      visionModel: 'qwen/qwen3.5-397b-a17b', // → OpenRouter
    };

    const buildCrossProviderContext = (
      authOverride: Partial<NonNullable<GenerationContext['auth']>> = {}
    ): GenerationContext => ({
      job: createMockJob({
        context: {
          userId: 'cross-provider-user',
          userName: 'CrossUser',
          channelId: 'channel-cp',
          extendedContextAttachments: [
            {
              url: 'https://example.com/cp.jpg',
              name: 'cp.jpg',
              contentType: 'image/jpeg',
              size: 1024,
            },
          ],
        },
      }),
      config: {
        effectivePersonality: CROSS_PROVIDER_PERSONALITY,
        configSource: 'user-personality',
      },
      auth: {
        apiKey: 'user-zai-key',
        isGuestMode: false,
        provider: AIProvider.ZaiCoding,
        audioProviderKeys: new Map(),
        ...authOverride,
      },
      startTime: Date.now(),
    });

    it('re-resolves API key for vision provider when authenticated user has it', async () => {
      // Phase-4: auth resolution moved into describeImageWithFallback (invoked deep in
      // the mocked-away processAttachments). DependencyStep no longer drives the resolver;
      // it forwards the auth INPUTS bundle. The resolver mock is retained only to satisfy
      // the injected `apiKeyResolver` param type — it won't be called from this unit.
      const tryResolveUserKey = vi.fn();
      const apiKeyResolver = {
        tryResolveUserKey,
        resolveApiKey: vi.fn(),
      } as unknown as ConstructorParameters<typeof DependencyStep>[0];
      const stepWithResolver = new DependencyStep(apiKeyResolver);

      mockProcessAttachments.mockResolvedValueOnce([
        {
          type: AttachmentType.Image,
          description: 'cross-provider success',
          originalUrl: 'https://example.com/cp.jpg',
          metadata: {
            url: 'https://example.com/cp.jpg',
            name: 'cp.jpg',
            contentType: 'image/jpeg',
            size: 1024,
          },
        },
      ]);

      const result = await stepWithResolver.process(buildCrossProviderContext());

      // processAttachments received the visionAuth INPUTS bundle — carrying the main
      // provider/key + the injected resolver — for the fallback loop to resolve per-tier.
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/cp.jpg' })],
        CROSS_PROVIDER_PERSONALITY,
        expect.objectContaining({
          isGuestMode: false,
          sttDispatch: undefined,
          loggingContext: { userId: 'cross-provider-user' },
          visionAuth: expect.objectContaining({
            personality: CROSS_PROVIDER_PERSONALITY,
            mainProvider: AIProvider.ZaiCoding,
            mainApiKey: 'user-zai-key',
            isGuestMode: false,
            userId: 'cross-provider-user',
            apiKeyResolver,
          }),
        })
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });

    it('forwards the visionAuth bundle regardless of resolver behavior (fail-fast now lives in the wrapper)', async () => {
      // Phase-4: the transient-resolver-throw → fail-fast-placeholder premise moved into
      // describeImageWithFallback (invoked deep in the mocked-away processAttachments).
      // DependencyStep no longer resolves auth or short-circuits — it forwards the auth
      // INPUTS bundle unconditionally. The resolver mock is retained only to satisfy the
      // injected `apiKeyResolver` param type; it won't be called from this unit.
      const tryResolveUserKey = vi.fn();
      const apiKeyResolver = {
        tryResolveUserKey,
        resolveApiKey: vi.fn(),
      } as unknown as NonNullable<ConstructorParameters<typeof DependencyStep>[0]>;
      const stepWithResolver = new DependencyStep(apiKeyResolver);

      mockProcessAttachments.mockResolvedValueOnce([
        {
          type: AttachmentType.Image,
          description: 'cross-provider success',
          originalUrl: 'https://example.com/cp.jpg',
          metadata: {
            url: 'https://example.com/cp.jpg',
            name: 'cp.jpg',
            contentType: 'image/jpeg',
            size: 1024,
          },
        },
      ]);

      const ctx = buildCrossProviderContext(); // authenticated, cross-provider
      const result = await stepWithResolver.process(ctx);

      // processAttachments IS called with the visionAuth bundle — the fail-fast /
      // synthetic-placeholder behavior is the wrapper's responsibility, covered by
      // describeImageWithFallback.test.ts + extendedContextVisionProcessor.test.ts.
      expect(mockProcessAttachments).toHaveBeenCalledTimes(1);
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/cp.jpg' })],
        CROSS_PROVIDER_PERSONALITY,
        expect.objectContaining({
          isGuestMode: false,
          loggingContext: { userId: 'cross-provider-user' },
          visionAuth: expect.objectContaining({
            personality: CROSS_PROVIDER_PERSONALITY,
            mainProvider: AIProvider.ZaiCoding,
            mainApiKey: 'user-zai-key',
            userId: 'cross-provider-user',
            apiKeyResolver,
          }),
        })
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });

    it('forwards the visionAuth bundle with guest-mode inputs for guest cross-provider', async () => {
      // Phase-4: the guest branch (resolveApiKey system fallback vs. tryResolveUserKey)
      // moved into describeImageWithFallback (invoked deep in the mocked-away
      // processAttachments). DependencyStep only forwards the auth INPUTS bundle — here
      // it carries `isGuestMode: true` so the wrapper takes the guest resolution branch.
      // The resolver mock is retained to satisfy the injected param type; not called here.
      const tryResolveUserKey = vi.fn();
      const resolveApiKey = vi.fn();
      const apiKeyResolver = {
        tryResolveUserKey,
        resolveApiKey,
      } as unknown as NonNullable<ConstructorParameters<typeof DependencyStep>[0]>;
      const stepWithResolver = new DependencyStep(apiKeyResolver);

      mockProcessAttachments.mockResolvedValueOnce([
        {
          type: AttachmentType.Image,
          description: 'guest cross-provider success',
          originalUrl: 'https://example.com/cp.jpg',
          metadata: {
            url: 'https://example.com/cp.jpg',
            name: 'cp.jpg',
            contentType: 'image/jpeg',
            size: 1024,
          },
        },
      ]);

      const ctx = buildCrossProviderContext({ isGuestMode: true });
      const result = await stepWithResolver.process(ctx);

      // processAttachments received the visionAuth bundle carrying the guest-mode flag
      // and the injected resolver — the guest/auth branch decision is the wrapper's.
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/cp.jpg' })],
        expect.any(Object),
        expect.objectContaining({
          isGuestMode: true,
          loggingContext: { userId: 'cross-provider-user' },
          visionAuth: expect.objectContaining({
            personality: CROSS_PROVIDER_PERSONALITY,
            mainProvider: AIProvider.ZaiCoding,
            mainApiKey: 'user-zai-key',
            isGuestMode: true,
            userId: 'cross-provider-user',
            apiKeyResolver,
          }),
        })
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });

    it('falls back to legacy path when mainProvider is undefined (degraded auth)', async () => {
      // The cross-provider guard requires both apiKeyResolver AND mainProvider
      // to be defined. AuthStep's resolution-failure catch branch leaves
      // `auth.provider` undefined; this test pins the legacy-fallback behavior
      // for that case (logs error, processes via main key verbatim).
      const tryResolveUserKey = vi.fn();
      const resolveApiKey = vi.fn();
      const apiKeyResolver = {
        tryResolveUserKey,
        resolveApiKey,
      } as unknown as NonNullable<ConstructorParameters<typeof DependencyStep>[0]>;
      const stepWithResolver = new DependencyStep(apiKeyResolver);

      mockProcessAttachments.mockResolvedValueOnce([
        {
          type: AttachmentType.Image,
          description: 'legacy-fallback success',
          originalUrl: 'https://example.com/cp.jpg',
          metadata: {
            url: 'https://example.com/cp.jpg',
            name: 'cp.jpg',
            contentType: 'image/jpeg',
            size: 1024,
          },
        },
      ]);

      // Override the auth context so provider is undefined
      const ctx = buildCrossProviderContext({ provider: undefined });
      const result = await stepWithResolver.process(ctx);

      // Cross-provider path was NOT entered — resolver was not called.
      expect(tryResolveUserKey).not.toHaveBeenCalled();
      expect(resolveApiKey).not.toHaveBeenCalled();
      // Legacy path ran — processAttachments invoked without visionProvider.
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        expect.not.objectContaining({ visionProvider: expect.anything() })
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });

    it('forwards the visionAuth bundle when authenticated user lacks vision-provider key (free-downgrade now in wrapper)', async () => {
      // Phase-4: the free-model-on-system-key downgrade (for an authenticated user with
      // no vision-provider key) moved into describeImageWithFallback (invoked deep in the
      // mocked-away processAttachments). DependencyStep no longer pre-resolves the free
      // model — it forwards the auth INPUTS bundle. The resolver mock is retained to
      // satisfy the injected param type; not called from this unit.
      const tryResolveUserKey = vi.fn();
      const resolveApiKey = vi.fn();
      const apiKeyResolver = {
        tryResolveUserKey,
        resolveApiKey,
      } as unknown as ConstructorParameters<typeof DependencyStep>[0];
      const stepWithResolver = new DependencyStep(apiKeyResolver);

      mockProcessAttachments.mockResolvedValueOnce([
        {
          type: AttachmentType.Image,
          description: 'free-fallback success',
          originalUrl: 'https://example.com/cp.jpg',
          metadata: {
            url: 'https://example.com/cp.jpg',
            name: 'cp.jpg',
            contentType: 'image/jpeg',
            size: 1024,
          },
        },
      ]);

      const result = await stepWithResolver.process(buildCrossProviderContext());

      // processAttachments received the visionAuth INPUTS bundle — the free-downgrade
      // decision (forced model + system key) is the wrapper's, covered by
      // describeImageWithFallback.test.ts.
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/cp.jpg' })],
        CROSS_PROVIDER_PERSONALITY,
        expect.objectContaining({
          isGuestMode: false,
          loggingContext: { userId: 'cross-provider-user' },
          visionAuth: expect.objectContaining({
            personality: CROSS_PROVIDER_PERSONALITY,
            mainProvider: AIProvider.ZaiCoding,
            mainApiKey: 'user-zai-key',
            isGuestMode: false,
            userId: 'cross-provider-user',
            apiKeyResolver,
          }),
        })
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });

    it('forwards the visionAuth bundle even when no system fallback would be available (synthetic-failure now in wrapper)', async () => {
      // Phase-4: the fallback-of-fallback "configure your key" synthetic-failure
      // placeholder (authenticated user lacks the vision-provider key AND no system key)
      // moved into describeImageWithFallback (invoked deep in the mocked-away
      // processAttachments). DependencyStep no longer short-circuits — it forwards the
      // auth INPUTS bundle regardless. The resolver mock is retained to satisfy the
      // injected param type; not called from this unit.
      const tryResolveUserKey = vi.fn();
      const resolveApiKey = vi.fn();
      const apiKeyResolver = {
        tryResolveUserKey,
        resolveApiKey,
      } as unknown as ConstructorParameters<typeof DependencyStep>[0];
      const stepWithResolver = new DependencyStep(apiKeyResolver);

      mockProcessAttachments.mockResolvedValueOnce([]);

      const result = await stepWithResolver.process(buildCrossProviderContext());

      // processAttachments IS called with the visionAuth bundle — the synthetic-failure
      // "configure your key" placeholder is now the wrapper's responsibility, covered by
      // describeImageWithFallback.test.ts + extendedContextVisionProcessor.test.ts.
      expect(mockProcessAttachments).toHaveBeenCalledTimes(1);
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/cp.jpg' })],
        CROSS_PROVIDER_PERSONALITY,
        expect.objectContaining({
          isGuestMode: false,
          loggingContext: { userId: 'cross-provider-user' },
          visionAuth: expect.objectContaining({
            personality: CROSS_PROVIDER_PERSONALITY,
            mainProvider: AIProvider.ZaiCoding,
            mainApiKey: 'user-zai-key',
            userId: 'cross-provider-user',
            apiKeyResolver,
          }),
        })
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(0);
    });
  });
});
