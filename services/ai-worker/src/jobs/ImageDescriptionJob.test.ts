/**
 * Tests for Image Description Job Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  processImageDescriptionJob,
  USER_AUTH_PROBE_PROVIDERS,
  NON_LLM_PROVIDERS,
} from './ImageDescriptionJob.js';
import type { Job } from 'bullmq';
import type { ImageDescriptionJobData, LoadedPersonality } from '@tzurot/common-types';
import { JobType, CONTENT_TYPES, AIProvider, TIMEOUTS } from '@tzurot/common-types';

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
const mockStoreFailure = vi.fn();
vi.mock('../redis.js', () => ({
  visionDescriptionCache: {
    storeFailure: (...args: unknown[]) => mockStoreFailure(...args),
  },
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

    it('should pass isGuestMode=true to describeImage for guest users', async () => {
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

      // Mock ApiKeyResolver: genuine guest — no user keys for any provider.
      // tryResolveUserKey returns null for both probe providers, then
      // resolveApiKey returns the system key with isGuestMode: true.
      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn().mockResolvedValue(null),
        resolveApiKey: vi.fn().mockResolvedValue({
          apiKey: null,
          source: 'fallback',
          isGuestMode: true,
        }),
      } as unknown as ApiKeyResolver;

      await processImageDescriptionJob(job, mockApiKeyResolver);

      // Verify resolveApiKey was called with the detected vision provider
      // (OpenRouter, since mockPersonality.visionModel='gpt-4-vision-preview').
      // Only fires for the guest path — auth check happens via tryResolveUserKey.
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledWith(
        'guest-user-123',
        AIProvider.OpenRouter
      );

      // Verify describeImage was called with isGuestMode=true
      // describeImage is called inside withRetry, so check the mockWithRetry call
      expect(mockWithRetry).toHaveBeenCalledTimes(1);
      // Execute the retry function to verify describeImage receives correct params
      const retryFn = mockWithRetry.mock.calls[0][0];
      await retryFn();
      expect(mockDescribeImage).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        mockPersonality,
        true, // isGuestMode
        undefined, // userApiKey (guests don't have one)
        expect.objectContaining({
          skipNegativeCache: true,
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

    it('falls back to main model when visionModel is empty and main is a glm-* z.ai model', async () => {
      // The visionModel→main fallback chain mirrors selectVisionModel's logic:
      // when no explicit override, we use the main model name to detect the
      // vision provider (since the main model would also be used for vision
      // if it has native support). Schema validation rejects null on this
      // job-data field, so we use the empty-string sentinel which the
      // resolveVisionApiKey fallback also accepts.
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
      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn().mockResolvedValue('zai-key'),
        resolveApiKey: vi
          .fn()
          .mockRejectedValue(
            new Error('resolveApiKey should not be called — fail-fast bypass expected')
          ),
      } as unknown as ApiKeyResolver;

      await processImageDescriptionJob(job, mockApiKeyResolver);

      // Provider detected from main model (visionModel was empty); user has
      // the ZaiCoding key, so tryResolveUserKey returns it.
      expect(mockApiKeyResolver.tryResolveUserKey).toHaveBeenCalledWith(
        'user-fallback',
        AIProvider.ZaiCoding
      );
    });

    it('fails fast when authenticated user lacks key for vision provider (matches DependencyStep policy)', async () => {
      // Regression for the asymmetry the round-10 reviewer flagged: an
      // authenticated user (has SOME user key) but no key for the personality's
      // vision provider must NOT silently fall back to the system key here —
      // they should get the same "configure your key" fallback that
      // DependencyStep produces via buildVisionAuthFailureResults.
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
        context: { userId: 'auth-user-no-or-key', channelId: 'channel-1' },
        responseDestination: { type: 'discord', channelId: 'channel-1' },
      };
      const job = {
        id: 'image-failfast',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // tryResolveUserKey returns null for OpenRouter (vision provider) but
      // returns a user key for ZaiCoding — i.e., user IS authenticated, just
      // not for the vision provider.
      const tryResolveUserKey = vi
        .fn()
        .mockImplementation(async (_userId: string, provider: AIProvider) =>
          provider === AIProvider.ZaiCoding ? 'zai-user-key' : null
        );
      const mockApiKeyResolver = {
        tryResolveUserKey,
        resolveApiKey: vi
          .fn()
          .mockRejectedValue(
            new Error('resolveApiKey should not be called — fail-fast bypass expected')
          ),
      } as unknown as ApiKeyResolver;

      const result = await processImageDescriptionJob(job, mockApiKeyResolver);

      // resolveApiKey is NOT called — fail-fast bypasses the system fallback
      // entirely for authenticated users without the vision-provider key.
      expect(mockApiKeyResolver.resolveApiKey).not.toHaveBeenCalled();
      // Each image gets the source-aware fallback description.
      expect(result.success).toBe(true);
      expect(result.descriptions).toHaveLength(1);
      expect(result.descriptions?.[0]?.description).toContain('check /wallet');
      // describeImage / withRetry NOT invoked — the short-circuit fired before
      // any vision call.
      expect(mockWithRetry).not.toHaveBeenCalled();
      expect(mockDescribeImage).not.toHaveBeenCalled();
    });

    it('should default to guest mode when ApiKeyResolver fails', async () => {
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

      // Mock ApiKeyResolver throwing an error
      const mockApiKeyResolver = {
        resolveApiKey: vi.fn().mockRejectedValue(new Error('Database connection failed')),
      } as unknown as ApiKeyResolver;

      await processImageDescriptionJob(job, mockApiKeyResolver);

      // Execute the retry function to verify describeImage receives isGuestMode=true (fallback)
      const retryFn = mockWithRetry.mock.calls[0][0];
      await retryFn();
      expect(mockDescribeImage).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        mockPersonality,
        true, // isGuestMode defaults to true on error
        undefined, // userApiKey is undefined on error (no key resolved)
        expect.objectContaining({
          skipNegativeCache: true,
          loggingContext: expect.objectContaining({ userId: 'user-error' }),
        })
      );
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

describe('USER_AUTH_PROBE_PROVIDERS', () => {
  it('excludes every provider tagged in NON_LLM_PROVIDERS', () => {
    // Locks in the contract that drove the refactor: NON_LLM_PROVIDERS is the
    // single source of truth for "which providers should NOT make a user
    // count as LLM-authenticated." If a future contributor removes a tag
    // from NON_LLM_PROVIDERS without intending to, this test fires.
    for (const nonLlm of NON_LLM_PROVIDERS) {
      expect(USER_AUTH_PROBE_PROVIDERS).not.toContain(nonLlm);
    }
  });

  it('includes every AIProvider variant that is not in NON_LLM_PROVIDERS', () => {
    // The inverse: a new LLM provider added to AIProvider must auto-include
    // in the probe list. If someone refactors USER_AUTH_PROBE_PROVIDERS back
    // to a hardcoded array and forgets to update it when a new provider lands,
    // this test fires.
    const nonLlmSet = new Set<AIProvider>(NON_LLM_PROVIDERS);
    const expected = Object.values(AIProvider).filter(p => !nonLlmSet.has(p));
    expect([...USER_AUTH_PROBE_PROVIDERS].sort()).toEqual([...expected].sort());
  });

  it('currently includes OpenRouter and ZaiCoding, excludes ElevenLabs', () => {
    // Snapshot of the current concrete state — supplements the structural
    // assertions above with a value-level check so a reader of the test file
    // can see at a glance which providers are in scope today.
    expect(USER_AUTH_PROBE_PROVIDERS).toContain(AIProvider.OpenRouter);
    expect(USER_AUTH_PROBE_PROVIDERS).toContain(AIProvider.ZaiCoding);
    expect(USER_AUTH_PROBE_PROVIDERS).not.toContain(AIProvider.ElevenLabs);
  });
});
