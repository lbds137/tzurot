/**
 * Tests for processCrossProviderVisionImages
 *
 * Phase-4: this unit no longer resolves auth itself. It forwards the auth INPUTS
 * bundle (`visionAuth`) to the injected `processAttachments`, which drives the
 * real `describeImageWithFallback` loop deep inside. So these tests cover:
 * - the `visionAuth` bundle is forwarded with the correct fields
 * - the bundle is forwarded regardless of resolver behavior (fail-fast/auth
 *   resolution is the wrapper's job, covered by describeImageWithFallback.test.ts
 *   and visionAuthResolver.test.ts)
 * - processAttachments throw → empty array (graceful degrade, outer try/catch)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { processCrossProviderVisionImages } from './extendedContextVisionProcessor.js';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import type { GenerationContext } from '../types.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// `processAttachments` is mocked here, so this unit never reaches the real vision
// pipeline (VisionProcessor / describeImageWithFallback). Stub redis.js anyway so
// nothing transitively imported can reach a live client during module load.
const mockStoreFailure = vi.fn();
vi.mock('../../../../redis.js', () => ({
  visionDescriptionCache: {
    storeFailure: (...args: unknown[]) => mockStoreFailure(...args),
  },
  visionFallbackQuota: {
    tryConsume: () => Promise.resolve(true),
  },
  checkModelVisionSupport: vi.fn().mockResolvedValue(false),
}));

const CROSS_PROVIDER_PERSONALITY = {
  id: 'pers-1',
  ownerId: 'owner-1',
  name: 'TestPersona',
  slug: 'test',
  model: 'glm-5.1', // → ZaiCoding
  visionModel: 'qwen/qwen3.5-397b-a17b', // → OpenRouter
  systemPrompt: '',
  temperature: 0.7,
} as unknown as LoadedPersonality;

const IMAGE: AttachmentMetadata = {
  id: 'att-1',
  url: 'https://example.com/cp.jpg',
  name: 'cp.jpg',
  contentType: 'image/jpeg',
  size: 1024,
} as AttachmentMetadata;

const mockProcessAttachments = vi.fn();

function buildOpts(resolver: ApiKeyResolver) {
  return {
    imageAttachments: [IMAGE],
    personality: CROSS_PROVIDER_PERSONALITY as GenerationContext['job']['data']['personality'],
    jobId: 'job-1',
    userId: 'user-1',
    isGuestMode: false,
    userApiKey: 'user-zai-key',
    sttDispatch: undefined,
    mainProvider: AIProvider.ZaiCoding,
    apiKeyResolver: resolver,
    processAttachments: mockProcessAttachments,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processCrossProviderVisionImages', () => {
  it('forwards the visionAuth INPUTS bundle to processAttachments', async () => {
    const resolver = {
      tryResolveUserKey: vi.fn(),
      resolveApiKey: vi.fn(),
    } as unknown as ApiKeyResolver;
    mockProcessAttachments.mockResolvedValueOnce([
      {
        type: AttachmentType.Image,
        description: 'ok',
        originalUrl: IMAGE.url,
        metadata: IMAGE,
      },
    ]);

    const result = await processCrossProviderVisionImages(buildOpts(resolver));

    // Auth is no longer pre-resolved here — the raw INPUTS bundle is forwarded and
    // the real describeImageWithFallback loop (mocked away via processAttachments)
    // resolves per-tier auth. Assert the bundle carries the correct fields.
    expect(mockProcessAttachments).toHaveBeenCalledWith(
      [expect.objectContaining({ url: IMAGE.url })],
      CROSS_PROVIDER_PERSONALITY,
      expect.objectContaining({
        isGuestMode: false,
        sttDispatch: undefined,
        loggingContext: { userId: 'user-1' },
        visionAuth: expect.objectContaining({
          personality: CROSS_PROVIDER_PERSONALITY,
          mainProvider: AIProvider.ZaiCoding,
          mainApiKey: 'user-zai-key',
          isGuestMode: false,
          userId: 'user-1',
          apiKeyResolver: resolver,
        }),
      })
    );
    expect(result).toHaveLength(1);
  });

  it('forwards the visionAuth bundle even when the user has no vision-provider key', async () => {
    // Previously this test drove a resolver-based downgrade branch here. Auth
    // resolution moved into the fallback loop (describeImageWithFallback), so this
    // unit forwards the same bundle regardless — the downgrade decision is the
    // wrapper's, covered by describeImageWithFallback.test.ts + visionAuthResolver.test.ts.
    const resolver = {
      tryResolveUserKey: vi.fn(),
      resolveApiKey: vi.fn(),
    } as unknown as ApiKeyResolver;
    mockProcessAttachments.mockResolvedValueOnce([]);

    await processCrossProviderVisionImages(buildOpts(resolver));

    expect(mockProcessAttachments).toHaveBeenCalledWith(
      expect.any(Array),
      CROSS_PROVIDER_PERSONALITY,
      expect.objectContaining({
        visionAuth: expect.objectContaining({
          mainProvider: AIProvider.ZaiCoding,
          mainApiKey: 'user-zai-key',
          userId: 'user-1',
          apiKeyResolver: resolver,
        }),
      })
    );
  });

  it('still calls processAttachments with the visionAuth bundle (fail-fast is the wrapper’s job)', async () => {
    // The old premise — resolveVisionConfig returning failFast so processAttachments
    // is skipped — no longer holds: resolveVisionConfig is not called in this unit.
    // The auth-exhaustion "configure your key" placeholder is now rendered inside
    // describeImageWithFallback (covered there). Here we only verify the bundle is
    // forwarded unconditionally.
    const resolver = {
      tryResolveUserKey: vi.fn(),
      resolveApiKey: vi.fn(),
    } as unknown as ApiKeyResolver;
    mockProcessAttachments.mockResolvedValueOnce([]);

    await processCrossProviderVisionImages(buildOpts(resolver));

    expect(mockProcessAttachments).toHaveBeenCalledTimes(1);
    expect(mockProcessAttachments).toHaveBeenCalledWith(
      expect.any(Array),
      CROSS_PROVIDER_PERSONALITY,
      expect.objectContaining({
        visionAuth: expect.objectContaining({ apiKeyResolver: resolver, userId: 'user-1' }),
      })
    );
  });

  it('forwards the visionAuth bundle regardless of any resolver-transient concern', async () => {
    // A transient resolver failure used to short-circuit here into a fail-fast
    // placeholder. That resilience now lives in the loop (describeImageWithFallback
    // + resolveVisionAuth), so this unit forwards the inputs bundle either way.
    const resolver = {
      tryResolveUserKey: vi.fn(),
      resolveApiKey: vi.fn(),
    } as unknown as ApiKeyResolver;
    mockProcessAttachments.mockResolvedValueOnce([]);

    await processCrossProviderVisionImages(buildOpts(resolver));

    expect(mockProcessAttachments).toHaveBeenCalledTimes(1);
    expect(mockProcessAttachments).toHaveBeenCalledWith(
      expect.any(Array),
      CROSS_PROVIDER_PERSONALITY,
      expect.objectContaining({
        visionAuth: expect.objectContaining({ apiKeyResolver: resolver, userId: 'user-1' }),
      })
    );
  });

  it('returns empty array when processAttachments itself throws (hard degrade)', async () => {
    const resolver = {
      tryResolveUserKey: vi.fn().mockResolvedValue('user-or-key'),
      resolveApiKey: vi.fn(),
    } as unknown as ApiKeyResolver;
    mockProcessAttachments.mockRejectedValueOnce(new Error('processing exploded'));

    const result = await processCrossProviderVisionImages(buildOpts(resolver));

    expect(result).toEqual([]);
  });
});
