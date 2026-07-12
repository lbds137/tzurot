/**
 * Vision fallback chain — WIRING / seam test.
 *
 * This is a deliberately DIFFERENT test shape from the unit suites around it. The unit
 * tests (`MultimodalProcessor.test.ts`, `describeImageWithFallback.test.ts`, the
 * VisionProcessor tests) each mock one internal seam of the vision path — they mock
 * `describeImageWithFallback`, or `describeImage`, or `resolveVisionAuth`, or
 * `processAttachments`'s collaborators. That gives fast focused coverage of each unit,
 * but it means NO test ever runs the seams JOINED. Two real bugs shipped in exactly those
 * unjoined seams:
 *
 *   1. `visionAuth` was dropped somewhere between `processAttachments` and
 *      `describeImageWithFallback`, so the runtime fallback loop was inert (it fell back to
 *      the single-model `describeImage` and never advanced tiers) — invisible to every unit
 *      test because they mocked the wrapper.
 *   2. The per-tier BYOK key resolution regressed — again invisible because the resolver was
 *      mocked at the seam the loop calls.
 *
 * So this file exercises the REAL chain end-to-end and mocks ONLY the external boundary:
 *
 *   processAttachments → processSingleAttachment → describeImageWithFallback →
 *     walkFallbackChain → resolveVisionAuth (REAL) → runVisionTier → describeImage →
 *       invokeVisionModel → createChatModel (MOCKED — the external boundary)
 *
 * External mocks ONLY:
 *   - `ModelFactory.createChatModel` — the actual model/HTTP boundary. Its `invoke` is the
 *     lever that makes a given tier succeed or fail.
 *   - `../../redis.js` — the cache/quota boundary (get→miss, quota→ok, vision-support→false).
 *   - `apiErrorParser.parseApiError` — driven per-test so error classification (RATE_LIMIT
 *     vs AUTHENTICATION) is deterministic without constructing provider-specific error shapes.
 *   - `apiKeyResolver` — a plain mock object passed INSIDE the `visionAuth` bundle. The
 *     `visionAuthResolver` MODULE is NOT mocked: `resolveVisionAuth` runs for real and calls
 *     this mock, which is exactly where the BYOK-key-resolution regression lived.
 *
 * No internal seam is mocked. In particular `describeImageWithFallback`, `describeImage`,
 * `resolveVisionAuth`, `runVisionTier`, and `composeVisionTiers` all run for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processAttachments } from '../MultimodalProcessor.js';
import type { ResolveVisionConfigOptions } from './visionAuthResolver.js';
import type { ApiKeyResolver } from '../ApiKeyResolver.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { AttachmentType, CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

// vi.hoisted so the mock fns survive vi.clearAllMocks() between tests.
const {
  mockCreateChatModel,
  mockParseApiError,
  mockCheckModelVisionSupport,
  mockVisionCacheGet,
  mockVisionCacheStore,
  mockVisionCacheGetFailure,
  mockVisionCacheStoreFailure,
  mockVisionFallbackQuotaConsume,
} = vi.hoisted(() => ({
  mockCreateChatModel: vi.fn(),
  mockParseApiError: vi.fn(),
  mockCheckModelVisionSupport: vi.fn(),
  mockVisionCacheGet: vi.fn(),
  mockVisionCacheStore: vi.fn(),
  mockVisionCacheGetFailure: vi.fn(),
  mockVisionCacheStoreFailure: vi.fn(),
  mockVisionFallbackQuotaConsume: vi.fn(),
}));

// EXTERNAL BOUNDARY: the model/HTTP factory. `invoke` is driven per-test to make a tier
// succeed or fail. This is the only place the "network" is faked.
vi.mock('../ModelFactory.js', () => ({
  createChatModel: (...args: unknown[]) => mockCreateChatModel(...args),
}));

// EXTERNAL BOUNDARY: error classification. Driven per-test so RATE_LIMIT (retryable →
// advance to the next tier) vs AUTHENTICATION etc. are deterministic. Both the vision
// invoke path and the outer processAttachments fallback-string path read this.
vi.mock('../../utils/apiErrorParser.js', () => ({
  parseApiError: (error: unknown) => mockParseApiError(error),
  // shouldRetryError governs the OUTER withParallelRetry. describeImageWithFallback never
  // throws, so the outer loop always sees success and this is effectively unused — but the
  // real module exports it, so the mock must too.
  shouldRetryError: () => false,
}));

// EXTERNAL BOUNDARY: redis (cache + quota + vision-support probe).
vi.mock('../../redis.js', () => ({
  checkModelVisionSupport: mockCheckModelVisionSupport,
  visionDescriptionCache: {
    tryAcquireInflight: vi.fn().mockResolvedValue(true),
    isInflight: vi.fn().mockResolvedValue(false),
    releaseInflight: vi.fn().mockResolvedValue(undefined),
    get: mockVisionCacheGet,
    store: mockVisionCacheStore,
    getFailure: mockVisionCacheGetFailure,
    storeFailure: mockVisionCacheStoreFailure,
  },
  visionFallbackQuota: {
    tryConsume: mockVisionFallbackQuotaConsume,
  },
}));

// Guard against real image fetching: imageToDataUrl would attempt a network download.
// Fail it so describeImage gracefully falls back to handing the provider the original URL
// (the code path already tolerates this) — keeps the test hermetic without touching the
// vision seams under test.
vi.mock('../../utils/imageToDataUrl.js', () => ({
  downloadImageToDataUrl: vi.fn().mockRejectedValue(new Error('no network in test')),
}));

describe('vision fallback chain (wiring / seam test)', () => {
  const imageAttachment: AttachmentMetadata = {
    id: 'attach-1',
    url: 'https://cdn.discordapp.com/image1.png',
    name: 'image1.png',
    contentType: CONTENT_TYPES.IMAGE_PNG,
    size: 1024,
  };

  // A personality with an explicit primary vision model + one stamped fallback tier.
  // Both live on OpenRouter (no '/'-less glm- names), so detectVisionProvider maps both to
  // OpenRouter and resolveVisionAuth resolves each against the same provider.
  const personality: LoadedPersonality = {
    id: 'test-personality',
    name: 'Test',
    displayName: 'Test Bot',
    slug: 'test',
    ownerId: 'owner-uuid-test',
    systemPrompt: 'Test prompt',
    model: 'gpt-4',
    provider: 'openrouter',
    visionModel: 'primary/model',
    visionFallbackModels: ['fallback/model'],
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 8000,
    characterInfo: 'A test personality',
    personalityTraits: 'Helpful',
    voiceEnabled: false,
  };

  // The mock resolver, passed INSIDE the visionAuth bundle. resolveVisionAuth (REAL) calls
  // tryResolveUserKey for the authenticated path — returning a user key keeps both tiers on
  // the user's own key (source: 'user', model = the tier's own model), so the primary and
  // fallback stay DISTINCT models and neither collapses onto the free-tier floor.
  let mockApiKeyResolver: {
    resolveApiKey: ReturnType<typeof vi.fn>;
    tryResolveUserKey: ReturnType<typeof vi.fn>;
  };

  function buildVisionAuth(): ResolveVisionConfigOptions {
    return {
      personality,
      mainProvider: undefined,
      mainApiKey: undefined,
      isGuestMode: false,
      userId: 'user-1',
      apiKeyResolver: mockApiKeyResolver as unknown as ApiKeyResolver,
    };
  }

  /**
   * Build a createChatModel mock whose `invoke` behaves differently per model name.
   * `perModel` maps a model name → the invoke implementation for that tier. Any model not
   * in the map rejects with a generic error (so an unexpected tier is loud, not silent).
   */
  function driveModels(perModel: Record<string, () => Promise<{ content: string }>>): void {
    mockCreateChatModel.mockImplementation(({ modelName }: { modelName: string }) => ({
      model: {
        invoke: () => {
          const impl = perModel[modelName];
          if (impl === undefined) {
            return Promise.reject(new Error(`unexpected model invoked: ${modelName}`));
          }
          return impl();
        },
      },
      modelName,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockApiKeyResolver = {
      // resolveApiKey is only reached on the guest / broad-free-fallback paths, which these
      // scenarios avoid; provide a sane default so an unexpected call doesn't throw opaquely.
      resolveApiKey: vi.fn().mockResolvedValue({
        apiKey: 'system-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        isGuestMode: true,
      }),
      // Authenticated user HAS a key for the vision provider → each tier resolves to their
      // own key against its own model. This is the seam the BYOK-key-resolution regression lived in.
      tryResolveUserKey: vi.fn().mockResolvedValue('user-vision-key'),
    };

    // Cache: total miss, no cached failures. Quota: available. Vision support: irrelevant
    // here because the personality has an explicit visionModel (priority-1 in selectVisionModel).
    mockCheckModelVisionSupport.mockResolvedValue(false);
    mockVisionCacheGet.mockResolvedValue(null);
    mockVisionCacheStore.mockResolvedValue(undefined);
    mockVisionCacheGetFailure.mockResolvedValue(null);
    mockVisionCacheStoreFailure.mockResolvedValue(undefined);
    mockVisionFallbackQuotaConsume.mockResolvedValue(true);

    // Default classification: retryable rate-limit. Individual tests that need a different
    // category override this. Shape mirrors the real parseApiError return contract.
    mockParseApiError.mockReturnValue({
      category: ApiErrorCategory.RATE_LIMIT,
      type: 'RATE_LIMIT',
      statusCode: 429,
      shouldRetry: true,
      technicalMessage: 'rate limited',
      referenceId: 'test-ref',
      requestId: undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // SCENARIO 1 — the headline. Primary fails retryable (RATE_LIMIT) → the REAL loop advances
  // to the stamped fallback tier, which succeeds. This is the scenario that would have caught
  // the `visionAuth`-drop bug: if visionAuth never reached describeImageWithFallback,
  // the single-model describeImage would run, the loop wouldn't exist, and the fallback model
  // would never be invoked → this test's "createChatModel called for fallback/model" assertion
  // fails. It also proves auth flowed through the REAL resolver (the BYOK-regression seam).
  it('primary fails retryable → advances to fallback tier, which succeeds', async () => {
    driveModels({
      'primary/model': () => Promise.reject(new Error('429 rate limited')),
      'fallback/model': () => Promise.resolve({ content: 'FALLBACK DESCRIPTION of the image' }),
    });

    const results = await processAttachments([imageAttachment], personality, {
      isGuestMode: false,
      visionAuth: buildVisionAuth(),
    });

    // The description came from the FALLBACK tier — proves visionAuth was forwarded through
    // processAttachments, the real loop ran, and it advanced past the failed primary.
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: AttachmentType.Image,
      description: 'FALLBACK DESCRIPTION of the image',
      originalUrl: imageAttachment.url,
    });

    // The loop tried BOTH tiers, in order — proves the fallback chain actually walked.
    const invokedModels = mockCreateChatModel.mock.calls.map(
      call => (call[0] as { modelName: string }).modelName
    );
    expect(invokedModels).toContain('primary/model');
    expect(invokedModels).toContain('fallback/model');

    // Auth flowed through the REAL resolver (not dropped) — proves the BYOK-regression seam is exercised.
    expect(mockApiKeyResolver.tryResolveUserKey).toHaveBeenCalled();
  });

  // SCENARIO 2 — every tier fails retryable → the whole chain exhausts. The wrapper NEVER
  // throws (its contract): it renders a `[Image …]` placeholder and processAttachments
  // RESOLVES. Proves per-image graceful degradation through the real chain.
  it('all tiers fail retryable → exhaustion placeholder, resolves without throwing', async () => {
    // The real composeVisionTiers appends the hardcoded floor model (config.VISION_FALLBACK_MODEL)
    // as a 3rd tier after the primary + stamped fallback. Fail EVERY tier — the loop walks all of
    // them and only then renders the exhaustion placeholder. `rejectRateLimited` is the default for
    // any model not listed, so the floor tier fails too without hardcoding its (config-derived) name.
    const rejectRateLimited = (): Promise<{ content: string }> =>
      Promise.reject(new Error('429 rate limited'));
    mockCreateChatModel.mockImplementation(({ modelName }: { modelName: string }) => ({
      model: { invoke: rejectRateLimited },
      modelName,
    }));

    // Must not reject.
    const results = await processAttachments([imageAttachment], personality, {
      isGuestMode: false,
      visionAuth: buildVisionAuth(),
    });

    expect(results).toHaveLength(1);
    // Placeholder shape — the real buildFailureFallback rendered a `[Image …]` string.
    expect(results[0].type).toBe(AttachmentType.Image);
    expect(results[0].description.startsWith('[Image')).toBe(true);

    // Both tiers were actually attempted before exhaustion (the loop didn't short-circuit).
    const invokedModels = mockCreateChatModel.mock.calls.map(
      call => (call[0] as { modelName: string }).modelName
    );
    expect(invokedModels).toContain('primary/model');
    expect(invokedModels).toContain('fallback/model');
  });

  // SCENARIO 3 — primary succeeds → the loop returns immediately and NEVER touches the
  // fallback tier. Proves the loop short-circuits on the first resolved tier.
  it('primary succeeds → returns immediately, no fallback tier invoked', async () => {
    driveModels({
      'primary/model': () => Promise.resolve({ content: 'PRIMARY DESCRIPTION of the image' }),
      'fallback/model': () => Promise.resolve({ content: 'should not be reached' }),
    });

    const results = await processAttachments([imageAttachment], personality, {
      isGuestMode: false,
      visionAuth: buildVisionAuth(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: AttachmentType.Image,
      description: 'PRIMARY DESCRIPTION of the image',
    });

    const invokedModels = mockCreateChatModel.mock.calls.map(
      call => (call[0] as { modelName: string }).modelName
    );
    expect(invokedModels).toContain('primary/model');
    expect(invokedModels).not.toContain('fallback/model');
    // createChatModel was invoked exactly once — only the primary tier ran.
    expect(mockCreateChatModel).toHaveBeenCalledTimes(1);
  });
});
