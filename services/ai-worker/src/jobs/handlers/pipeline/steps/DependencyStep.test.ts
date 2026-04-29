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
  ApiErrorCategory,
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
        ...authOverride,
      },
      startTime: Date.now(),
    });

    it('re-resolves API key for vision provider when authenticated user has it', async () => {
      const tryResolveUserKey = vi.fn().mockResolvedValue('user-or-key');
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

      // The OpenRouter user key was looked up — not the main z.ai key.
      expect(tryResolveUserKey).toHaveBeenCalledWith('cross-provider-user', AIProvider.OpenRouter);
      // processAttachments received the OpenRouter key + provider, not z.ai.
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/cp.jpg' })],
        CROSS_PROVIDER_PERSONALITY,
        expect.objectContaining({
          userApiKey: 'user-or-key',
          visionProvider: AIProvider.OpenRouter,
          loggingContext: expect.objectContaining({
            userId: 'cross-provider-user',
            apiKeySource: 'user',
            provider: AIProvider.OpenRouter,
          }),
        })
      );
      expect(result.preprocessing?.extendedContextAttachments).toHaveLength(1);
    });

    it('degrades gracefully when apiKeyResolver throws (e.g., transient Redis failure)', async () => {
      // Outer try/catch in processExtendedContextImages must catch resolver
      // exceptions thrown OUTSIDE the processAttachments try (e.g., during
      // `tryResolveUserKey` or `resolveApiKey`). Without that wrapping, a
      // transient blip in apiKeyResolver would propagate up through the
      // pipeline step and skip the graceful fallback the legacy path already
      // has. This test pins the wrap so a future refactor can't quietly
      // remove it.
      const tryResolveUserKey = vi.fn().mockRejectedValue(new Error('Redis blip'));
      const apiKeyResolver = {
        tryResolveUserKey,
        resolveApiKey: vi.fn(),
      } as unknown as NonNullable<ConstructorParameters<typeof DependencyStep>[0]>;
      const stepWithResolver = new DependencyStep(apiKeyResolver);

      const ctx = buildCrossProviderContext(); // authenticated, cross-provider
      // Should not throw — graceful degradation kicks in.
      const result = await stepWithResolver.process(ctx);

      expect(tryResolveUserKey).toHaveBeenCalled();
      expect(mockProcessAttachments).not.toHaveBeenCalled();
      // Empty array signals "couldn't process, but pipeline continues."
      expect(result.preprocessing?.extendedContextAttachments).toEqual([]);
    });

    it('routes guest-mode cross-provider through resolveApiKey (system fallback path)', async () => {
      // Guest with main=z.ai-coding (impossible in practice — z.ai has no
      // system fallback — but the input shape is valid and the code must
      // handle it correctly: visionAuthResolver's guest branch calls
      // `resolveApiKey(visionProvider)` instead of `tryResolveUserKey`.
      // This test pins the integration through DependencyStep so a future
      // refactor can't accidentally collapse the guest/auth branches.
      const tryResolveUserKey = vi.fn();
      const resolveApiKey = vi.fn().mockResolvedValue({
        apiKey: 'system-or-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        isGuestMode: true,
        userId: undefined,
      });
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

      // Guest path uses resolveApiKey (with system fallback), NOT
      // tryResolveUserKey (which would have skipped system entirely).
      expect(resolveApiKey).toHaveBeenCalledWith('cross-provider-user', AIProvider.OpenRouter);
      expect(tryResolveUserKey).not.toHaveBeenCalled();
      // processAttachments received the system key + OpenRouter provider.
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        [expect.objectContaining({ url: 'https://example.com/cp.jpg' })],
        expect.any(Object),
        expect.objectContaining({
          userApiKey: 'system-or-key',
          visionProvider: AIProvider.OpenRouter,
          loggingContext: expect.objectContaining({
            apiKeySource: 'system',
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

    it('builds synthetic-failure entries when authenticated user lacks vision-provider key (fail-fast)', async () => {
      const tryResolveUserKey = vi.fn().mockResolvedValue(null);
      const apiKeyResolver = {
        tryResolveUserKey,
        resolveApiKey: vi.fn(),
      } as unknown as ConstructorParameters<typeof DependencyStep>[0];
      const stepWithResolver = new DependencyStep(apiKeyResolver);

      const result = await stepWithResolver.process(buildCrossProviderContext());

      // Critically: processAttachments was NOT called — short-circuit fired.
      expect(mockProcessAttachments).not.toHaveBeenCalled();
      // Fail-fast result: 1 attachment → 1 synthetic-failure entry with the
      // source-aware fallback string. Cache write happened via storeFailure.
      // Asserting the full argument shape (not just call count) self-documents
      // that `attachmentId: undefined` is intentional — fixtures don't include
      // an `id` field, and `getFailureKey` falls through to URL-hash keying.
      // A future refactor that breaks the storeFailure contract would fail
      // this assertion instead of slipping past on the count alone.
      expect(mockStoreFailure).toHaveBeenCalledTimes(1);
      expect(mockStoreFailure).toHaveBeenCalledWith({
        attachmentId: undefined,
        url: 'https://example.com/cp.jpg',
        category: ApiErrorCategory.AUTHENTICATION,
      });
      const synthetic = result.preprocessing?.extendedContextAttachments;
      expect(synthetic).toHaveLength(1);
      expect(synthetic?.[0]?.description).toContain('check /wallet');
    });
  });
});
