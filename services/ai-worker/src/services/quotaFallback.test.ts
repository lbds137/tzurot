import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { ApiErrorCategory, ApiErrorType } from '@tzurot/common-types/constants/error';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { ApiError } from '../utils/apiErrorParser.js';
import { RetryError } from '../utils/retry.js';
import {
  applyConfigToPersonality,
  checkModelViability,
  classifyBillingQuotaFailure,
  classifyQuotaFailure,
  isCausePrecedenceFailure,
  selectFloorTarget,
  selectQuotaFallbackTarget,
  type QuotaFallbackCaches,
} from './quotaFallback.js';

/**
 * Doom-cache mock, BUCKET-AWARE by design: Redis marks live under a
 * (cacheKeyId[, model]) scope, and a mock that answers the same regardless of
 * bucket cannot see a wrong-identity read — the exact class this module's
 * viability checks exist to get right. `exhausted: true` / a bare model
 * string mark every bucket; pass `{ cacheKeyId }` scoping to pin identity.
 */
function buildCaches(overrides?: {
  exhausted?: boolean | string[];
  rateLimitedModels?: (string | { cacheKeyId: string; model: string })[];
}): QuotaFallbackCaches {
  const exhausted = overrides?.exhausted ?? false;
  const rateLimitedModels = overrides?.rateLimitedModels ?? [];
  return {
    creditExhaustion: {
      isCreditExhausted: vi
        .fn()
        .mockImplementation(({ cacheKeyId }: { cacheKeyId: string }) =>
          Promise.resolve(
            exhausted === true || (Array.isArray(exhausted) && exhausted.includes(cacheKeyId))
              ? { exhausted: true, exhaustedAtMs: 0, ttlSeconds: 60 }
              : { exhausted: false }
          )
        ),
    },
    rateLimit: {
      isRateLimited: vi
        .fn()
        .mockImplementation(({ cacheKeyId, model }: { cacheKeyId: string; model: string }) =>
          Promise.resolve(
            rateLimitedModels.some(entry =>
              typeof entry === 'string'
                ? entry === model
                : entry.model === model && entry.cacheKeyId === cacheKeyId
            )
              ? { rateLimited: true }
              : { rateLimited: false }
          )
        ),
    },
  } as unknown as QuotaFallbackCaches;
}

function buildResolver(options: {
  free?: { model: string } | null;
  global?: { model: string } | null;
}): { getFreeDefaultConfig: () => unknown; getGlobalDefaultConfig: () => unknown } {
  return {
    getFreeDefaultConfig: vi.fn().mockResolvedValue(options.free ?? null),
    getGlobalDefaultConfig: vi.fn().mockResolvedValue(options.global ?? null),
  };
}

describe('checkModelViability', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.restoreAllMocks());

  it('reports credit exhaustion as the blocking category', async () => {
    const result = await checkModelViability({
      model: 'some/model',
      cacheKeyId: 'user:123',
      caches: buildCaches({ exhausted: true }),
    });
    expect(result).toEqual({ viable: false, category: ApiErrorCategory.CREDIT_EXHAUSTION });
  });

  it('reports a rate-limited model as quota-blocked', async () => {
    const result = await checkModelViability({
      model: 'some/model',
      cacheKeyId: 'user:123',
      caches: buildCaches({ rateLimitedModels: ['some/model'] }),
    });
    expect(result).toEqual({ viable: false, category: ApiErrorCategory.QUOTA_EXCEEDED });
  });

  it('is viable when neither cache blocks', async () => {
    const result = await checkModelViability({
      model: 'some/model',
      cacheKeyId: 'user:123',
      caches: buildCaches(),
    });
    expect(result).toEqual({ viable: true });
  });
});

describe('selectQuotaFallbackTarget — the tier matrix', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.restoreAllMocks());

  const base = {
    failingModel: 'expensive/primary',
    cacheKeyId: 'user:123',
  };

  it('CREDIT_EXHAUSTION + guest → terminal (the system key itself is broke)', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      isGuestMode: true,
      configResolver: buildResolver({ free: { model: 'freebie/model:free' } }) as never,
      caches: buildCaches(),
    });
    expect(target).toBeNull();
  });

  it('CREDIT_EXHAUSTION + BYOK → free default with forced system key', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      isGuestMode: false,
      configResolver: buildResolver({ free: { model: 'freebie/model:free' } }) as never,
      caches: buildCaches(),
    });
    expect(target?.config.model).toBe('freebie/model:free');
    expect(target?.forceSystemKey).toBe(true);
  });

  it("CREDIT_EXHAUSTION + BYOK: the caller's own exhaustion mark never vetoes the forced swap", async () => {
    // The user's account IS marked exhausted (that's what triggered the swap)
    // — but the forced-system-key retry bills a different account, so the
    // viability check must run under the TARGET's bucket, not the caller's.
    const caches = buildCaches({ exhausted: ['user:123'] });
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      isGuestMode: false,
      configResolver: buildResolver({ free: { model: 'freebie/model:free' } }) as never,
      caches,
    });
    expect(target?.forceSystemKey).toBe(true);
    // Seam pin: the exhaustion check DID run, under the system bucket.
    expect(caches.creditExhaustion.isCreditExhausted).toHaveBeenCalledWith({
      cacheKeyId: 'system',
    });
  });

  it('CREDIT_EXHAUSTION + BYOK: a SYSTEM-bucket exhaustion mark vetoes the forced swap (target is doomed too)', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      isGuestMode: false,
      configResolver: buildResolver({ free: { model: 'freebie/model:free' } }) as never,
      caches: buildCaches({ exhausted: ['system'] }),
    });
    expect(target).toBeNull();
  });

  it("the forced swap's rate-limit pre-check reads the TARGET's bucket, where the forced retry's 429s are written", async () => {
    // A `system`-bucket mark on the free default means the forced retry is
    // known-doomed — the fail-fast this pre-check exists for.
    const vetoed = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      isGuestMode: false,
      configResolver: buildResolver({ free: { model: 'freebie/model:free' } }) as never,
      caches: buildCaches({
        rateLimitedModels: [{ cacheKeyId: 'system', model: 'freebie/model:free' }],
      }),
    });
    expect(vetoed).toBeNull();

    // The caller's own bucket carrying the same mark is irrelevant to a
    // system-key target (the old wrong read) — the swap proceeds.
    const proceeds = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      isGuestMode: false,
      configResolver: buildResolver({ free: { model: 'freebie/model:free' } }) as never,
      caches: buildCaches({
        rateLimitedModels: [{ cacheKeyId: 'user:123', model: 'freebie/model:free' }],
      }),
    });
    expect(proceeds?.forceSystemKey).toBe(true);
  });

  it("a guest target's viability is judged under the system bucket even when the caller passes a user bucket", async () => {
    // The BYOK degraded-downgrade funnels (runner + retarget route) call with
    // isGuestMode: true while still holding the user's cacheKeyId — the free
    // target runs on the system key regardless, so identity derives internally.
    const vetoed = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      isGuestMode: true,
      configResolver: buildResolver({ free: { model: 'freebie/model:free' } }) as never,
      caches: buildCaches({
        rateLimitedModels: [{ cacheKeyId: 'system', model: 'freebie/model:free' }],
      }),
    });
    expect(vetoed).toBeNull();

    const proceeds = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      isGuestMode: true,
      configResolver: buildResolver({ free: { model: 'freebie/model:free' } }) as never,
      caches: buildCaches({
        rateLimitedModels: [{ cacheKeyId: 'user:123', model: 'freebie/model:free' }],
      }),
    });
    expect(proceeds?.config.model).toBe('freebie/model:free');
  });

  it('QUOTA_EXCEEDED + BYOK → global (paid) default on the own key', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      isGuestMode: false,
      configResolver: buildResolver({ global: { model: 'paid/default' } }) as never,
      caches: buildCaches(),
    });
    expect(target?.config.model).toBe('paid/default');
    expect(target?.forceSystemKey).toBe(false);
  });

  it('QUOTA_EXCEEDED + guest → free default', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      isGuestMode: true,
      configResolver: buildResolver({ free: { model: 'freebie/model:free' } }) as never,
      caches: buildCaches(),
    });
    expect(target?.config.model).toBe('freebie/model:free');
    expect(target?.forceSystemKey).toBe(false);
  });

  it('a NON-free free-default (the z.ai piggyback preset) degrades guest targets to the free router', async () => {
    // The admin free default may be z-ai/glm-4.5-air — paid on OpenRouter. A
    // guest retarget must never bill it to the system key; the dynamic router
    // substitutes (the z.ai upgrade happens only at AuthStep admission).
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      isGuestMode: true,
      configResolver: buildResolver({ free: { model: 'z-ai/glm-4.5-air' } }) as never,
      caches: buildCaches(),
    });
    expect(target?.config.model).toBe('openrouter/free');
    expect(target?.config.provider).toBe('openrouter');
  });

  describe('guest-safe floor reads the LIVE fallbackTextModelFree setting', () => {
    // Divergent-from-fallback values prove the live read (the registry
    // fallback coincidentally equals the retired constant, so equality with
    // it proves nothing — reviewer-flagged seam gap).
    afterEach(() => resetSystemSettingsRegistration());

    function registerFloor(floor: string): void {
      registerSystemSettings({
        get: (key: string) => (key === 'fallbackTextModelFree' ? floor : undefined),
      } as unknown as SystemSettingsService);
    }

    it('a FREE divergent floor flows through as the substitution target', async () => {
      registerFloor('divergent/floor:free');
      const target = await selectQuotaFallbackTarget({
        ...base,
        category: ApiErrorCategory.QUOTA_EXCEEDED,
        isGuestMode: true,
        configResolver: buildResolver({ free: { model: 'z-ai/glm-4.5-air' } }) as never,
        caches: buildCaches(),
      });
      expect(target?.config.model).toBe('divergent/floor:free');
    });

    it('a NON-free floor (out-of-band bag edit) still degrades to the static router — never bills the owner', async () => {
      registerFloor('paid/sneaky-model');
      const target = await selectQuotaFallbackTarget({
        ...base,
        category: ApiErrorCategory.QUOTA_EXCEEDED,
        isGuestMode: true,
        configResolver: buildResolver({ free: { model: 'z-ai/glm-4.5-air' } }) as never,
        caches: buildCaches(),
      });
      expect(target?.config.model).toBe('openrouter/free');
    });
  });

  it('the forced-system-key BYOK downgrade gets the same guest-safe substitution', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      isGuestMode: false,
      configResolver: buildResolver({ free: { model: 'z-ai/glm-4.5-air' } }) as never,
      caches: buildCaches(),
    });
    expect(target?.config.model).toBe('openrouter/free');
    expect(target?.forceSystemKey).toBe(true);
  });

  it('terminal when no default pointer is set', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      isGuestMode: false,
      configResolver: buildResolver({}) as never,
      caches: buildCaches(),
    });
    expect(target).toBeNull();
  });

  it('terminal when the target IS the failing model (retarget would be a no-op)', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      isGuestMode: false,
      configResolver: buildResolver({ global: { model: 'expensive/primary' } }) as never,
      caches: buildCaches(),
    });
    expect(target).toBeNull();
  });

  it('terminal when the target is itself rate-limited', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      isGuestMode: false,
      configResolver: buildResolver({ global: { model: 'paid/default' } }) as never,
      caches: buildCaches({ rateLimitedModels: ['paid/default'] }),
    });
    expect(target).toBeNull();
  });

  it('terminal on the non-forced path when the account is credit-exhausted', async () => {
    // QUOTA_EXCEEDED retargets on the same key — if the account meanwhile
    // got marked exhausted, the target is doomed too.
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      isGuestMode: false,
      configResolver: buildResolver({ global: { model: 'paid/default' } }) as never,
      caches: buildCaches({ exhausted: true }),
    });
    expect(target).toBeNull();
  });
});

describe('applyConfigToPersonality', () => {
  it('swaps the model and the FULL parameter set — unset target params are cleared, not inherited', () => {
    const personality = {
      id: 'p1',
      name: 'Testy',
      model: 'expensive/primary',
      temperature: 0.9,
      topP: 0.5,
      maxTokens: 4000,
      showThinking: true,
    } as unknown as LoadedPersonality;

    const result = applyConfigToPersonality(personality, {
      model: 'freebie/model:free',
      temperature: 0.7,
      // topP/maxTokens/showThinking deliberately unset on the target config
    });

    expect(result.model).toBe('freebie/model:free');
    expect(result.temperature).toBe(0.7);
    // The primary preset's params were tuned for a different model — they
    // must NOT leak onto the fallback (provider defaults apply instead).
    expect(result.topP).toBeUndefined();
    expect(result.maxTokens).toBeUndefined();
    expect(result.showThinking).toBeUndefined();
    // Non-config personality fields survive untouched.
    expect(result.name).toBe('Testy');
    expect(result.id).toBe('p1');
  });

  it('resets a stale non-OpenRouter provider so the target model routes to ITS catalog', () => {
    // The motivating incident's shape: a z.ai-promoted personality carries
    // provider='zai-coding'; sending the OpenRouter admin default's model to
    // z.ai's endpoint would fail — the rescue must rewrite the provider too.
    const promoted = {
      id: 'p1',
      name: 'Testy',
      model: 'glm-5.2',
      provider: 'zai-coding',
    } as unknown as LoadedPersonality;

    const result = applyConfigToPersonality(promoted, { model: 'anthropic/claude-sonnet-4' });

    expect(result.model).toBe('anthropic/claude-sonnet-4');
    expect(result.provider).toBe('openrouter');
  });

  it('honors an explicit provider carried on the target config', () => {
    const personality = {
      id: 'p1',
      name: 'Testy',
      model: 'old/model',
      provider: 'zai-coding',
    } as unknown as LoadedPersonality;

    const result = applyConfigToPersonality(personality, {
      model: 'new/model',
      provider: 'openrouter',
    });

    expect(result.provider).toBe('openrouter');
  });
});

describe('classifyQuotaFailure', () => {
  it("honors an ApiError's own authoritative category (cache short-circuit synthetics)", () => {
    const error = new ApiError('synthetic short-circuit', {
      type: ApiErrorType.PERMANENT,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      userMessage: 'x',
      technicalMessage: 'x',
      referenceId: 'ref',
      shouldRetry: false,
    });
    expect(classifyQuotaFailure(error)).toBe(ApiErrorCategory.CREDIT_EXHAUSTION);
  });

  it('unwraps RetryError before classifying', () => {
    const inner = new ApiError('quota', {
      type: ApiErrorType.PERMANENT,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      userMessage: 'x',
      technicalMessage: 'x',
      referenceId: 'ref',
      shouldRetry: false,
    });
    const wrapped = new RetryError('LLM invocation failed', 3, inner);
    expect(classifyQuotaFailure(wrapped)).toBe(ApiErrorCategory.QUOTA_EXCEEDED);
  });

  it('classifies plain errors by message and rejects non-quota categories', () => {
    expect(classifyQuotaFailure(new Error('You have hit your free tier daily limit'))).toBe(
      ApiErrorCategory.QUOTA_EXCEEDED
    );
    expect(classifyQuotaFailure(new Error('connection reset by peer'))).toBeNull();
  });

  it('treats a RATE_LIMIT (live 429) as retargetable — the failing turn gets rescued', () => {
    const rateLimit = new ApiError('429', {
      type: ApiErrorType.TRANSIENT,
      category: ApiErrorCategory.RATE_LIMIT,
      userMessage: 'x',
      technicalMessage: 'x',
      referenceId: 'ref',
      shouldRetry: true,
    });
    expect(classifyQuotaFailure(rateLimit)).toBe(ApiErrorCategory.RATE_LIMIT);
  });
});

describe('D12 category membership', () => {
  const err = (category: ApiErrorCategory): ApiError =>
    new ApiError('synthetic', {
      type: ApiErrorType.TRANSIENT,
      category,
      userMessage: 'x',
      technicalMessage: 'x',
      referenceId: 'ref',
      shouldRetry: true,
    });

  it.each([
    ApiErrorCategory.MODEL_NOT_FOUND,
    ApiErrorCategory.SERVER_ERROR,
    ApiErrorCategory.TIMEOUT,
    ApiErrorCategory.NETWORK,
    ApiErrorCategory.EMPTY_RESPONSE,
    ApiErrorCategory.CENSORED,
    ApiErrorCategory.CONTENT_POLICY,
  ])('%s is now retargetable (availability/censorship class)', category => {
    expect(classifyQuotaFailure(err(category))).toBe(category);
  });

  it.each([
    ApiErrorCategory.AUTHENTICATION,
    ApiErrorCategory.BAD_REQUEST,
    ApiErrorCategory.FREE_TIER_QUOTA,
  ])('%s NEVER retargets (actionable problems surface)', category => {
    expect(classifyQuotaFailure(err(category))).toBeNull();
  });

  it('the billing classifier stays narrow (auto-promotion announce policy)', () => {
    expect(classifyBillingQuotaFailure(err(ApiErrorCategory.RATE_LIMIT))).toBe(
      ApiErrorCategory.RATE_LIMIT
    );
    expect(classifyBillingQuotaFailure(err(ApiErrorCategory.MODEL_NOT_FOUND))).toBeNull();
    expect(classifyBillingQuotaFailure(err(ApiErrorCategory.SERVER_ERROR))).toBeNull();
  });

  it('cause-precedence stays narrow: a TIMEOUT symptom must not displace a 429 cause', () => {
    expect(isCausePrecedenceFailure(err(ApiErrorCategory.RATE_LIMIT))).toBe(true);
    expect(isCausePrecedenceFailure(err(ApiErrorCategory.MODEL_NOT_FOUND))).toBe(true);
    expect(isCausePrecedenceFailure(err(ApiErrorCategory.TIMEOUT))).toBe(false);
    expect(isCausePrecedenceFailure(err(ApiErrorCategory.SERVER_ERROR))).toBe(false);
  });
});

describe('selectFloorTarget (the D12 second hop)', () => {
  function caches(vetoModel?: string): QuotaFallbackCaches {
    return {
      creditExhaustion: { isCreditExhausted: vi.fn().mockResolvedValue({ exhausted: false }) },
      rateLimit: {
        isRateLimited: vi
          .fn()
          .mockImplementation(({ model }: { model: string }) =>
            Promise.resolve({ rateLimited: model === vetoModel })
          ),
      },
    } as unknown as QuotaFallbackCaches;
  }

  afterEach(() => resetSystemSettingsRegistration());

  function registerFloors(paid: string, free: string): void {
    registerSystemSettings({
      get: (key: string) =>
        key === 'fallbackTextModel' ? paid : key === 'fallbackTextModelFree' ? free : undefined,
    } as unknown as SystemSettingsService);
  }

  it('paid users get the LIVE fallbackTextModel (divergent-from-fallback value)', async () => {
    registerFloors('divergent/paid-floor', 'divergent/free:free');
    const target = await selectFloorTarget({
      isGuestMode: false,
      excludeModels: ['a/b', 'c/d'],
      cacheKeyId: 'user:1',
      caches: caches(),
    });
    expect(target?.config.model).toBe('divergent/paid-floor');
    expect(target?.forceSystemKey).toBe(false);
  });

  it('guests get the FREE floor; a non-free bag value degrades to the static router (billing firewall)', async () => {
    registerFloors('divergent/paid-floor', 'paid/sneaky');
    const target = await selectFloorTarget({
      isGuestMode: true,
      excludeModels: [],
      cacheKeyId: 'system',
      caches: caches(),
    });
    expect(target?.config.model).toBe('openrouter/free');
  });

  it('returns null when the floor is already among the failed models (dedup)', async () => {
    registerFloors('divergent/paid-floor', 'divergent/free:free');
    const target = await selectFloorTarget({
      isGuestMode: false,
      excludeModels: ['divergent/paid-floor'],
      cacheKeyId: 'user:1',
      caches: caches(),
    });
    expect(target).toBeNull();
  });

  it('returns null on an empty-string floor (belt-and-braces over the write validator)', async () => {
    registerFloors('', 'divergent/free:free');
    const target = await selectFloorTarget({
      isGuestMode: false,
      excludeModels: [],
      cacheKeyId: 'user:1',
      caches: caches(),
    });
    expect(target).toBeNull();
  });

  it('returns null when the doom cache vetoes the floor', async () => {
    registerFloors('divergent/paid-floor', 'divergent/free:free');
    const target = await selectFloorTarget({
      isGuestMode: false,
      excludeModels: [],
      cacheKeyId: 'user:1',
      caches: caches('divergent/paid-floor'),
    });
    expect(target).toBeNull();
  });
});
