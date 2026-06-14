/**
 * Tests for Image Description Job Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processImageDescriptionJob } from './ImageDescriptionJob.js';
import type { Job } from 'bullmq';
import type { ImageDescriptionJobData, LoadedPersonality } from '@tzurot/common-types';
import { JobType, CONTENT_TYPES, AIProvider, TIMEOUTS, MODEL_DEFAULTS } from '@tzurot/common-types';

// Mirrors the module-level constant in ImageDescriptionJob.ts. Intentionally
// kept as a copy so the test asserts the expected *contract* (vision uses 2
// attempts) rather than coupling to the implementation's internal name.
const VISION_MAX_ATTEMPTS = 2;
import type { ApiKeyResolver } from '../services/ApiKeyResolver.js';

// Mock describeImage, withRetry, and shouldRetryError
vi.mock('../services/MultimodalProcessor.js', () => ({
  describeImage: vi.fn(),
}));

vi.mock('../utils/retry.js', () => ({
  withRetry: vi.fn(),
}));

vi.mock('../utils/apiErrorParser.js', () => ({
  shouldRetryError: vi.fn((_error: unknown) => true),
  getErrorLogContext: vi.fn((_error: unknown) => ({})),
}));

// `buildFailFastResult` lazy-imports `visionDescriptionCache` from redis.js;
// stub the cache method so the dynamic import resolves without hitting a real
// Redis client at test time. Thunks defer reference resolution past hoisting.
// `checkModelVisionSupport` is reached transitively now that resolveVisionConfig
// calls the real `selectVisionModel` — default it to false so the
// no-visionModel-override tests fall through to the fallback model without a
// real Redis call.
const mockStoreFailure = vi.fn();
const mockCheckModelVisionSupport = vi.fn().mockResolvedValue(false);
vi.mock('../redis.js', () => ({
  visionDescriptionCache: {
    storeFailure: (...args: unknown[]) => mockStoreFailure(...args),
  },
  visionFallbackQuota: {
    tryConsume: () => Promise.resolve(true),
  },
  checkModelVisionSupport: (...args: unknown[]) => mockCheckModelVisionSupport(...args),
}));

// Import the mocked modules
import { describeImage } from '../services/MultimodalProcessor.js';
import { withRetry } from '../utils/retry.js';

// Get mocked functions
const mockDescribeImage = vi.mocked(describeImage);
const mockWithRetry = vi.mocked(withRetry);

describe('ImageDescriptionJob', () => {
  const mockPersonality: LoadedPersonality = {
    id: 'test-personality',
    name: 'Test',
    displayName: 'Test Personality',
    slug: 'test',
    ownerId: 'owner-uuid-test',
    systemPrompt: 'Test prompt',
    model: 'gpt-4-vision-preview',
    provider: 'openrouter',
    visionModel: 'gpt-4-vision-preview',
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 100000,
    characterInfo: 'Test character',
    personalityTraits: 'Helpful',
    voiceEnabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: describeImage returns mock description
    mockDescribeImage.mockResolvedValue('Mocked image description');

    // Default: withRetry calls the function and returns successful result
    mockWithRetry.mockImplementation(async fn => {
      const value = await fn();
      return {
        value,
        attempts: 1,
        totalTimeMs: 2000,
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processImageDescriptionJob', () => {
    it('should successfully describe single image', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
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
        id: 'image-test-req-image',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      const result = await processImageDescriptionJob(job);

      expect(result).toEqual({
        requestId: 'test-req-image',
        success: true,
        descriptions: [
          {
            url: 'https://example.com/image1.png',
            description: 'Mocked image description',
          },
        ],
        metadata: {
          processingTimeMs: expect.any(Number),
          imageCount: 1,
          failedCount: 0,
        },
      });

      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxAttempts: VISION_MAX_ATTEMPTS,
          globalTimeoutMs: TIMEOUTS.VISION_MODEL * VISION_MAX_ATTEMPTS,
          operationName: 'Image description (image1.png)',
          shouldRetry: expect.any(Function),
          // Telemetry hook — guards against silent regression of errorCategory
          // enrichment in failure logs.
          getErrorContext: expect.any(Function),
        })
      );
    });

    it('should process multiple images in parallel', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-multi',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
          {
            url: 'https://example.com/image2.jpg',
            name: 'image2.jpg',
            contentType: CONTENT_TYPES.IMAGE_JPG,
            size: 2048,
          },
          {
            url: 'https://example.com/image3.webp',
            name: 'image3.webp',
            contentType: CONTENT_TYPES.IMAGE_WEBP,
            size: 1536,
          },
        ],
        personality: mockPersonality,
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
        id: 'image-test-req-image-multi',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // Return different descriptions for each image
      let callCount = 0;
      mockWithRetry.mockImplementation(async fn => {
        await fn();
        callCount++;
        return {
          value: `Description ${callCount}`,
          attempts: 1,
          totalTimeMs: 2000,
        };
      });

      mockDescribeImage.mockImplementation(async attachment => {
        if (attachment.name === 'image1.png') return 'Description 1';
        if (attachment.name === 'image2.jpg') return 'Description 2';
        if (attachment.name === 'image3.webp') return 'Description 3';
        return 'Unknown';
      });

      const result = await processImageDescriptionJob(job);

      expect(result.success).toBe(true);
      expect(result.descriptions).toHaveLength(3);
      expect(result.descriptions![0].url).toBe('https://example.com/image1.png');
      expect(result.descriptions![1].url).toBe('https://example.com/image2.jpg');
      expect(result.descriptions![2].url).toBe('https://example.com/image3.webp');
      expect(result.metadata!.imageCount).toBe(3);

      // Should call withRetry once per image (parallel processing)
      expect(mockWithRetry).toHaveBeenCalledTimes(3);
    });

    it('should use withRetry wrapper for each image', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-retry',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
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
        id: 'image-test-req-image-retry',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // Simulate retry succeeding on 2nd attempt
      mockWithRetry.mockImplementation(async fn => {
        const result = await fn();
        return {
          value: result,
          attempts: 2,
          totalTimeMs: 4500,
        };
      });

      const result = await processImageDescriptionJob(job);

      expect(result.success).toBe(true);
      expect(result.descriptions![0].description).toBe('Mocked image description');
      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxAttempts: VISION_MAX_ATTEMPTS,
        })
      );
    });

    it('should return failure result when all retries exhausted', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-fail',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/failed.png',
            name: 'failed.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
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
        id: 'image-test-req-image-fail',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // Simulate withRetry failing after all attempts
      mockWithRetry.mockRejectedValue(new Error('Vision model timeout after 3 attempts'));

      const result = await processImageDescriptionJob(job);

      // With graceful degradation, when ALL images fail, we return error with details
      expect(result.requestId).toBe('test-req-image-fail');
      expect(result.success).toBe(false);
      expect(result.error).toContain('All images failed processing');
      expect(result.error).toContain('Details:'); // Enhanced error includes failure details
    });

    it('should reject invalid attachment type (audio instead of image)', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-invalid',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/audio.ogg',
            name: 'audio.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
            size: 2048,
          } as any, // Type mismatch intentional for test
        ],
        personality: mockPersonality,
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
        id: 'image-test-req-image-invalid',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      const result = await processImageDescriptionJob(job);

      expect(result).toMatchObject({
        requestId: 'test-req-image-invalid',
        success: false,
        error: expect.stringContaining('Invalid attachment type'),
        metadata: expect.any(Object),
      });

      // Should NOT call withRetry for invalid input
      expect(mockWithRetry).not.toHaveBeenCalled();
    });

    it('should reject if any attachment is invalid (mixed types)', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-mixed',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
          {
            url: 'https://example.com/audio.ogg',
            name: 'audio.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
            size: 2048,
          } as any, // Invalid
        ],
        personality: mockPersonality,
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
        id: 'image-test-req-image-mixed',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      const result = await processImageDescriptionJob(job);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid attachment type');
      expect(mockWithRetry).not.toHaveBeenCalled();
    });

    it('should handle partial failures in parallel processing', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-partial',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
          {
            url: 'https://example.com/image2.png',
            name: 'image2.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
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
        id: 'image-test-req-image-partial',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // First image succeeds, second fails
      let callCount = 0;
      mockWithRetry.mockImplementation(async fn => {
        callCount++;
        if (callCount === 1) {
          const result = await fn();
          return {
            value: result,
            attempts: 1,
            totalTimeMs: 2000,
          };
        } else {
          throw new Error('Vision model error');
        }
      });

      mockDescribeImage.mockResolvedValue('Success description');

      const result = await processImageDescriptionJob(job);

      // With graceful degradation, job succeeds with partial results
      expect(result.success).toBe(true);
      expect(result.descriptions).toHaveLength(1); // Only successful image
      expect(result.descriptions![0].url).toBe('https://example.com/image1.png');
      expect(result.metadata!.imageCount).toBe(1);
      expect(result.metadata!.failedCount).toBe(1); // Track failures
    });

    it('resolves a genuine guest to the free model on the system key', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-guest-mode',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
        context: {
          userId: 'guest-user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'image-test-req-guest-mode',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // Genuine guest — no user keys for any provider. ImageDescriptionJob has
      // no upstream isGuestMode signal, so resolveVisionConfig is called with
      // isGuestMode=false; a user with no vision-provider key flows through the
      // broad free-fallback branch and gets the free model on the system key.
      // tryResolveUserKey returns null; resolveApiKey returns the system key.
      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn().mockResolvedValue(null),
        resolveApiKey: vi.fn().mockResolvedValue({
          apiKey: 'system-or-key',
          source: 'system',
          provider: AIProvider.OpenRouter,
          isGuestMode: true,
        }),
      } as unknown as ApiKeyResolver;

      await processImageDescriptionJob(job, mockApiKeyResolver);

      // resolveApiKey is called for the free-fallback provider (OpenRouter,
      // where the free gemma model lives).
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledWith(
        'guest-user-123',
        AIProvider.OpenRouter
      );

      expect(mockWithRetry).toHaveBeenCalledTimes(1);
      // describeImage receives the forced free model on the system key. Note
      // isGuestMode is `false` here — the broad-fallback branch preserves the
      // "no keys anywhere" meaning of isGuestMode for the genuine-guest signal,
      // but since the model is passed explicitly, isGuestMode no longer drives
      // model selection in this path.
      const retryFn = mockWithRetry.mock.calls[0][0];
      await retryFn();
      expect(mockDescribeImage).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        mockPersonality,
        false, // isGuestMode — broad-fallback branch sets false; model is forced explicitly
        'system-or-key', // system key
        expect.objectContaining({
          skipNegativeCache: true,
          model: MODEL_DEFAULTS.VISION_FALLBACK_FREE,
          loggingContext: expect.objectContaining({ userId: expect.any(String) }),
        })
      );
    });

    it('should pass isGuestMode=false to describeImage for BYOK users', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-byok-mode',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
        context: {
          userId: 'byok-user-456',
          channelId: 'channel-789',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-789',
        },
      };

      const job = {
        id: 'image-test-req-byok-mode',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // Mock ApiKeyResolver: BYOK user has the vision provider's key.
      // tryResolveUserKey returns the user key on the first call; resolveApiKey
      // is NOT called for authenticated users with the right key.
      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn().mockResolvedValue('sk-user-provided-key'),
        resolveApiKey: vi
          .fn()
          .mockRejectedValue(
            new Error('resolveApiKey should not be called — fail-fast bypass expected')
          ),
      } as unknown as ApiKeyResolver;

      await processImageDescriptionJob(job, mockApiKeyResolver);

      // Verify tryResolveUserKey was called for the vision provider (OpenRouter).
      // The authenticated path doesn't fall through to resolveApiKey.
      expect(mockApiKeyResolver.tryResolveUserKey).toHaveBeenCalledWith(
        'byok-user-456',
        AIProvider.OpenRouter
      );
      expect(mockApiKeyResolver.resolveApiKey).not.toHaveBeenCalled();

      // Execute the retry function to verify describeImage receives correct params
      const retryFn = mockWithRetry.mock.calls[0][0];
      await retryFn();
      expect(mockDescribeImage).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        mockPersonality,
        false, // isGuestMode
        'sk-user-provided-key', // userApiKey (BYOK users get their key passed)
        expect.objectContaining({
          skipNegativeCache: true,
          loggingContext: expect.objectContaining({
            userId: 'byok-user-456',
            apiKeySource: 'user',
          }),
        })
      );
    });

    it('routes to ZaiCoding when personality.visionModel is a glm-* z.ai model', async () => {
      // Regression test: pre-fix, resolveVisionApiKey hardcoded
      // AIProvider.OpenRouter — a personality with z.ai vision would
      // mistakenly look up the user's OpenRouter key instead of their
      // z.ai key. Now provider is detected from the visionModel name.
      const zaiVisionPersonality = { ...mockPersonality, visionModel: 'glm-5v' };
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-zai-vision',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: zaiVisionPersonality,
        context: { userId: 'user-zai', channelId: 'channel-1' },
        responseDestination: { type: 'discord', channelId: 'channel-1' },
      };
      const job = { id: 'image-zai', data: jobData } as Job<ImageDescriptionJobData>;
      // Authenticated user has the z.ai key for the vision provider.
      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn().mockResolvedValue('zai-key'),
        resolveApiKey: vi
          .fn()
          .mockRejectedValue(
            new Error('resolveApiKey should not be called — fail-fast bypass expected')
          ),
      } as unknown as ApiKeyResolver;

      await processImageDescriptionJob(job, mockApiKeyResolver);

      // tryResolveUserKey is called for the detected vision provider (ZaiCoding).
      // The hardcoded-OpenRouter regression would have failed this assertion.
      expect(mockApiKeyResolver.tryResolveUserKey).toHaveBeenCalledWith(
        'user-zai',
        AIProvider.ZaiCoding
      );
    });

    it('detects vision provider from the fallback model when visionModel and main both lack vision', async () => {
      // With no visionModel override and a main model (glm-5.1) that has no
      // native vision support, `selectVisionModel` falls through to the paid
      // OpenRouter fallback model. The unified `resolveVisionConfig` detects the
      // provider from THAT model (OpenRouter), fixing the old ImageDescriptionJob
      // bug where the provider was detected from the main model name (ZaiCoding).
      const noOverridePersonality = {
        ...mockPersonality,
        visionModel: '',
        model: 'glm-5.1',
      };
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-fallback',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: noOverridePersonality,
        context: { userId: 'user-fallback', channelId: 'channel-1' },
        responseDestination: { type: 'discord', channelId: 'channel-1' },
      };
      const job = { id: 'image-fb', data: jobData } as Job<ImageDescriptionJobData>;
      // main has no native vision → selectVisionModel falls to the paid
      // OpenRouter fallback model.
      mockCheckModelVisionSupport.mockResolvedValue(false);
      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn().mockResolvedValue('or-user-key'),
        resolveApiKey: vi.fn(),
      } as unknown as ApiKeyResolver;

      await processImageDescriptionJob(job, mockApiKeyResolver);

      // Provider detected from the fallback model (OpenRouter), NOT the main
      // model's ZaiCoding — this is the bug the unified resolver fixes.
      expect(mockApiKeyResolver.tryResolveUserKey).toHaveBeenCalledWith(
        'user-fallback',
        AIProvider.OpenRouter
      );
    });

    it('downgrades authenticated user without vision-provider key to free model on system key', async () => {
      // BROAD FREE FALLBACK: an authenticated user (has SOME user key) but no
      // key for the personality's vision provider no longer fails fast — they
      // downgrade to the free vision model on the system OpenRouter key.
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-free-fallback',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        // visionModel is a z.ai model → vision provider is ZaiCoding, which the
        // user lacks a key for.
        personality: { ...mockPersonality, visionModel: 'glm-5v' },
        context: { userId: 'auth-user-no-zai-key', channelId: 'channel-1' },
        responseDestination: { type: 'discord', channelId: 'channel-1' },
      };
      const job = {
        id: 'image-free-fallback',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // No user key for the ZaiCoding vision provider; resolveApiKey for the
      // FREE provider (OpenRouter) returns the system key.
      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn().mockResolvedValue(null),
        resolveApiKey: vi.fn().mockResolvedValue({
          apiKey: 'system-or-key',
          source: 'system',
          provider: AIProvider.OpenRouter,
          isGuestMode: true,
          userId: 'auth-user-no-zai-key',
        }),
      } as unknown as ApiKeyResolver;

      const result = await processImageDescriptionJob(job, mockApiKeyResolver);

      // resolveApiKey IS called now (for the free provider) — no fail-fast.
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledWith(
        'auth-user-no-zai-key',
        AIProvider.OpenRouter
      );
      // The vision call runs (not short-circuited) and succeeds.
      expect(result.success).toBe(true);
      expect(result.descriptions).toHaveLength(1);
      expect(mockWithRetry).toHaveBeenCalled();

      // describeImage receives the forced free model + system key, isGuestMode=false.
      const retryFn = mockWithRetry.mock.calls[0][0];
      await retryFn();
      expect(mockDescribeImage).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        expect.anything(),
        false, // isGuestMode — they ARE authenticated, only the vision model is downgraded
        'system-or-key', // system key
        expect.objectContaining({
          model: MODEL_DEFAULTS.VISION_FALLBACK_FREE, // forced free model
          provider: AIProvider.OpenRouter,
          loggingContext: expect.objectContaining({ apiKeySource: 'system' }),
        })
      );
    });

    it('fails fast when the free-model system fallback is also unavailable', async () => {
      // Fallback-of-fallback: authenticated user lacks the vision-provider key
      // AND no system OpenRouter key is configured (resolveApiKey throws). The
      // job emits the "configure your key" placeholder against the original
      // vision provider.
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-fail-fast',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality, // visionModel='gpt-4-vision-preview' → OpenRouter
        context: { userId: 'auth-user-no-keys-at-all', channelId: 'channel-1' },
        responseDestination: { type: 'discord', channelId: 'channel-1' },
      };
      const job = {
        id: 'image-failfast',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn().mockResolvedValue(null),
        // No system OpenRouter key configured → resolveApiKey throws.
        resolveApiKey: vi
          .fn()
          .mockRejectedValue(new Error('No API key available for provider openrouter')),
      } as unknown as ApiKeyResolver;

      const result = await processImageDescriptionJob(job, mockApiKeyResolver);

      // Each image gets the source-aware fallback description.
      expect(result.success).toBe(true);
      expect(result.descriptions).toHaveLength(1);
      expect(result.descriptions?.[0]?.description).toContain('check /settings apikey set');
      // describeImage / withRetry NOT invoked — the short-circuit fired before
      // any vision call.
      expect(mockWithRetry).not.toHaveBeenCalled();
      expect(mockDescribeImage).not.toHaveBeenCalled();
    });

    it('fails fast (graceful degrade) when ApiKeyResolver throws transiently', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-resolver-fail',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
        context: {
          userId: 'user-error',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'image-test-req-resolver-fail',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // tryResolveUserKey throws → resolveVisionConfig's try/catch returns
      // failFast (graceful degrade to the "configure your key" placeholder).
      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn().mockRejectedValue(new Error('Database connection failed')),
        resolveApiKey: vi.fn(),
      } as unknown as ApiKeyResolver;

      const result = await processImageDescriptionJob(job, mockApiKeyResolver);

      expect(result.success).toBe(true);
      expect(result.descriptions?.[0]?.description).toContain('check /settings apikey set');
      expect(mockWithRetry).not.toHaveBeenCalled();
      expect(mockDescribeImage).not.toHaveBeenCalled();
    });

    it('should pass skipNegativeCache: true to describeImage within retry loop', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-skip-cache',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
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
        id: 'image-test-req-skip-cache',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      await processImageDescriptionJob(job);

      // Execute the retry function to verify describeImage receives skipNegativeCache
      const retryFn = mockWithRetry.mock.calls[0][0];
      await retryFn();
      expect(mockDescribeImage).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        mockPersonality,
        false,
        undefined,
        expect.objectContaining({
          skipNegativeCache: true,
          loggingContext: expect.objectContaining({ jobId: 'image-test-req-skip-cache' }),
        })
      );
    });

    it('should pass globalTimeoutMs to withRetry', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-timeout',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
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
        id: 'image-test-req-timeout',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      await processImageDescriptionJob(job);

      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          globalTimeoutMs: TIMEOUTS.VISION_MODEL * VISION_MAX_ATTEMPTS,
        })
      );
    });
  });
});
