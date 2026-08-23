/**
 * Tests for describeImageWithFallback — the Phase-4 vision fallback loop.
 *
 * The wrapper turns the single-model `describeImage` into a retry-down-the-chain:
 * on a RETRYABLE failure it advances to the next fallback tier; on a TERMINATE
 * category (the image itself is the problem) it short-circuits to a placeholder;
 * on an all-AUTH exhaustion it surfaces the "configure your key" guidance.
 *
 * Collaborators mocked here:
 * - `describeImage` / `selectVisionModel` / `buildFailureFallback` from VisionProcessor
 *   (the REAL `VisionModelError` and `VISION_TERMINATE_CATEGORIES` are kept via importOriginal).
 * - `resolveVisionAuth` / `createVisionQuotaTracker` from visionAuthResolver
 *   (the REAL `visionAuthFailFastDescription` is kept).
 * - the paid floor (fallbackVisionModel setting) to be deterministic
 *   (the REAL `ApiErrorCategory` is kept).
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { SYSTEM_SETTINGS_FALLBACKS } from '@tzurot/common-types/schemas/api/systemSettings';
import { AIProvider, FREE_ROUTER_MODEL } from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import {
  composeVisionTiers,
  describeImageWithFallback,
  sinkFreeRouteFallbacks,
} from './describeImageWithFallback.js';
import {
  describeImage,
  selectVisionModel,
  buildFailureFallback,
  VisionModelError,
} from './VisionProcessor.js';
import { resolveVisionAuth, createVisionQuotaTracker } from './visionAuthResolver.js';
import type { ResolveVisionConfigOptions, VisionConfigResult } from './visionAuthResolver.js';

const FALLBACK_PAID_MODEL = 'openrouter/paid-floor';

// common-types: keep everything real except getConfig (we only need
// the paid floor (fallbackVisionModel system setting) to be deterministic —
// registered through the real ambient accessor in beforeAll — and a silent
// logger. The free floor deliberately stays on its registry fallback.
beforeAll(() => {
  registerSystemSettings({
    get: (key: string) =>
      key === 'fallbackVisionModel'
        ? 'openrouter/paid-floor'
        : SYSTEM_SETTINGS_FALLBACKS[key as keyof typeof SYSTEM_SETTINGS_FALLBACKS],
  } as unknown as SystemSettingsService);
});

afterAll(() => resetSystemSettingsRegistration());

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

// VisionProcessor: mock describeImage/selectVisionModel/buildFailureFallback,
// keep the REAL VisionModelError + VISION_TERMINATE_CATEGORIES so the wrapper's
// `instanceof` and terminate-set membership checks behave against real values.
vi.mock('./VisionProcessor.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./VisionProcessor.js')>();
  return {
    ...actual,
    describeImage: vi.fn(),
    selectVisionModel: vi.fn(),
    // Declaration-time real-string impl as a safety default; beforeEach re-sets it
    // to the source-aware `[fallback:<category>/<source>]` render the assertions use.
    // (visionAuthFailFastDescription calls this at CALL time — no module-load bake.)
    buildFailureFallback: vi.fn(
      (category: unknown, source?: unknown) =>
        `[Image unavailable: mock ${String(category)}/${String(source ?? 'none')}]`
    ),
  };
});

// visionAuthResolver: mock resolveVisionAuth + createVisionQuotaTracker,
// keep the REAL visionAuthFailFastDescription (it delegates to the mocked
// buildFailureFallback above at call time).
vi.mock('./visionAuthResolver.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./visionAuthResolver.js')>();
  return {
    ...actual,
    resolveVisionAuth: vi.fn(),
    createVisionQuotaTracker: vi.fn(),
  };
});

const mockDescribeImage = vi.mocked(describeImage);
const mockSelectVisionModel = vi.mocked(selectVisionModel);
const mockBuildFailureFallback = vi.mocked(buildFailureFallback);
const mockResolveVisionAuth = vi.mocked(resolveVisionAuth);
const mockCreateVisionQuotaTracker = vi.mocked(createVisionQuotaTracker);

/** A resolved-auth result whose config.model echoes the requested tier model. */
function resolvedFor(model: string): VisionConfigResult {
  return {
    kind: 'resolved',
    config: {
      apiKey: 'k',
      provider: AIProvider.OpenRouter,
      model,
      source: 'system',
      isGuestMode: false,
    },
  };
}

function makePersonality(overrides: Partial<LoadedPersonality> = {}): LoadedPersonality {
  return {
    id: 'pers-1',
    ownerId: 'owner-1',
    name: 'TestPersona',
    slug: 'test',
    model: 'glm-5.1',
    visionModel: 'primary/model',
    visionFallbackModels: [],
    systemPrompt: '',
    temperature: 0.7,
    topP: 1,
    ...overrides,
  } as unknown as LoadedPersonality;
}

const attachment: AttachmentMetadata = {
  id: '123456789012345678',
  url: 'https://cdn.discordapp.com/img.png',
  contentType: 'image/png',
  name: 'img.png',
  size: 100,
} as AttachmentMetadata;

const mockTryResolveUserKey = vi.fn();

function makeAuthOptions(
  overrides: Partial<ResolveVisionConfigOptions> = {}
): ResolveVisionConfigOptions {
  return {
    personality: makePersonality(),
    mainProvider: undefined,
    mainApiKey: undefined,
    isGuestMode: false,
    userId: 'user-1',
    apiKeyResolver: {
      tryResolveUserKey: mockTryResolveUserKey,
    } as unknown as ResolveVisionConfigOptions['apiKeyResolver'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: user has NO OpenRouter key — the pre-BYOK-ordering baseline.
  mockTryResolveUserKey.mockResolvedValue(null);
  // Default quota tracker — always allows.
  mockCreateVisionQuotaTracker.mockReturnValue({ tryConsume: vi.fn().mockResolvedValue(true) });
  // Default: resolve auth to the tier's own model (exercises dedup-by-resolved-model realistically).
  mockResolveVisionAuth.mockImplementation(async tierModel => resolvedFor(tierModel));
  // Default buildFailureFallback: `[fallback:<category>/<source>]` — source-aware so the
  // fail-fast render (source 'user') stays distinguishable from an attempted-401 (source
  // 'system') now that both derive from the same mocked function at call time.
  mockBuildFailureFallback.mockImplementation(
    (category: ApiErrorCategory, source?: 'user' | 'system') =>
      `[fallback:${category}/${source ?? 'none'}]`
  );
});

describe('composeVisionTiers', () => {
  it('produces order = [primary, ...visionFallbackModels, floor]', () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a', 'tier-b'] });
    const tiers = composeVisionTiers('primary/model', personality, false);
    // Only 3 fit under MAX_VISION_FALLBACK_TIERS, so the floor is capped out here;
    // the ORDER of the retained prefix is what this asserts.
    expect(tiers).toEqual(['primary/model', 'tier-a', 'tier-b']);
  });

  it('appends the paid floor (fallbackVisionModel setting) when NOT guest mode', () => {
    const personality = makePersonality({ visionFallbackModels: [] });
    const tiers = composeVisionTiers('primary/model', personality, false);
    expect(tiers).toEqual(['primary/model', FALLBACK_PAID_MODEL]);
  });

  it('appends the free floor (FREE_ROUTER_MODEL) when guest mode', () => {
    const personality = makePersonality({ visionFallbackModels: [] });
    const tiers = composeVisionTiers('primary/model', personality, true);
    expect(tiers).toEqual(['primary/model', FREE_ROUTER_MODEL]);
  });

  it('dedups repeated models across primary/fallbacks/floor', () => {
    // primary === a fallback, and the floor === primary → collapses to unique set.
    const personality = makePersonality({
      visionFallbackModels: ['primary/model', FALLBACK_PAID_MODEL],
    });
    const tiers = composeVisionTiers('primary/model', personality, false);
    expect(tiers).toEqual(['primary/model', FALLBACK_PAID_MODEL]);
  });

  it('caps the tier list at 3 (MAX_VISION_FALLBACK_TIERS)', () => {
    const personality = makePersonality({
      visionFallbackModels: ['tier-a', 'tier-b', 'tier-c', 'tier-d'],
    });
    const tiers = composeVisionTiers('primary/model', personality, false);
    expect(tiers).toHaveLength(3);
    expect(tiers).toEqual(['primary/model', 'tier-a', 'tier-b']);
  });

  it('never reorders on its own — the stamped free-first order is preserved as-composed', () => {
    const personality = makePersonality({
      visionFallbackModels: [FREE_ROUTER_MODEL, 'openrouter/auto'],
    });
    const tiers = composeVisionTiers('qwen/qwen3.7-plus', personality, false);
    expect(tiers).toEqual(['qwen/qwen3.7-plus', FREE_ROUTER_MODEL, 'openrouter/auto']);
  });

  it('drops empty-string models', () => {
    const personality = makePersonality({ visionFallbackModels: ['', 'tier-a', ''] });
    const tiers = composeVisionTiers('primary/model', personality, false);
    expect(tiers).toEqual(['primary/model', 'tier-a', FALLBACK_PAID_MODEL]);
  });
});

describe('sinkFreeRouteFallbacks', () => {
  it('sinks free-route fallbacks below paid ones', () => {
    expect(
      sinkFreeRouteFallbacks(['qwen/qwen3.7-plus', FREE_ROUTER_MODEL, 'openrouter/auto'])
    ).toEqual(['qwen/qwen3.7-plus', 'openrouter/auto', FREE_ROUTER_MODEL]);
  });

  it('sinks :free-suffix models too, preserving relative order within each partition', () => {
    expect(
      sinkFreeRouteFallbacks(['primary/model', 'x-ai/grok-4.1:free', 'openrouter/auto'])
    ).toEqual(['primary/model', 'openrouter/auto', 'x-ai/grok-4.1:free']);
  });

  it('never moves a free-route PRIMARY — explicit config wins over the key signal', () => {
    const tiers = sinkFreeRouteFallbacks([FREE_ROUTER_MODEL, 'openrouter/auto']);
    expect(tiers).toEqual([FREE_ROUTER_MODEL, 'openrouter/auto']);
  });
});

describe('describeImageWithFallback', () => {
  it('returns the primary tier description and never falls back on success', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    mockDescribeImage.mockResolvedValueOnce('primary description');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    expect(result).toBe('primary description');
    expect(mockDescribeImage).toHaveBeenCalledTimes(1);
    // No selectVisionModel — describeOptions.model was supplied.
    expect(mockSelectVisionModel).not.toHaveBeenCalled();
  });

  it('walks the chain in BYOK order when the user has an OpenRouter key (7da570d8 shape)', async () => {
    // Incident chain: [qwen, free, auto]. With a paid key the walk must reach
    // openrouter/auto at tier 2, with the free route demoted to last resort.
    const personality = makePersonality({
      visionFallbackModels: [FREE_ROUTER_MODEL, 'openrouter/auto'],
    });
    mockTryResolveUserKey.mockResolvedValue('sk-or-user-key');
    mockDescribeImage
      .mockRejectedValueOnce(new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'refused'))
      .mockResolvedValueOnce('auto description');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'qwen/qwen3.7-plus' }
    );

    expect(result).toBe('auto description');
    // Seam: the probe asks the resolver for the USER's OpenRouter wallet entry.
    expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
    // Tier order crossing the auth seam: qwen first, then auto — free never reached.
    expect(mockResolveVisionAuth.mock.calls.map(call => call[0])).toEqual([
      'qwen/qwen3.7-plus',
      'openrouter/auto',
    ]);
  });

  it('keeps the stamped order and never probes the wallet for a guest', async () => {
    const personality = makePersonality({
      visionFallbackModels: [FREE_ROUTER_MODEL, 'openrouter/auto'],
    });
    mockDescribeImage
      .mockRejectedValueOnce(new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'refused'))
      .mockResolvedValueOnce('free description');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality, isGuestMode: true }),
      { model: 'qwen/qwen3.7-plus' }
    );

    expect(result).toBe('free description');
    expect(mockTryResolveUserKey).not.toHaveBeenCalled();
    expect(mockResolveVisionAuth.mock.calls.map(call => call[0])).toEqual([
      'qwen/qwen3.7-plus',
      FREE_ROUTER_MODEL,
    ]);
  });

  it('never probes the wallet when the primary tier succeeds — even with a mixed tail', async () => {
    const personality = makePersonality({
      visionFallbackModels: [FREE_ROUTER_MODEL, 'openrouter/auto'],
    });
    mockTryResolveUserKey.mockResolvedValue('sk-or-user-key');
    mockDescribeImage.mockResolvedValueOnce('primary description');

    await describeImageWithFallback(attachment, personality, makeAuthOptions({ personality }), {
      model: 'qwen/qwen3.7-plus',
    });

    expect(mockTryResolveUserKey).not.toHaveBeenCalled();
  });

  it('skips the wallet probe when the fallback tail has no free route (reorder is a no-op)', async () => {
    // Primary FAILS so the walk reaches the reorder point — the skip must come from the
    // tail-content gate, not from never advancing past tier 0.
    const personality = makePersonality({ visionFallbackModels: ['openrouter/auto'] });
    mockDescribeImage
      .mockRejectedValueOnce(new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'refused'))
      .mockResolvedValueOnce('auto description');

    await describeImageWithFallback(attachment, personality, makeAuthOptions({ personality }), {
      model: 'qwen/qwen3.7-plus',
    });

    expect(mockTryResolveUserKey).not.toHaveBeenCalled();
  });

  it('skips the wallet probe when the fallback tail is all free routes (reorder is a no-op)', async () => {
    // Deliberately NOT guest — the guest short-circuit lives in the probe itself, so an
    // authenticated user is what proves the tail-content gate skips the resolver call.
    // TWO free fallbacks, so the cap slices the (paid) floor off and the tail is all-free.
    // Primary FAILS so the walk reaches the reorder point.
    const personality = makePersonality({
      visionFallbackModels: [FREE_ROUTER_MODEL, 'x-ai/grok-4.1:free'],
    });
    mockDescribeImage
      .mockRejectedValueOnce(new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'refused'))
      .mockResolvedValueOnce('free description');

    await describeImageWithFallback(attachment, personality, makeAuthOptions({ personality }), {
      model: 'qwen/qwen3.7-plus',
    });

    expect(mockTryResolveUserKey).not.toHaveBeenCalled();
  });

  it('promotes a non-OpenRouter paid tier on OpenRouter-key evidence (accepted slop, pinned)', async () => {
    // The sink is provider-agnostic while the key evidence is OpenRouter-only: a mixed
    // free + z.ai-paid tail reorders on an unrelated OpenRouter key. Pinned so a future
    // isFreeModel/provider-detection refactor cannot change this silently. The free
    // route is stamped FIRST so the assertion below fails unless the promotion ran.
    const personality = makePersonality({
      visionFallbackModels: [FREE_ROUTER_MODEL, 'z-ai/glm-4.8'],
    });
    mockTryResolveUserKey.mockResolvedValue('sk-or-user-key');
    mockDescribeImage
      .mockRejectedValueOnce(new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'refused'))
      .mockResolvedValueOnce('zai description');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'qwen/qwen3.7-plus' }
    );

    expect(result).toBe('zai description');
    expect(mockResolveVisionAuth.mock.calls.map(call => call[0])).toEqual([
      'qwen/qwen3.7-plus',
      'z-ai/glm-4.8',
    ]);
  });

  it('keeps the default order when the wallet probe throws (degrade, not fail)', async () => {
    const personality = makePersonality({
      visionFallbackModels: [FREE_ROUTER_MODEL, 'openrouter/auto'],
    });
    mockTryResolveUserKey.mockRejectedValue(new Error('redis down'));
    mockDescribeImage
      .mockRejectedValueOnce(new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'refused'))
      .mockResolvedValueOnce('free description');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'qwen/qwen3.7-plus' }
    );

    expect(result).toBe('free description');
    expect(mockResolveVisionAuth.mock.calls.map(call => call[0])).toEqual([
      'qwen/qwen3.7-plus',
      FREE_ROUTER_MODEL,
    ]);
  });

  it('advances to the next tier when the primary fails on a RETRYABLE category', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    mockDescribeImage
      .mockRejectedValueOnce(new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'rate limited'))
      .mockResolvedValueOnce('second tier description');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    expect(result).toBe('second tier description');
    expect(mockDescribeImage).toHaveBeenCalledTimes(2);
  });

  it('also treats SERVER_ERROR as retryable and advances', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    mockDescribeImage
      .mockRejectedValueOnce(new VisionModelError(ApiErrorCategory.SERVER_ERROR, 'boom'))
      .mockResolvedValueOnce('recovered');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    expect(result).toBe('recovered');
    expect(mockDescribeImage).toHaveBeenCalledTimes(2);
  });

  it('advances past a tier that throws a NON-VisionModelError (e.g. createChatModel missing-key)', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    mockDescribeImage
      .mockRejectedValueOnce(new Error('No API key available for provider openrouter'))
      .mockResolvedValueOnce('second tier description');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    // The loop is the graceful-degradation boundary — a non-VisionModelError advances
    // instead of propagating, so the next tier still gets a shot.
    expect(result).toBe('second tier description');
    expect(mockDescribeImage).toHaveBeenCalledTimes(2);
  });

  it('never throws — renders a generic fallback when selectVisionModel throws', async () => {
    const personality = makePersonality({ visionFallbackModels: [] });
    mockSelectVisionModel.mockRejectedValueOnce(new Error('redis down'));

    // No describeOptions.model → the wrapper calls selectVisionModel, which throws BEFORE
    // the tier loop. The top-level catch must degrade to a generic fallback, not propagate.
    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality })
    );

    expect(mockBuildFailureFallback).toHaveBeenCalledWith(
      ApiErrorCategory.UNKNOWN,
      undefined,
      'img.png'
    );
    expect(mockDescribeImage).not.toHaveBeenCalled();
    expect(typeof result).toBe('string');
  });

  it('short-circuits on a TERMINATE category (CONTENT_POLICY) without trying later tiers', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a', 'tier-b'] });
    mockDescribeImage.mockRejectedValueOnce(
      new VisionModelError(ApiErrorCategory.CONTENT_POLICY, 'filtered')
    );

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    // Returns buildFailureFallback(CONTENT_POLICY, ...) immediately.
    expect(result).toBe(`[fallback:${ApiErrorCategory.CONTENT_POLICY}/system]`);
    expect(mockBuildFailureFallback).toHaveBeenCalledWith(
      ApiErrorCategory.CONTENT_POLICY,
      expect.anything(),
      'img.png' // the filename crosses the seam so the placeholder can name the image
    );
    // Only the primary tier was attempted — no later tiers.
    expect(mockDescribeImage).toHaveBeenCalledTimes(1);
  });

  it('short-circuits on a TERMINATE category (MEDIA_NOT_FOUND) too', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a', 'tier-b'] });
    mockDescribeImage.mockRejectedValueOnce(
      new VisionModelError(ApiErrorCategory.MEDIA_NOT_FOUND, 'gone')
    );

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    expect(result).toBe(`[fallback:${ApiErrorCategory.MEDIA_NOT_FOUND}/system]`);
    expect(mockDescribeImage).toHaveBeenCalledTimes(1);
  });

  it('returns buildFailureFallback(lastCategory) when every tier fails on a non-auth category', async () => {
    // Three distinct tiers (primary + one fallback + paid floor), all rate-limited.
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    mockDescribeImage.mockRejectedValue(
      new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'rate limited')
    );

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    expect(result).toBe(`[fallback:${ApiErrorCategory.RATE_LIMIT}/system]`);
    // primary/model, tier-a, and the paid floor are three distinct resolved models.
    expect(mockDescribeImage).toHaveBeenCalledTimes(3);
    // Source is threaded from the last attempted tier (resolvedFor → 'system').
    expect(mockBuildFailureFallback).toHaveBeenLastCalledWith(
      ApiErrorCategory.RATE_LIMIT,
      'system',
      'img.png'
    );
  });

  it('renders an attempted-401 via buildFailureFallback honoring the key source (NOT the fixed auth message)', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    // Every tier RESOLVES a key (resolvedFor → source 'system') then the provider 401s —
    // i.e. a revoked/expired SYSTEM key, not a missing user key.
    mockDescribeImage.mockRejectedValue(
      new VisionModelError(ApiErrorCategory.AUTHENTICATION, 'bad key')
    );

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    // A resolved-key 401 must respect the source (buildFailureFallback maps system-source AUTH
    // to a non-blaming "temporarily unavailable"), NOT the fixed "configure your key" string
    // — which would wrongly tell a guest to fix a key they don't own.
    expect(result).toBe(`[fallback:${ApiErrorCategory.AUTHENTICATION}/system]`);
    expect(mockBuildFailureFallback).toHaveBeenCalledWith(
      ApiErrorCategory.AUTHENTICATION,
      'system',
      'img.png'
    );
  });

  it('renders the fail-fast auth placeholder (with the filename) when every tier resolves to failFast', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    // Never resolves auth — every tier fails fast on the provider.
    mockResolveVisionAuth.mockResolvedValue({ kind: 'failFast', provider: AIProvider.OpenRouter });

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    // visionAuthFailFastDescription(attachment.name) → AUTH + 'user' + the filename.
    expect(result).toBe(`[fallback:${ApiErrorCategory.AUTHENTICATION}/user]`);
    expect(mockBuildFailureFallback).toHaveBeenCalledWith(
      ApiErrorCategory.AUTHENTICATION,
      'user',
      'img.png'
    );
    // failFast means describeImage is never invoked for any tier.
    expect(mockDescribeImage).not.toHaveBeenCalled();
  });

  it('does NOT surface the auth message when a real attempt failed before a downstream failFast', async () => {
    // Regression: tier 1 makes a GENUINE attempt that fails RATE_LIMIT (the shared free model
    // is rate-limited — the case this loop exists for); tiers 2+ then failFast because the
    // once-per-request quota is already exhausted. The exhaustion message must reflect the
    // REAL RATE_LIMIT failure, not clobber it to "configure your key."
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    mockResolveVisionAuth.mockImplementation(async tierModel =>
      tierModel === 'primary/model'
        ? resolvedFor(tierModel)
        : { kind: 'failFast', provider: AIProvider.OpenRouter }
    );
    mockDescribeImage.mockRejectedValueOnce(
      new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'rate limited')
    );

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    // Rendered via buildFailureFallback(RATE_LIMIT, <the attempted tier's source>), NOT the
    // auth placeholder — the genuine RATE_LIMIT failure survives the later failFast tiers.
    expect(result).toBe(`[fallback:${ApiErrorCategory.RATE_LIMIT}/system]`);
    expect(mockBuildFailureFallback).toHaveBeenCalledWith(
      ApiErrorCategory.RATE_LIMIT,
      'system',
      'img.png'
    );
    // Only tier 1 was actually attempted (tiers 2/3 failFast).
    expect(mockDescribeImage).toHaveBeenCalledTimes(1);
  });

  it('skips describeImage on a failFast tier and advances to the next (resolvable) tier', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    // First tier fails fast (no usable key); second tier resolves + succeeds.
    mockResolveVisionAuth
      .mockResolvedValueOnce({ kind: 'failFast', provider: AIProvider.OpenRouter })
      .mockImplementationOnce(async tierModel => resolvedFor(tierModel));
    mockDescribeImage.mockResolvedValueOnce('tier-a description');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    expect(result).toBe('tier-a description');
    // describeImage was called exactly once — only for the second (resolved) tier.
    expect(mockDescribeImage).toHaveBeenCalledTimes(1);
  });

  it('dedups by RESOLVED model — collapsed tiers hit describeImage only once', async () => {
    const personality = makePersonality({ visionFallbackModels: ['tier-a'] });
    // Two DIFFERENT tier models resolve to the SAME model (broad-free collapse).
    mockResolveVisionAuth.mockImplementation(async () => resolvedFor('collapsed-free'));
    // First call fails retryably so the loop would advance; the second tier resolves
    // to the same model and must be SKIPPED (attempted-set dedup) → the floor (also
    // 'collapsed-free') is skipped too, so describeImage runs exactly once.
    mockDescribeImage.mockRejectedValueOnce(
      new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'rate limited')
    );

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    // Every attempt collapsed onto 'collapsed-free' → only one real describeImage call.
    expect(mockDescribeImage).toHaveBeenCalledTimes(1);
    // Chain exhausted on a retryable (rate-limit) category → generic fallback.
    expect(result).toBe(`[fallback:${ApiErrorCategory.RATE_LIMIT}/system]`);
  });

  it('passes throwOnFailure + skipNegativeCache to describeImage', async () => {
    const personality = makePersonality({ visionFallbackModels: [] });
    mockDescribeImage.mockResolvedValueOnce('ok');

    await describeImageWithFallback(attachment, personality, makeAuthOptions({ personality }), {
      model: 'primary/model',
    });

    expect(mockDescribeImage).toHaveBeenCalledWith(
      attachment,
      personality,
      false, // isGuestMode from resolved config
      'k', // apiKey from resolved config
      expect.objectContaining({
        throwOnFailure: true,
        skipNegativeCache: true,
        model: 'primary/model',
        provider: 'openrouter',
      })
    );
  });

  it('creates a fresh quota tracker per call — meters the free-tier quota PER IMAGE', async () => {
    // Each image's describeImageWithFallback gets its OWN tracker, so the free-vision daily
    // cap meters per image (a 2-image message spends up to 2 units, not 1) — the deliberate
    // per-image accounting documented on VisionFallbackQuota. A single per-request tracker
    // would undercount a multi-image message as one.
    const personality = makePersonality({ visionFallbackModels: [] });
    mockDescribeImage.mockResolvedValue('ok');
    const opts = makeAuthOptions({ personality });

    // Two images through the loop, as a multi-attachment message would drive it.
    await describeImageWithFallback(attachment, personality, opts, { model: 'primary/model' });
    await describeImageWithFallback(attachment, personality, opts, { model: 'primary/model' });

    expect(mockCreateVisionQuotaTracker).toHaveBeenCalledTimes(2);
  });

  it('derives the primary model via selectVisionModel when describeOptions.model is omitted', async () => {
    const personality = makePersonality({ visionFallbackModels: [] });
    mockSelectVisionModel.mockResolvedValueOnce('selected/model');
    mockDescribeImage.mockResolvedValueOnce('ok');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality })
      // no describeOptions → falls through to selectVisionModel
    );

    expect(result).toBe('ok');
    expect(mockSelectVisionModel).toHaveBeenCalledWith(personality, false);
    // The resolved model echoes the selected primary — and the first tier is
    // flagged primary (the only tier allowed the same-provider fast path).
    expect(mockResolveVisionAuth).toHaveBeenCalledWith(
      'selected/model',
      expect.anything(),
      expect.anything(),
      true
    );
  });

  it('flags ONLY the first tier as primary (fallback tiers skip the fast path)', async () => {
    const personality = makePersonality({ visionFallbackModels: ['fallback/model'] });
    // Tier 1 advances (retryable failure), tier 2 resolves.
    mockResolveVisionAuth
      .mockResolvedValueOnce(resolvedFor('primary/model'))
      .mockResolvedValueOnce(resolvedFor('fallback/model'));
    mockDescribeImage
      .mockRejectedValueOnce(new VisionModelError(ApiErrorCategory.RATE_LIMIT, 'rl'))
      .mockResolvedValueOnce('ok');

    const result = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions({ personality }),
      { model: 'primary/model' }
    );

    expect(result).toBe('ok');
    // Seam assertion: isPrimaryTier must be true for tier 1 and false afterwards —
    // a fallback tier taking the fast path would retry the identical dead key.
    expect(mockResolveVisionAuth).toHaveBeenNthCalledWith(
      1,
      'primary/model',
      expect.anything(),
      expect.anything(),
      true
    );
    expect(mockResolveVisionAuth).toHaveBeenNthCalledWith(
      2,
      'fallback/model',
      expect.anything(),
      expect.anything(),
      false
    );
  });
});
