/**
 * Tests for processCrossProviderVisionImages
 *
 * Covers the cross-provider vision path extracted from DependencyStep:
 * - authenticated user with vision-provider key → processAttachments runs
 * - broad free fallback (no vision key, system key available) → free model
 * - fail-fast (free-model system key unavailable) → synthetic-failure entries
 * - transient resolver throw → fail-fast placeholder
 * - processAttachments throw → empty array (graceful degrade)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AIProvider,
  AttachmentType,
  MODEL_DEFAULTS,
  type LoadedPersonality,
  type AttachmentMetadata,
} from '@tzurot/common-types';
import { processCrossProviderVisionImages } from './extendedContextVisionProcessor.js';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import type { GenerationContext } from '../types.js';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

// resolveVisionConfig (real) calls selectVisionModel → checkModelVisionSupport
// and buildVisionAuthFailureResults → visionDescriptionCache. Stub redis.js so
// neither reaches a live client. The CROSS_PROVIDER personality sets a
// visionModel override, so selectVisionModel returns it without consulting
// checkModelVisionSupport — but stub it for safety.
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
  it('processes with the user key when authenticated user has the vision-provider key', async () => {
    const resolver = {
      tryResolveUserKey: vi.fn().mockResolvedValue('user-or-key'),
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

    expect(mockProcessAttachments).toHaveBeenCalledWith(
      [expect.objectContaining({ url: IMAGE.url })],
      CROSS_PROVIDER_PERSONALITY,
      expect.objectContaining({
        userApiKey: 'user-or-key',
        visionProvider: AIProvider.OpenRouter,
        model: 'qwen/qwen3.5-397b-a17b',
      })
    );
    expect(result).toHaveLength(1);
  });

  it('downgrades to the free model on the system key when user lacks the vision-provider key', async () => {
    const resolver = {
      tryResolveUserKey: vi.fn().mockResolvedValue(null),
      resolveApiKey: vi.fn().mockResolvedValue({
        apiKey: 'system-or-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        isGuestMode: true,
        userId: 'user-1',
      }),
    } as unknown as ApiKeyResolver;
    mockProcessAttachments.mockResolvedValueOnce([]);

    await processCrossProviderVisionImages(buildOpts(resolver));

    expect(mockProcessAttachments).toHaveBeenCalledWith(
      expect.any(Array),
      CROSS_PROVIDER_PERSONALITY,
      expect.objectContaining({
        isGuestMode: false,
        userApiKey: 'system-or-key',
        model: MODEL_DEFAULTS.VISION_FALLBACK_FREE,
        visionProvider: AIProvider.OpenRouter,
      })
    );
  });

  it('returns fail-fast placeholder when the free-model system fallback is unavailable', async () => {
    const resolver = {
      tryResolveUserKey: vi.fn().mockResolvedValue(null),
      resolveApiKey: vi.fn().mockRejectedValue(new Error('No API key available')),
    } as unknown as ApiKeyResolver;

    const result = await processCrossProviderVisionImages(buildOpts(resolver));

    expect(mockProcessAttachments).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toContain('check /settings apikey set');
  });

  it('returns fail-fast placeholder when the resolver throws transiently', async () => {
    const resolver = {
      tryResolveUserKey: vi.fn().mockRejectedValue(new Error('Redis blip')),
      resolveApiKey: vi.fn(),
    } as unknown as ApiKeyResolver;

    const result = await processCrossProviderVisionImages(buildOpts(resolver));

    expect(mockProcessAttachments).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toContain('check /settings apikey set');
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
