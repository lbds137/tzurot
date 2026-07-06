import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiErrorCategory, ApiErrorType } from '@tzurot/common-types/constants/error';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { ApiError } from '../utils/apiErrorParser.js';
import { RetryError } from '../utils/retry.js';
import {
  applyConfigToPersonality,
  checkModelViability,
  classifyQuotaFailure,
  selectQuotaFallbackTarget,
  type QuotaFallbackCaches,
} from './quotaFallback.js';

function buildCaches(overrides?: {
  exhausted?: boolean;
  rateLimitedModels?: string[];
}): QuotaFallbackCaches {
  const rateLimitedModels = overrides?.rateLimitedModels ?? [];
  return {
    creditExhaustion: {
      isCreditExhausted: vi
        .fn()
        .mockResolvedValue(
          overrides?.exhausted === true
            ? { exhausted: true, exhaustedAtMs: 0, ttlSeconds: 60 }
            : { exhausted: false }
        ),
    },
    rateLimit: {
      isRateLimited: vi
        .fn()
        .mockImplementation(({ model }: { model: string }) =>
          Promise.resolve(
            rateLimitedModels.includes(model) ? { rateLimited: true } : { rateLimited: false }
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
      configResolver: buildResolver({ free: { model: 'free/model' } }) as never,
      caches: buildCaches(),
    });
    expect(target).toBeNull();
  });

  it('CREDIT_EXHAUSTION + BYOK → free default with forced system key', async () => {
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      isGuestMode: false,
      configResolver: buildResolver({ free: { model: 'free/model' } }) as never,
      caches: buildCaches(),
    });
    expect(target?.config.model).toBe('free/model');
    expect(target?.forceSystemKey).toBe(true);
  });

  it('CREDIT_EXHAUSTION + BYOK skips the exhaustion check on the target (different billing entity)', async () => {
    // The user's account IS marked exhausted — but the forced-system-key
    // retry bills a different account, so the mark must not veto the target.
    const target = await selectQuotaFallbackTarget({
      ...base,
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      isGuestMode: false,
      configResolver: buildResolver({ free: { model: 'free/model' } }) as never,
      caches: buildCaches({ exhausted: true }),
    });
    expect(target?.forceSystemKey).toBe(true);
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
      configResolver: buildResolver({ free: { model: 'free/model' } }) as never,
      caches: buildCaches(),
    });
    expect(target?.config.model).toBe('free/model');
    expect(target?.forceSystemKey).toBe(false);
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
      model: 'free/model',
      temperature: 0.7,
      // topP/maxTokens/showThinking deliberately unset on the target config
    });

    expect(result.model).toBe('free/model');
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
});
