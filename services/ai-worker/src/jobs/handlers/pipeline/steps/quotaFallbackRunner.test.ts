import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiErrorCategory, ApiErrorType } from '@tzurot/common-types/constants/error';
import { ApiError } from '../../../../utils/apiErrorParser.js';
import { getFallbackFailureSummary, type GenerateAttemptOpts } from './autoPromotionFallback.js';
import {
  composeQuotaFallbackInfo,
  runWithQuotaFallback,
  type QuotaFallbackDeps,
} from './quotaFallbackRunner.js';
import { type QuotaFallbackInfo } from '../../../../services/quotaFallback.js';

function quotaError(category: ApiErrorCategory): ApiError {
  return new ApiError(`synthetic ${category}`, {
    type: ApiErrorType.PERMANENT,
    category,
    userMessage: 'x',
    technicalMessage: 'x',
    referenceId: 'ref',
    shouldRetry: false,
  });
}

function buildOpts(overrides?: Partial<GenerateAttemptOpts>): GenerateAttemptOpts {
  return {
    personality: {
      id: 'p1',
      name: 'Testy',
      model: 'expensive/primary',
      temperature: 0.9,
    } as unknown as GenerateAttemptOpts['personality'],
    message: 'hello',
    conversationContext: {} as GenerateAttemptOpts['conversationContext'],
    recentAssistantMessages: [],
    apiKey: 'sk-user-key',
    sttDispatch: undefined,
    isGuestMode: false,
    jobId: 'job-1',
    ...overrides,
  };
}

function buildDeps(overrides?: {
  global?: { model: string } | null;
  free?: { model: string } | null;
  systemKey?: string | undefined;
  userOpenRouterKey?: string | undefined;
}): QuotaFallbackDeps {
  return {
    configResolver: {
      getFreeDefaultConfig: vi.fn().mockResolvedValue(overrides?.free ?? null),
      getGlobalDefaultConfig: vi.fn().mockResolvedValue(overrides?.global ?? null),
    } as unknown as QuotaFallbackDeps['configResolver'],
    caches: {
      creditExhaustion: { isCreditExhausted: vi.fn().mockResolvedValue({ exhausted: false }) },
      rateLimit: { isRateLimited: vi.fn().mockResolvedValue({ rateLimited: false }) },
    } as unknown as QuotaFallbackDeps['caches'],
    resolveSystemKey: vi
      .fn()
      .mockResolvedValue(
        overrides !== undefined && 'systemKey' in overrides ? overrides.systemKey : 'sk-system-key'
      ),
    resolveUserOpenRouterKey: vi
      .fn()
      .mockResolvedValue(
        overrides !== undefined && 'userOpenRouterKey' in overrides
          ? overrides.userOpenRouterKey
          : 'sk-user-or-key'
      ),
  };
}

const okResult = {
  response: { content: 'ok' },
  duplicateRetries: 0,
  emptyRetries: 0,
  leakedThinkingRetries: 0,
} as never;

describe('runWithQuotaFallback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.restoreAllMocks());

  it('passes through untouched when deps are not wired (test fixtures)', async () => {
    const primary = vi.fn().mockResolvedValue(okResult);
    const retry = vi.fn();

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(),
      userId: '123',
      deps: undefined,
    });

    expect(result).toBe(okResult);
    expect(retry).not.toHaveBeenCalled();
  });

  it('rethrows non-quota failures without retargeting', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('connection reset by peer'));
    const retry = vi.fn();

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      })
    ).rejects.toThrow('connection reset');
    expect(retry).not.toHaveBeenCalled();
  });

  it('QUOTA_EXCEEDED + BYOK: retries once on the global default with the OWN key and reports the swap', async () => {
    const original = quotaError(ApiErrorCategory.QUOTA_EXCEEDED);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockResolvedValue(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(),
      userId: '123',
      deps: buildDeps({ global: { model: 'paid/default', temperature: 0.5 } as never }),
    });

    // Seam assertion: the retry received the retargeted personality + unchanged key.
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-user-key',
        isGuestMode: false,
        personality: expect.objectContaining({ model: 'paid/default', temperature: 0.5 }),
      })
    );
    expect(result.quotaFallback).toEqual({
      fromModel: 'expensive/primary',
      toModel: 'paid/default',
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      mode: 'reactive',
    });
    // The footer badge must reflect the provider that actually served it.
    expect(result.effectiveProviderUsed).toBe('openrouter');
  });

  it('RATE_LIMIT: rescues the FAILING turn by retargeting to the default model (same key)', async () => {
    // The user's personal model 429s — the turn itself must degrade to the
    // global default rather than only subsequent turns (the proactive path).
    const original = quotaError(ApiErrorCategory.RATE_LIMIT);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockResolvedValue(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(),
      userId: '123',
      deps: buildDeps({ global: { model: 'paid/default' } }),
    });

    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-user-key',
        personality: expect.objectContaining({ model: 'paid/default' }),
      })
    );
    expect(result.quotaFallback).toEqual({
      fromModel: 'expensive/primary',
      toModel: 'paid/default',
      category: ApiErrorCategory.RATE_LIMIT,
      mode: 'reactive',
    });
  });

  it('CREDIT_EXHAUSTION + BYOK: retries on the free default with the SYSTEM key in guest semantics', async () => {
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.CREDIT_EXHAUSTION));
    const retry = vi.fn().mockResolvedValue(okResult);

    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(),
      userId: '123',
      deps: buildDeps({ free: { model: 'free/model' }, systemKey: 'sk-system-key' }),
    });

    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-system-key',
        isGuestMode: true,
        personality: expect.objectContaining({ model: 'free/model' }),
      })
    );
  });

  it('rethrows the original when the forced system key is unavailable', async () => {
    const original = quotaError(ApiErrorCategory.CREDIT_EXHAUSTION);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn();

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        deps: buildDeps({ free: { model: 'free/model' }, systemKey: undefined }),
      })
    ).rejects.toBe(original);
    expect(retry).not.toHaveBeenCalled();
  });

  it('both-fail: propagates the PRISTINE original with the retry failure attached out-of-band', async () => {
    const original = quotaError(ApiErrorCategory.QUOTA_EXCEEDED);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockRejectedValue(new Error('fallback also broke'));

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      })
    ).rejects.toBe(original);
    // Message untouched (classification runs on regexes over it)...
    expect(original.message).toBe('synthetic quota_exceeded');
    // ...but the second failure rides out-of-band for the composer.
    expect(getFallbackFailureSummary(original)).toContain('fallback also broke');
  });

  it('z.ai-promoted personality: retry swaps to OpenRouter provider AND the user OpenRouter key', async () => {
    // The motivating incident's population: provider='zai-coding' means the
    // failing attempt ran on the user's z.ai key — the OpenRouter retarget
    // must not reuse it, and must rewrite the provider with the model.
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.QUOTA_EXCEEDED));
    const retry = vi.fn().mockResolvedValue(okResult);

    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({
        personality: {
          id: 'p1',
          name: 'Testy',
          model: 'glm-5.2',
          provider: 'zai-coding',
        } as unknown as GenerateAttemptOpts['personality'],
        apiKey: 'sk-zai-key',
      }),
      userId: '123',
      deps: buildDeps({ global: { model: 'paid/default' }, userOpenRouterKey: 'sk-user-or-key' }),
    });

    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-user-or-key',
        personality: expect.objectContaining({ model: 'paid/default', provider: 'openrouter' }),
        // The separately-tracked provider tier follows the retarget too —
        // it drives the context-window clamp and vision auth downstream.
        effectiveProvider: 'openrouter',
      })
    );
  });

  it('z.ai-promoted personality without an OpenRouter key: degrades to the FREE default on the system key', async () => {
    // Degraded-beats-failed (owner policy): the paid retarget can't ride the
    // system key, but the FREE default can — the turn must still work.
    // (Previously terminal; that expectation left z.ai-only users with a
    // failed request instead of a degraded one.)
    const original = quotaError(ApiErrorCategory.QUOTA_EXCEEDED);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockResolvedValue({
      response: { content: 'rescued' },
      duplicateRetries: 0,
      emptyRetries: 0,
      leakedThinkingRetries: 0,
    });

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({
        personality: {
          id: 'p1',
          name: 'Testy',
          model: 'glm-5.2',
          provider: 'zai-coding',
        } as unknown as GenerateAttemptOpts['personality'],
        apiKey: 'sk-zai-key',
      }),
      userId: '123',
      deps: buildDeps({
        global: { model: 'paid/default' },
        free: { model: 'free/default' },
        systemKey: 'sk-system-key',
        userOpenRouterKey: undefined,
      }),
    });

    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-system-key',
        isGuestMode: true,
        personality: expect.objectContaining({ model: 'free/default' }),
      })
    );
    expect(result.quotaFallback?.toModel).toBe('free/default');
  });

  it('z.ai-promoted personality without OpenRouter key AND no system key: terminal', async () => {
    const original = quotaError(ApiErrorCategory.QUOTA_EXCEEDED);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn();

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts({
          personality: {
            id: 'p1',
            name: 'Testy',
            model: 'glm-5.2',
            provider: 'zai-coding',
          } as unknown as GenerateAttemptOpts['personality'],
          apiKey: 'sk-zai-key',
        }),
        userId: '123',
        deps: buildDeps({
          global: { model: 'paid/default' },
          free: { model: 'free/default' },
          systemKey: undefined,
          userOpenRouterKey: undefined,
        }),
      })
    ).rejects.toBe(original);
    expect(retry).not.toHaveBeenCalled();
  });

  it('merges an earlier auto-promotion failure summary instead of clobbering it (triple failure)', async () => {
    const original = quotaError(ApiErrorCategory.QUOTA_EXCEEDED);
    // Simulate the auto-promotion wrapper having already attached its
    // both-fail summary to the SAME error object.
    const { attachFallbackFailure } = await import('./autoPromotionFallback.js');
    attachFallbackFailure(original, {
      summary: 'openrouter route also failed',
      provider: 'OpenRouter',
    });

    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockRejectedValue(new Error('quota retry broke too'));

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      })
    ).rejects.toBe(original);

    const summary = getFallbackFailureSummary(original);
    expect(summary).toContain('openrouter route also failed');
    expect(summary).toContain('quota retry broke too');
  });

  it('a THROWING credential dep still propagates the pristine original (never replaces it)', async () => {
    // The deps are never-throwing by contract, but the seam is injectable —
    // resolveRetryCredentials runs inside the catch block, so a throw there
    // would otherwise replace the original quota error.
    const original = quotaError(ApiErrorCategory.CREDIT_EXHAUSTION);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn();
    const deps = buildDeps({ free: { model: 'free/model' } });
    deps.resolveSystemKey = vi.fn().mockRejectedValue(new Error('resolver blew up'));

    await expect(
      runWithQuotaFallback({ primary, retry, opts: buildOpts(), userId: '123', deps })
    ).rejects.toBe(original);
    expect(retry).not.toHaveBeenCalled();
  });

  it('rethrows the original when no target exists (no admin default configured)', async () => {
    const original = quotaError(ApiErrorCategory.QUOTA_EXCEEDED);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn();

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        deps: buildDeps({}),
      })
    ).rejects.toBe(original);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('composeQuotaFallbackInfo', () => {
  const proactive: QuotaFallbackInfo = {
    fromModel: 'configured/original',
    toModel: 'intermediate/hop',
    category: ApiErrorCategory.QUOTA_EXCEEDED,
    mode: 'proactive',
  };
  const reactive: QuotaFallbackInfo = {
    fromModel: 'intermediate/hop',
    toModel: 'final/target',
    category: ApiErrorCategory.CREDIT_EXHAUSTION,
    mode: 'reactive',
  };

  it('double-hop traces back to the ORIGINAL configured model', () => {
    expect(composeQuotaFallbackInfo(reactive, proactive)).toEqual({
      fromModel: 'configured/original',
      toModel: 'final/target',
      category: ApiErrorCategory.CREDIT_EXHAUSTION,
      mode: 'reactive',
    });
  });

  it('passes a single hook through unchanged', () => {
    expect(composeQuotaFallbackInfo(reactive, undefined)).toBe(reactive);
    expect(composeQuotaFallbackInfo(undefined, proactive)).toBe(proactive);
    expect(composeQuotaFallbackInfo(undefined, undefined)).toBeUndefined();
  });
});
