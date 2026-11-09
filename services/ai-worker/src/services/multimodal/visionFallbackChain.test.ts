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
import {
  AIProvider,
  FREE_ROUTER_MODEL,
  MODEL_DEFAULTS,
  ZAI_FREE_TIER_MODEL,
} from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { AttachmentType, CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { SYSTEM_SETTINGS_FALLBACKS } from '@tzurot/common-types/schemas/api/systemSettingsRegistry';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
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
  mockZaiFreeTierFailureReactor,
} = vi.hoisted(() => ({
  mockCreateChatModel: vi.fn(),
  mockParseApiError: vi.fn(),
  mockCheckModelVisionSupport: vi.fn(),
  mockVisionCacheGet: vi.fn(),
  mockVisionCacheStore: vi.fn(),
  mockVisionCacheGetFailure: vi.fn(),
  mockVisionCacheStoreFailure: vi.fn(),
  mockVisionFallbackQuotaConsume: vi.fn(),
  mockZaiFreeTierFailureReactor: vi.fn(),
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
  zaiFreeTierFailureReactor: (...args: unknown[]) => mockZaiFreeTierFailureReactor(...args),
  visionDescriptionCache: {
    tryAcquireInflight: vi.fn().mockResolvedValue(true),
    isInflight: vi.fn().mockResolvedValue(false),
    releaseInflight: vi.fn().mockResolvedValue(undefined),
    get: mockVisionCacheGet,
    // Only ever resolved to null (cache miss) in this suite — the object shape
    // never matters here, so the same mock backs both `get` and `getCanonical`.
    getCanonical: mockVisionCacheGet,
    store: mockVisionCacheStore,
    getFailure: mockVisionCacheGetFailure,
    storeFailure: mockVisionCacheStoreFailure,
  },
  visionFallbackQuota: {
    tryConsume: mockVisionFallbackQuotaConsume,
  },
  zaiFreeTierAdmission: {
    admit: vi.fn().mockResolvedValue({ admitted: false, reason: 'disabled' }),
    systemKey: vi.fn().mockReturnValue(undefined),
    isEnabled: vi.fn().mockReturnValue(false),
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
   * Build a createChatModel mock whose `generate` behaves differently per model name.
   * `perModel` maps a model name → the invoke implementation for that tier. Any model not
   * in the map rejects with a generic error (so an unexpected tier is loud, not silent).
   * `generate` is the seam `invokeModelGuarded` (production code) actually calls; wrapping
   * the per-tier result in the `LLMResult` shape keeps the tier-selection logic identical to
   * what an `invoke`-shaped implementation would have driven.
   */
  function driveModels(perModel: Record<string, () => Promise<{ content: string }>>): void {
    mockCreateChatModel.mockImplementation(({ modelName }: { modelName: string }) => ({
      model: {
        generate: async () => {
          const impl = perModel[modelName];
          const message =
            impl === undefined
              ? await Promise.reject(new Error(`unexpected model invoked: ${modelName}`))
              : await impl();
          return { generations: [[{ text: '', message }]] };
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
    mockZaiFreeTierFailureReactor.mockResolvedValue(undefined);

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
    // The real composeVisionTiers appends the paid floor (the fallbackVisionModel system setting)
    // as a 3rd tier after the primary + stamped fallback. Fail EVERY tier — the loop walks all of
    // them and only then renders the exhaustion placeholder. `rejectRateLimited` is the default for
    // any model not listed, so the floor tier fails too without hardcoding its (config-derived) name.
    const rejectRateLimited = (): Promise<never> => Promise.reject(new Error('429 rate limited'));
    mockCreateChatModel.mockImplementation(({ modelName }: { modelName: string }) => ({
      model: { generate: rejectRateLimited },
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

  // SCENARIO 4 — the production-incident shape (Alibaba `data_inspection_failed`, 7da570d8):
  // primary's provider refuses the image (PROVIDER_CONTENT_REFUSED) → the REAL loop must
  // ADVANCE rather than terminate; fallback then hits a rate limit (RATE_LIMIT) → advance
  // again; the composed floor tier answers with an HTTP-200-shaped zero-choices response,
  // which `invokeModelGuarded` (real, unmocked) turns into a classified EMPTY_RESPONSE
  // failure instead of a raw TypeError. All three tiers get walked, in order, and the chain
  // exhausts gracefully — the returned placeholder must carry the LAST attempt's category
  // (EMPTY_RESPONSE), not the first tier's provider-refusal wording.
  //
  // Classification here is the REAL `parseApiError`, fed the error shape the OpenAI SDK
  // produces for an OpenRouter-wrapped provider refusal: the message is only
  // `400 Provider returned error`, and the upstream code (`data_inspection_failed`) lives
  // solely inside `error.error.metadata.raw`, the provider's own response body as a string.
  // A message-substring stub could never catch a classifier that stops scanning that body.
  it('production-incident shape: provider refusal then rate-limit then a zero-choices 200 — all tiers walked, last category wins', async () => {
    // The prod specimen's raw body verbatim, SSE framing included, with "text" swapped for
    // "image" in the message so it matches this image-input scenario.
    const upstreamRaw =
      'data: {"error":{"code":"data_inspection_failed","param":null,"message":"Input image data may contain inappropriate content.","type":"data_inspection_failed"},"id":"chatcmpl-504609cb-81e7-9934-b24e-a40716306b6d"}\n\n';
    const providerRefusalError = Object.assign(new Error('400 Provider returned error'), {
      status: 400,
      error: {
        message: 'Provider returned error',
        code: 400,
        metadata: { raw: upstreamRaw, provider_name: 'Alibaba', is_byok: false },
      },
    });
    const rateLimitError = Object.assign(new Error('429 rate limited'), { status: 429 });

    // Real classifier for every tier: the category differs per attempt because the real
    // parser derives it from each error's own shape, not from a per-test stub.
    const actualParser = await vi.importActual<typeof import('../../utils/apiErrorParser.js')>(
      '../../utils/apiErrorParser.js'
    );
    mockParseApiError.mockImplementation(actualParser.parseApiError);

    mockCreateChatModel.mockImplementation(({ modelName }: { modelName: string }) => ({
      model: {
        generate: async () => {
          if (modelName === 'primary/model') {
            throw providerRefusalError;
          }
          if (modelName === 'fallback/model') {
            throw rateLimitError;
          }
          // The composed floor tier (config-derived name, deliberately not hardcoded):
          // an HTTP-200-shaped response carrying zero choices.
          return { generations: [] };
        },
      },
      modelName,
    }));

    const results = await processAttachments([imageAttachment], personality, {
      isGuestMode: false,
      visionAuth: buildVisionAuth(),
    });

    expect(results).toHaveLength(1);
    const { description } = results[0];

    // Never throws; always resolves to a placeholder.
    expect(description.startsWith('[Image')).toBe(true);
    // The LAST attempt's category (EMPTY_RESPONSE) rendered the generic transient wording,
    // NOT the first tier's provider-refusal wording.
    expect(description).not.toContain("vision provider's content filter declined");

    // All three tiers were actually invoked, in order — proves tier 1 ADVANCED (rather than
    // terminating) past PROVIDER_CONTENT_REFUSED, and tier 2 advanced past RATE_LIMIT.
    const invokedModels = mockCreateChatModel.mock.calls.map(
      call => (call[0] as { modelName: string }).modelName
    );
    expect(invokedModels[0]).toBe('primary/model');
    expect(invokedModels[1]).toBe('fallback/model');
    expect(invokedModels.length).toBeGreaterThanOrEqual(3);

    // The real classifier read the refusal out of `metadata.raw`: the loop advances on any
    // retryable category, so advancing alone can't show the upstream body was scanned.
    const classifiedCategories = mockParseApiError.mock.results.map(
      result => (result.value as { category: ApiErrorCategory }).category
    );
    expect(classifiedCategories).toContain(ApiErrorCategory.PROVIDER_CONTENT_REFUSED);
    expect(classifiedCategories).toContain(ApiErrorCategory.RATE_LIMIT);
    expect(classifiedCategories).toContain(ApiErrorCategory.EMPTY_RESPONSE);
  });

  // SCENARIO 5 — pins the ACCEPTED double-read in the BYOK reorder probe.
  // Keyless user + mixed free/paid fallback tail + failing primary: tier 0's REAL
  // resolveVisionAuth already asked tryResolveUserKey for (user, OpenRouter) and the
  // negative wasn't cached, then maybeReorderFallbacks probes the SAME pair once more.
  // The exact call count is the pin: 4 per-tier resolutions + 1 one-time z.ai lookup
  // (memoized on the per-walk tracker: ZaiCoding) + 1 reorder probe.
  // The chain here is four tiers — primary, the stamped free route, the paid floor (the
  // `fallbackVisionModel` setting, whose default IS the openrouter/auto alias), and the
  // concrete terminal `composeVisionTiers` appends after a router-alias tail — so
  // 4 + 1 + 1 = 6.
  // If a future refactor threads tier 0's auth result into the probe, the probe term drops
  // out — update the acceptance comment in describeImageWithFallback.ts alongside this
  // assertion.
  it('keyless user, mixed tail: the reorder probe re-reads the wallet once beyond per-tier resolution', async () => {
    const mixedTailPersonality: LoadedPersonality = {
      ...personality,
      // A free route in the stamped fallbacks makes the tail mixed (the composed floor —
      // the fallbackVisionModel setting — is paid), so the reorder gate probes the wallet.
      visionFallbackModels: ['openrouter/free'],
    };
    // Keyless: every wallet lookup misses; per-tier resolution degrades to the broad free
    // fallback (system key on the free floor), and the reorder probe finds no key either.
    mockApiKeyResolver.tryResolveUserKey.mockResolvedValue(null);
    // Every tier fails retryable so the walk advances past tier 0 into the reorder point
    // and on to exhaustion — the outcome is irrelevant here, only the resolver traffic.
    mockCreateChatModel.mockImplementation(({ modelName }: { modelName: string }) => ({
      model: { generate: (): Promise<never> => Promise.reject(new Error('429 rate limited')) },
      modelName,
    }));

    const results = await processAttachments([imageAttachment], mixedTailPersonality, {
      isGuestMode: false,
      visionAuth: buildVisionAuth(),
    });

    expect(results).toHaveLength(1);
    expect(results[0].description.startsWith('[Image')).toBe(true);

    // Exactly one lookup targets (user, ZaiCoding) for the memoized own-plan check;
    // every other lookup targets (user, OpenRouter).
    const zaiCalls = mockApiKeyResolver.tryResolveUserKey.mock.calls.filter(
      call => call[1] === AIProvider.ZaiCoding
    );
    const otherCalls = mockApiKeyResolver.tryResolveUserKey.mock.calls.filter(
      call => call[1] !== AIProvider.ZaiCoding
    );
    expect(zaiCalls).toEqual([['user-1', AIProvider.ZaiCoding]]);
    for (const call of otherCalls) {
      expect(call).toEqual(['user-1', AIProvider.OpenRouter]);
    }
    // THE PIN: 4 per-tier resolveVisionAuth lookups + 1 one-time z.ai lookup + 1 reorder-probe lookup = 6.
    expect(mockApiKeyResolver.tryResolveUserKey).toHaveBeenCalledTimes(6);
  });

  // SCENARIO 6 — authenticated user with a z.ai coding-plan key and no OpenRouter key:
  // tier 1 claims the user's own z.ai plan (glm-5.3-flash on user-zai-key); when that
  // fails with a non-terminate category, the per-walk one-shot is spent so tier 2 falls
  // through to the free vision floor on the system key rather than collapsing onto flash
  // again. Because the first attempt is source: 'user' and isGuestMode: false, the
  // shared-plan z.ai failure reactor is not invoked.
  it('authenticated z.ai-only user: first tier fails on glm-5.3-flash (own key), second tier succeeds on the free floor (system key), reactor not invoked', async () => {
    mockApiKeyResolver.tryResolveUserKey.mockImplementation(
      async (_uid: string, provider: AIProvider) =>
        provider === AIProvider.ZaiCoding ? 'user-zai-key' : null
    );
    driveModels({
      [ZAI_FREE_TIER_MODEL]: () => Promise.reject(new Error('429 rate limited on own z.ai plan')),
      [FREE_ROUTER_MODEL]: () =>
        Promise.resolve({ content: 'FREE FLOOR DESCRIPTION after own-plan failure' }),
    });

    const results = await processAttachments([imageAttachment], personality, {
      isGuestMode: false,
      visionAuth: buildVisionAuth(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: AttachmentType.Image,
      description: 'FREE FLOOR DESCRIPTION after own-plan failure',
      originalUrl: imageAttachment.url,
    });

    expect(mockCreateChatModel).toHaveBeenCalledTimes(2);
    expect(mockCreateChatModel.mock.calls[0][0]).toMatchObject({
      modelName: ZAI_FREE_TIER_MODEL,
      apiKey: 'user-zai-key',
      provider: AIProvider.ZaiCoding,
    });
    expect(mockCreateChatModel.mock.calls[1][0]).toMatchObject({
      modelName: FREE_ROUTER_MODEL,
      apiKey: 'system-key',
      provider: AIProvider.OpenRouter,
    });
    expect(mockZaiFreeTierFailureReactor).not.toHaveBeenCalled();
  });

  // SCENARIO 7 — authenticated z.ai-only user whose primary vision tier (tier 0) is
  // already glm-5.3-flash on a [flash, concrete paid floor] chain — the one shape where
  // a dedup-skipped tier has no later tier to fall back on: tier 0 resolves directly
  // through tryResolveUserKey(ZaiCoding) and spends the per-walk own-plan claim on
  // attempt, so when flash 429s the keyless OpenRouter tier falls to the free vision
  // floor on the system key instead of re-claiming flash and dedup-skipping.
  it('authenticated z.ai-only user with flash as tier 0: flash attempt spends the own-plan claim so the next tier falls to the free floor', async () => {
    registerSystemSettings({
      get: (key: string) =>
        key === 'fallbackVisionModel'
          ? MODEL_DEFAULTS.VISION_FALLBACK
          : SYSTEM_SETTINGS_FALLBACKS[key as keyof typeof SYSTEM_SETTINGS_FALLBACKS],
    } as unknown as SystemSettingsService);
    try {
      const flashPrimaryPersonality: LoadedPersonality = {
        ...personality,
        visionModel: ZAI_FREE_TIER_MODEL,
        visionFallbackModels: [],
      };
      mockApiKeyResolver.tryResolveUserKey.mockImplementation(
        async (_uid: string, provider: AIProvider) =>
          provider === AIProvider.ZaiCoding ? 'user-zai-key' : null
      );
      driveModels({
        [ZAI_FREE_TIER_MODEL]: () => Promise.reject(new Error('429 rate limited on own-key flash')),
        [FREE_ROUTER_MODEL]: () => Promise.resolve({ content: 'FREE FLOOR after own-key flash' }),
      });

      const results = await processAttachments([imageAttachment], flashPrimaryPersonality, {
        isGuestMode: false,
        visionAuth: { ...buildVisionAuth(), personality: flashPrimaryPersonality },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        type: AttachmentType.Image,
        description: 'FREE FLOOR after own-key flash',
        originalUrl: imageAttachment.url,
      });

      expect(mockCreateChatModel).toHaveBeenCalledTimes(2);
      expect(mockCreateChatModel.mock.calls[0][0]).toMatchObject({
        modelName: ZAI_FREE_TIER_MODEL,
        apiKey: 'user-zai-key',
        provider: AIProvider.ZaiCoding,
      });
      expect(mockCreateChatModel.mock.calls[1][0]).toMatchObject({
        modelName: FREE_ROUTER_MODEL,
        apiKey: 'system-key',
        provider: AIProvider.OpenRouter,
      });
    } finally {
      resetSystemSettingsRegistration();
    }
  });
});
