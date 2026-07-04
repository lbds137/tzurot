/**
 * Tests for Image Description Job Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processImageDescriptionJob } from './ImageDescriptionJob.js';
import type { Job } from 'bullmq';
import type { ImageDescriptionJobData } from '@tzurot/common-types/types/jobs';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { JobType } from '@tzurot/common-types/constants/queue';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';

// Mirrors the module-level constant in ImageDescriptionJob.ts. Intentionally
// kept as a copy so the test asserts the expected *contract* (vision uses 2
// attempts) rather than coupling to the implementation's internal name.
const VISION_MAX_ATTEMPTS = 2;
import type { ApiKeyResolver } from '../services/ApiKeyResolver.js';

// Mock describeImage, withRetry, and shouldRetryError
vi.mock('../services/MultimodalProcessor.js', () => ({
  describeImage: vi.fn(),
}));

// Phase-4: with an apiKeyResolver present, the job routes to describeImageWithFallback
// (the vision fallback loop) instead of the single-model describeImage under withRetry.
// The loop's per-tier auth resolution (guest/BYOK/downgrade/fail-fast) is covered by
// describeImageWithFallback.test.ts + visionAuthResolver.test.ts, so mock it here and
// assert only that the job forwards the correct visionAuth INPUTS bundle and that the
// wrapper's returned description flows into the job result.
vi.mock('../services/multimodal/describeImageWithFallback.js', () => ({
  describeImageWithFallback: vi.fn(),
}));

vi.mock('../utils/retry.js', () => ({
  withRetry: vi.fn(),
}));

vi.mock('../utils/apiErrorParser.js', () => ({
  shouldRetryError: vi.fn((_error: unknown) => true),
  getErrorLogContext: vi.fn((_error: unknown) => ({})),
}));

// Stub redis.js so nothing on the legacy no-resolver path (which reaches the real
// `describeImage` → `selectVisionModel`) hits a real Redis client at test time.
// `checkModelVisionSupport` is reached transitively via selectVisionModel — default
// it to false so the no-visionModel-override legacy test falls through to the
// fallback model. Thunks defer reference resolution past hoisting. (The
// resolver-present tests mock describeImageWithFallback, so they never reach here.)
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
import { describeImageWithFallback } from '../services/multimodal/describeImageWithFallback.js';

// Get mocked functions
const mockDescribeImage = vi.mocked(describeImage);
const mockWithRetry = vi.mocked(withRetry);
const mockDescribeImageWithFallback = vi.mocked(describeImageWithFallback);

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

    // Default: the fallback loop (resolver-present path) returns a description.
    mockDescribeImageWithFallback.mockResolvedValue('Fallback loop description');

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

    it('routes to describeImageWithFallback with the guest userId in the visionAuth bundle', async () => {
      // Phase-4: with a resolver present, the job hands the auth INPUTS to the
      // fallback loop. The genuine-guest → free-model-on-system-key resolution now
      // lives inside the loop (covered by describeImageWithFallback.test.ts +
      // visionAuthResolver.test.ts); here we assert only that the bundle is forwarded.
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

      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn(),
        resolveApiKey: vi.fn(),
      } as unknown as ApiKeyResolver;

      const result = await processImageDescriptionJob(job, mockApiKeyResolver);

      // The single-model path (describeImage under withRetry) is NOT used when a
      // resolver is present — the fallback loop owns the call.
      expect(mockWithRetry).not.toHaveBeenCalled();
      expect(mockDescribeImage).not.toHaveBeenCalled();
      expect(mockDescribeImageWithFallback).toHaveBeenCalledTimes(1);
      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        mockPersonality,
        expect.objectContaining({
          personality: mockPersonality,
          mainProvider: undefined,
          mainApiKey: undefined,
          isGuestMode: false,
          userId: 'guest-user-123',
          apiKeyResolver: mockApiKeyResolver,
        }),
        expect.objectContaining({
          loggingContext: expect.objectContaining({ userId: 'guest-user-123' }),
        })
      );

      // The wrapper's returned description flows into the job result.
      expect(result.success).toBe(true);
      expect(result.descriptions).toEqual([
        { url: 'https://example.com/image1.png', description: 'Fallback loop description' },
      ]);
    });

    it('routes BYOK users to describeImageWithFallback with the auth INPUTS bundle', async () => {
      // Phase-4: the BYOK "use the user key on the vision provider" decision moved
      // into the loop's per-tier resolveVisionAuth. The job just forwards the inputs.
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

      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn(),
        resolveApiKey: vi.fn(),
      } as unknown as ApiKeyResolver;
      mockDescribeImageWithFallback.mockResolvedValue('BYOK description');

      const result = await processImageDescriptionJob(job, mockApiKeyResolver);

      expect(mockDescribeImageWithFallback).toHaveBeenCalledTimes(1);
      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        mockPersonality,
        expect.objectContaining({
          userId: 'byok-user-456',
          isGuestMode: false,
          apiKeyResolver: mockApiKeyResolver,
        }),
        expect.objectContaining({
          loggingContext: expect.objectContaining({ userId: 'byok-user-456' }),
        })
      );
      // Legacy single-model path is not taken.
      expect(mockDescribeImage).not.toHaveBeenCalled();
      expect(result.descriptions).toEqual([
        { url: 'https://example.com/image1.png', description: 'BYOK description' },
      ]);
    });

    it('passes a z.ai-vision personality through to describeImageWithFallback untouched', async () => {
      // Phase-4: provider detection from the visionModel name moved into the loop's
      // per-tier resolveVisionAuth (covered by describeImageWithFallback.test.ts +
      // visionAuthResolver.test.ts). The job's contract is that it forwards the
      // personality — which carries the z.ai `visionModel` that drives detection —
      // to the loop unmodified, rather than pre-detecting the provider itself.
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
      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn(),
        resolveApiKey: vi.fn(),
      } as unknown as ApiKeyResolver;

      await processImageDescriptionJob(job, mockApiKeyResolver);

      // The personality (with visionModel='glm-5v') is forwarded both as the
      // top-level argument and inside the visionAuth bundle, so the loop can detect
      // the ZaiCoding provider itself.
      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        zaiVisionPersonality,
        expect.objectContaining({
          personality: zaiVisionPersonality,
          userId: 'user-zai',
          apiKeyResolver: mockApiKeyResolver,
        }),
        expect.anything()
      );
    });

    it('passes a no-override personality through to describeImageWithFallback for loop-side fallback detection', async () => {
      // With no visionModel override, the loop composes its own tiers and detects the
      // provider from the resolved fallback model — that logic lives in the loop, not
      // the job. Here we assert only that the job forwards the personality + inputs.
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
        tryResolveUserKey: vi.fn(),
        resolveApiKey: vi.fn(),
      } as unknown as ApiKeyResolver;

      await processImageDescriptionJob(job, mockApiKeyResolver);

      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        noOverridePersonality,
        expect.objectContaining({
          personality: noOverridePersonality,
          userId: 'user-fallback',
          apiKeyResolver: mockApiKeyResolver,
        }),
        expect.anything()
      );
    });

    it('forwards a downgrade-eligible user to describeImageWithFallback (loop owns the downgrade)', async () => {
      // Phase-4: the broad-free-fallback downgrade (authenticated user lacking the
      // vision-provider key → free model on the system key) is a per-tier decision
      // inside the loop's resolveVisionAuth, covered by describeImageWithFallback.test.ts
      // + visionAuthResolver.test.ts. The job just forwards the inputs bundle and
      // surfaces whatever the loop returns.
      const downgradePersonality = { ...mockPersonality, visionModel: 'glm-5v' };
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
        // user lacks a key for; the loop downgrades internally.
        personality: downgradePersonality,
        context: { userId: 'auth-user-no-zai-key', channelId: 'channel-1' },
        responseDestination: { type: 'discord', channelId: 'channel-1' },
      };
      const job = {
        id: 'image-free-fallback',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn(),
        resolveApiKey: vi.fn(),
      } as unknown as ApiKeyResolver;
      mockDescribeImageWithFallback.mockResolvedValue('Downgraded free-model description');

      const result = await processImageDescriptionJob(job, mockApiKeyResolver);

      // The loop is invoked with the raw inputs bundle carrying the resolver + userId;
      // the personality (with its z.ai visionModel) is passed through untouched so the
      // loop can compose + downgrade its own tiers.
      expect(mockDescribeImageWithFallback).toHaveBeenCalledTimes(1);
      expect(mockDescribeImageWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/image1.png' }),
        downgradePersonality,
        expect.objectContaining({
          personality: downgradePersonality,
          userId: 'auth-user-no-zai-key',
          isGuestMode: false,
          apiKeyResolver: mockApiKeyResolver,
        }),
        expect.objectContaining({
          loggingContext: expect.objectContaining({ userId: 'auth-user-no-zai-key' }),
        })
      );
      // The legacy single-model path is not taken.
      expect(mockWithRetry).not.toHaveBeenCalled();
      expect(mockDescribeImage).not.toHaveBeenCalled();

      // The loop's returned description flows into the job result.
      expect(result.success).toBe(true);
      expect(result.descriptions).toEqual([
        { url: 'https://example.com/image1.png', description: 'Downgraded free-model description' },
      ]);
    });

    it('flows the wrapper’s auth-exhaustion placeholder into the job result as a description', async () => {
      // Phase-4: the removed job-level buildFailFastResult short-circuit moved into
      // the loop — describeImageWithFallback renders the "configure your key"
      // placeholder on auth-exhaustion (covered by describeImageWithFallback.test.ts).
      // At the job boundary, that placeholder string is a valid description and must
      // flow into the result. Mock the wrapper returning the placeholder and assert
      // it lands as a successful description.
      const placeholder =
        '[Image unavailable: your API key was rejected — check /settings apikey set for the vision provider key]';
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
        personality: mockPersonality,
        context: { userId: 'auth-user-no-keys-at-all', channelId: 'channel-1' },
        responseDestination: { type: 'discord', channelId: 'channel-1' },
      };
      const job = {
        id: 'image-failfast',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn(),
        resolveApiKey: vi.fn(),
      } as unknown as ApiKeyResolver;
      mockDescribeImageWithFallback.mockResolvedValue(placeholder);

      const result = await processImageDescriptionJob(job, mockApiKeyResolver);

      // The loop was invoked and its placeholder became the image's description.
      expect(mockDescribeImageWithFallback).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.descriptions).toHaveLength(1);
      expect(result.descriptions?.[0]?.description).toContain('check /settings apikey set');
      // The legacy single-model path is not taken when a resolver is present.
      expect(mockWithRetry).not.toHaveBeenCalled();
      expect(mockDescribeImage).not.toHaveBeenCalled();
    });

    it('does not throw when the wrapper degrades transiently (placeholder flows through)', async () => {
      // A transient resolver failure used to be caught by the job's fail-fast branch;
      // it's now caught inside the loop (never throws, returns a placeholder). The job
      // just surfaces whatever the loop returns.
      const placeholder =
        '[Image unavailable: your API key was rejected — check /settings apikey set for the vision provider key]';
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

      const mockApiKeyResolver = {
        tryResolveUserKey: vi.fn(),
        resolveApiKey: vi.fn(),
      } as unknown as ApiKeyResolver;
      mockDescribeImageWithFallback.mockResolvedValue(placeholder);

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
