import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory, ApiErrorType } from '@tzurot/common-types/constants/error';
import { ApiError } from '../../../../utils/apiErrorParser.js';
import { getFallbackFailureSummary, type GenerateAttemptOpts } from './autoPromotionFallback.js';
import {
  composeQuotaFallbackInfo,
  runWithQuotaFallback,
  type QuotaFallbackDeps,
} from './quotaFallbackRunner.js';
import { type QuotaFallbackInfo } from '../../../../services/quotaFallback.js';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { type FreeTierRequestQuota } from '../../../../services/FreeTierRequestQuota.js';
import { RetryError } from '../../../../utils/retry.js';

// The bot owner (`owner-1`) bypasses the free-tier meter entirely.
vi.mock('@tzurot/common-types/utils/ownerMiddleware', () => ({
  isBotOwner: (id: string) => id === 'owner-1',
}));

// The hop-1 floor-promotion decision is observable ONLY through its log lines
// on the skip paths (the turn rethrows the original error either way), so the
// runner's logger is spied on. `importOriginal` keeps every other export of
// the logger module intact for the rest of the import graph.
const { mockLogger } = vi.hoisted(() => {
  const instance = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => instance,
  };
  return { mockLogger: instance };
});
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLogger: () => mockLogger,
}));

/** Mock free-tier quota; `allowed` drives whether the forced fallback proceeds. */
function mockQuota(allowed = true): FreeTierRequestQuota {
  return {
    tryConsume: vi.fn().mockResolvedValue({
      allowed,
      reason: allowed ? 'ok' : 'user',
      windowCap: 30,
      activeUsers: 0,
      userCount: 0,
      globalCount: 0,
    }),
  } as unknown as FreeTierRequestQuota;
}

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
  /** Catalog-presence probe for `isVetoedAsUnlistedTarget` — undefined means
   *  unwired (never vetoes), matching production's optional bag member. */
  catalogPresence?: (model: string) => Promise<boolean | null>;
}): QuotaFallbackDeps {
  return {
    configResolver: {
      getFreeDefaultConfig: vi.fn().mockResolvedValue(overrides?.free ?? null),
      getGlobalDefaultConfig: vi.fn().mockResolvedValue(overrides?.global ?? null),
    } as unknown as QuotaFallbackDeps['configResolver'],
    caches: {
      creditExhaustion: { isCreditExhausted: vi.fn().mockResolvedValue({ exhausted: false }) },
      rateLimit: { isRateLimited: vi.fn().mockResolvedValue({ rateLimited: false }) },
      ...(overrides?.catalogPresence !== undefined
        ? { catalogPresence: overrides.catalogPresence }
        : {}),
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
      requestId: 'req-1',
      deps: undefined,
    });

    expect(result).toBe(okResult);
    expect(retry).not.toHaveBeenCalled();
  });

  describe('inherited category from a proactive demotion (the cached-429 dead end)', () => {
    // Reproduces an observed prod dead end. Three tiers exist: z.ai-direct,
    // the OpenRouter same-model passthrough, and this reactive retarget. A
    // model that ships on z.ai before OpenRouter makes tier 2 a guaranteed 400
    // (`... is not a valid model ID`).
    //
    // Turn A (429 arrives LIVE): the rate-limit error reaches this gate,
    // classifies, the retarget fires, the user gets a response.
    // Turn B (429 comes from the RateLimitCache): AuthStep demotes straight to
    // tier 2, so no quota error is ever produced — the only error this gate
    // ever sees is whatever the demoted route returned.
    //
    // TWO independent mechanisms rescue Turn B, pinned separately below. The
    // classifier recognizes the staggered-release wording itself, so that
    // specific 400 carries MODEL_NOT_FOUND — a retargetable category — and
    // retargets on its own. The inherited category is the GENERAL mechanism,
    // and the only one that helps when the demoted route's failure classifies
    // as nothing at all.
    //
    // The user is equally rate-limited in both. The outcome differed only by
    // whether we had cached the fact.
    const staggeredReleaseError = new Error('z-ai/glm-5.3 is not a valid model ID');

    it('retargets on the staggered-release 400 alone, with no inherited category', async () => {
      // The production Turn-B error, standalone: the classifier recognizes the
      // wording, so it arrives as MODEL_NOT_FOUND and the gate opens without
      // the demotion having carried anything.
      const primary = vi.fn().mockRejectedValue(staggeredReleaseError);
      const retry = vi.fn().mockResolvedValue(okResult);

      const result = await runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(), // no inheritedQuotaCategory
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      });

      expect(result.quotaFallback).toMatchObject({
        toModel: 'paid/default',
        category: ApiErrorCategory.MODEL_NOT_FOUND,
        mode: 'reactive',
      });
    });

    it('dead-ends on an unclassifiable failure with no inherited category', async () => {
      // What the gate still guards, and what the old staggered-release fixture
      // stood for before the classifier learned its wording: an error that
      // classifies as nothing, on a turn that inherited nothing, has no reason
      // to retarget.
      const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.AUTHENTICATION));
      const retry = vi.fn();

      await expect(
        runWithQuotaFallback({
          primary,
          retry,
          opts: buildOpts(), // no inheritedQuotaCategory
          userId: '123',
          requestId: 'req-1',
          deps: buildDeps({ global: { model: 'paid/default' } }),
        })
      ).rejects.toThrow('synthetic authentication');
      expect(retry).not.toHaveBeenCalled();
    });

    it('retargets when the demotion carried the rate-limit category (the fix)', async () => {
      // Unclassifiable downstream failure — the inherited category is the only
      // thing that can open the gate here.
      const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.AUTHENTICATION));
      const retry = vi.fn().mockResolvedValue(okResult);

      const result = await runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts({ inheritedQuotaCategory: ApiErrorCategory.RATE_LIMIT }),
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      });

      expect(retry).toHaveBeenCalledWith(
        expect.objectContaining({
          personality: expect.objectContaining({ model: 'paid/default' }),
        })
      );
      expect(result.quotaFallback).toMatchObject({
        toModel: 'paid/default',
        category: ApiErrorCategory.RATE_LIMIT,
        mode: 'reactive',
      });
    });

    it('files the staggered-release 400 under its LIVE category, not the inherited one', async () => {
      // Both mechanisms are live at once on the real Turn B: the demotion
      // carried RATE_LIMIT and the error classifies as MODEL_NOT_FOUND. The
      // live reading wins, so the footer names why THIS attempt failed rather
      // than why the route was demoted.
      const primary = vi.fn().mockRejectedValue(staggeredReleaseError);
      const retry = vi.fn().mockResolvedValue(okResult);

      const result = await runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts({ inheritedQuotaCategory: ApiErrorCategory.RATE_LIMIT }),
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      });

      expect(result.quotaFallback).toMatchObject({
        category: ApiErrorCategory.MODEL_NOT_FOUND,
      });
    });

    it('prefers the LIVE classification over the inherited one', async () => {
      // The inherited category is a floor, not an override — an error that
      // describes itself wins, or a credit-exhaustion downstream of a
      // rate-limit demotion would be filed under the wrong reason.
      const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.QUOTA_EXCEEDED));
      const retry = vi.fn().mockResolvedValue(okResult);

      const result = await runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts({ inheritedQuotaCategory: ApiErrorCategory.RATE_LIMIT }),
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      });

      expect(result.quotaFallback).toMatchObject({
        category: ApiErrorCategory.QUOTA_EXCEEDED,
      });
    });
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
        requestId: 'req-1',
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
      requestId: 'req-1',
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
      requestId: 'req-1',
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
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' }, systemKey: 'sk-system-key' }),
    });

    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-system-key',
        isGuestMode: true,
        personality: expect.objectContaining({ model: 'freebie/model:free' }),
      })
    );
  });

  it('meters the credit-exhausted BYOK → shared-system-key transition exactly once', async () => {
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.CREDIT_EXHAUSTION));
    const retry = vi.fn().mockResolvedValue(okResult);
    const freeTierQuota = mockQuota(true);

    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(), // isGuestMode: false (BYOK)
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' }, systemKey: 'sk-system-key' }),
      freeTierQuota,
    });

    // Metered once, keyed by userId + jobId (jobId is the retry-stable idempotency member).
    expect(freeTierQuota.tryConsume).toHaveBeenCalledTimes(1);
    expect(freeTierQuota.tryConsume).toHaveBeenCalledWith('123', 'req-1');
    expect(retry).toHaveBeenCalled(); // allowed → fallback proceeds
  });

  it('over-quota on the forced fallback surfaces the ORIGINAL error (top-up), not a free-tier one', async () => {
    const original = quotaError(ApiErrorCategory.CREDIT_EXHAUSTION);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockResolvedValue(okResult);
    const freeTierQuota = mockQuota(false); // over the shared-key share

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ free: { model: 'freebie/model:free' }, systemKey: 'sk-system-key' }),
        freeTierQuota,
      })
    ).rejects.toBe(original);

    expect(retry).not.toHaveBeenCalled(); // fallback aborted — the shared key is not spent
  });

  it('does NOT meter the bot owner on the forced fallback (owner bypass)', async () => {
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.CREDIT_EXHAUSTION));
    const retry = vi.fn().mockResolvedValue(okResult);
    const freeTierQuota = mockQuota(true);

    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(), // BYOK → would meter, but the owner is exempt
      userId: 'owner-1',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' }, systemKey: 'sk-system-key' }),
      freeTierQuota,
    });

    expect(freeTierQuota.tryConsume).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalled(); // the fallback still proceeds, just unmetered
  });

  it('meters a z.ai free-tier GUEST degrading onto the OpenRouter pool (its first charge there)', async () => {
    // A zai-upgraded guest billed the CODING-PLAN pool at admission, so
    // GenerationStep skipped the OpenRouter meter — the mid-turn degrade is
    // that pool's first and only charge for this request.
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.RATE_LIMIT));
    const retry = vi.fn().mockResolvedValue(okResult);
    const freeTierQuota = mockQuota(true);

    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({ isGuestMode: true, effectiveProvider: AIProvider.ZaiCoding }),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' } }),
      freeTierQuota,
    });

    expect(freeTierQuota.tryConsume).toHaveBeenCalledTimes(1);
    expect(freeTierQuota.tryConsume).toHaveBeenCalledWith('123', 'req-1');
    expect(retry).toHaveBeenCalled();
  });

  it('does NOT double-meter a plain OpenRouter guest retarget (GenerationStep already charged it)', async () => {
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.RATE_LIMIT));
    const retry = vi.fn().mockResolvedValue(okResult);
    const freeTierQuota = mockQuota(true);

    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({ isGuestMode: true, effectiveProvider: AIProvider.OpenRouter }),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' } }),
      freeTierQuota,
    });

    expect(freeTierQuota.tryConsume).not.toHaveBeenCalled();
  });

  it('fires the z.ai failure reactor with the ORIGINAL error before any retarget', async () => {
    const original = quotaError(ApiErrorCategory.RATE_LIMIT);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockResolvedValue(okResult);
    const onZaiFreeTierFailure = vi.fn().mockResolvedValue(undefined);

    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({ isGuestMode: true, effectiveProvider: AIProvider.ZaiCoding }),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' } }),
      freeTierQuota: mockQuota(true),
      onZaiFreeTierFailure,
    });

    expect(onZaiFreeTierFailure).toHaveBeenCalledWith(original);
    expect(retry).toHaveBeenCalled(); // a throwing reactor must never block the degrade
  });

  it('does not fire the reactor for non-z.ai failures', async () => {
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.RATE_LIMIT));
    const retry = vi.fn().mockResolvedValue(okResult);
    const onZaiFreeTierFailure = vi.fn();

    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({ isGuestMode: false }),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ global: { model: 'paid/default' } }),
      onZaiFreeTierFailure,
    });

    expect(onZaiFreeTierFailure).not.toHaveBeenCalled();
  });

  it('does NOT meter a pure guest (already metered upstream in GenerationStep) — no double-count', async () => {
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.CREDIT_EXHAUSTION));
    const retry = vi.fn().mockResolvedValue(okResult);
    const freeTierQuota = mockQuota(true);

    // isGuestMode: true → the transition guard (`!opts.isGuestMode`) is false, so
    // the site-2 meter never fires regardless of whether a retarget happens.
    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({ isGuestMode: true }),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' }, systemKey: 'sk-system-key' }),
      freeTierQuota,
    }).catch(() => undefined);

    expect(freeTierQuota.tryConsume).not.toHaveBeenCalled();
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
        requestId: 'req-1',
        deps: buildDeps({ free: { model: 'freebie/model:free' }, systemKey: undefined }),
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
        requestId: 'req-1',
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
      requestId: 'req-1',
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
      requestId: 'req-1',
      deps: buildDeps({
        global: { model: 'paid/default' },
        free: { model: 'freebie/default:free' },
        systemKey: 'sk-system-key',
        userOpenRouterKey: undefined,
      }),
    });

    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-system-key',
        isGuestMode: true,
        personality: expect.objectContaining({ model: 'freebie/default:free' }),
      })
    );
    expect(result.quotaFallback?.toModel).toBe('freebie/default:free');
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
        requestId: 'req-1',
        deps: buildDeps({
          global: { model: 'paid/default' },
          free: { model: 'freebie/default:free' },
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
        requestId: 'req-1',
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
    const deps = buildDeps({ free: { model: 'freebie/model:free' } });
    deps.resolveSystemKey = vi.fn().mockRejectedValue(new Error('resolver blew up'));

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        requestId: 'req-1',
        deps,
      })
    ).rejects.toBe(original);
    expect(retry).not.toHaveBeenCalled();
  });

  it('a catalog-vetoed tiered target falls through to the floor (the runner never exercised catalogPresence before this test)', async () => {
    // buildDeps() never populated `catalogPresence`, so the veto path in
    // `selectQuotaFallbackTarget` (isVetoedAsUnlistedTarget) went completely
    // untested end-to-end through the runner. A vetoed tiered target makes
    // `selectQuotaFallbackTarget` return null exactly like "no admin
    // default" — the runner code path is identical either way — so this
    // mirrors the hop-1 floor-promotion cascade: the floor is promoted and
    // the retry lands on it, never on the vetoed admin default.
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.MODEL_NOT_FOUND));
    const retry = vi.fn().mockResolvedValue(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(), // no inheritedQuotaCategory; default model 'expensive/primary'
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({
        global: { model: 'paid/default' },
        catalogPresence: vi
          .fn()
          .mockImplementation((model: string) =>
            Promise.resolve(model === 'paid/default' ? false : null)
          ),
      }),
    });

    // The vetoed admin default never crosses the invocation seam — the
    // static paid floor (openrouter/auto, unregistered in this describe) does.
    expect(retry).toHaveBeenCalledTimes(1);
    const hop1Opts = retry.mock.calls[0][0] as GenerateAttemptOpts;
    expect(hop1Opts.personality.model).toBe('openrouter/auto');
    expect(result.quotaFallback).toMatchObject({
      toModel: 'openrouter/auto',
      category: ApiErrorCategory.MODEL_NOT_FOUND,
      mode: 'reactive',
    });
  });

  it('rethrows the original when NOTHING is attemptable (no admin default, floor vetoed)', async () => {
    // No admin default alone is no longer terminal — the floor is promoted to
    // hop 1 (see the "hop-1 floor promotion" suite). Terminal now requires the
    // floor to be unavailable too, so the doom cache vetoes it here.
    const original = quotaError(ApiErrorCategory.QUOTA_EXCEEDED);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn();
    const deps = buildDeps({});
    (deps.caches.rateLimit.isRateLimited as ReturnType<typeof vi.fn>).mockResolvedValue({
      rateLimited: true,
    });

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        requestId: 'req-1',
        deps,
      })
    ).rejects.toBe(original);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('D12 availability-class entry + two-hop floor descent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Divergent-from-fallback floors prove the LIVE setting reads.
    registerSystemSettings({
      get: (key: string) =>
        key === 'fallbackTextModel'
          ? 'divergent/paid-floor'
          : key === 'fallbackTextModelFree'
            ? 'divergent/free-floor:free'
            : undefined,
    } as unknown as SystemSettingsService);
  });
  afterEach(() => {
    resetSystemSettingsRegistration();
    vi.restoreAllMocks();
  });

  it('an availability-class failure (SERVER_ERROR) now enters the retarget', async () => {
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.SERVER_ERROR));
    const retry = vi.fn().mockResolvedValue(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ global: { model: 'paid/default' } }),
    });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.quotaFallback).toEqual({
      fromModel: 'expensive/primary',
      toModel: 'paid/default',
      category: ApiErrorCategory.SERVER_ERROR,
      mode: 'reactive',
    });
  });

  it('hop 2: a retargetable hop-1 failure descends to the LIVE paid floor (BYOK)', async () => {
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.SERVER_ERROR));
    const retry = vi
      .fn()
      .mockRejectedValueOnce(quotaError(ApiErrorCategory.TIMEOUT))
      .mockResolvedValueOnce(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ global: { model: 'paid/default' } }),
    });

    expect(retry).toHaveBeenCalledTimes(2);
    // Hop-2 runs on the floor personality (full-param swap via applyConfigToPersonality).
    const hop2Opts = retry.mock.calls[1][0] as GenerateAttemptOpts;
    expect(hop2Opts.personality.model).toBe('divergent/paid-floor');
    // The footer traces the ORIGINAL model + ORIGINAL category, not the hop chain.
    expect(result.quotaFallback).toEqual({
      fromModel: 'expensive/primary',
      toModel: 'divergent/paid-floor',
      category: ApiErrorCategory.SERVER_ERROR,
      mode: 'reactive',
    });
  });

  it('guest hop 2 descends to the FREE floor, never the paid one', async () => {
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.EMPTY_RESPONSE));
    const retry = vi
      .fn()
      .mockRejectedValueOnce(quotaError(ApiErrorCategory.SERVER_ERROR))
      .mockResolvedValueOnce(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({ isGuestMode: true, apiKey: 'sk-system-key' }),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' } }),
    });

    const hop2Opts = retry.mock.calls[1][0] as GenerateAttemptOpts;
    expect(hop2Opts.personality.model).toBe('divergent/free-floor:free');
    expect(result.quotaFallback?.toModel).toBe('divergent/free-floor:free');
  });

  it("a guest failure's viability checks run under the system bucket, not user:<id>", async () => {
    // A guest attempt carries the SYSTEM key as a plain string — identity
    // must follow route provenance, or the reactive path reads a bucket the
    // invocation path never writes (the doom marks land under `system`).
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.QUOTA_EXCEEDED));
    const retry = vi.fn().mockResolvedValue(okResult);
    const deps = buildDeps({ free: { model: 'freebie/model:free' } });

    await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({ isGuestMode: true, apiKey: 'sk-system-key' }),
      userId: '123',
      requestId: 'req-1',
      deps,
    });

    expect(deps.caches.rateLimit.isRateLimited).toHaveBeenCalledWith({
      cacheKeyId: 'system',
      model: 'freebie/model:free',
    });
    expect(deps.caches.rateLimit.isRateLimited).not.toHaveBeenCalledWith(
      expect.objectContaining({ cacheKeyId: 'user:123' })
    );
  });

  it('hop 2 after a forced entity swap checks the floor under the SYSTEM bucket (the credentials hop-1 actually swapped to)', async () => {
    // BYOK credit exhaustion → hop-1 forced onto the system key. The floor
    // hop reuses those credentials, so its doom-cache read must use the
    // post-swap identity — the pre-retarget user bucket no longer describes
    // the route (its 429s are written under `system`).
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.CREDIT_EXHAUSTION));
    const retry = vi
      .fn()
      .mockRejectedValueOnce(quotaError(ApiErrorCategory.SERVER_ERROR))
      .mockResolvedValueOnce(okResult);
    const deps = buildDeps({ free: { model: 'freebie/model:free' } });

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(), // BYOK: isGuestMode false, user's own key
      userId: '123',
      requestId: 'req-1',
      deps,
    });

    expect(result.quotaFallback?.toModel).toBe('divergent/free-floor:free');
    expect(deps.caches.rateLimit.isRateLimited).toHaveBeenCalledWith({
      cacheKeyId: 'system',
      model: 'divergent/free-floor:free',
    });
    expect(deps.caches.rateLimit.isRateLimited).not.toHaveBeenCalledWith(
      expect.objectContaining({ cacheKeyId: 'user:123', model: 'divergent/free-floor:free' })
    );
  });

  it('hop 2 is skipped when the floor equals the hop-1 target (dedup) — original propagates', async () => {
    const original = quotaError(ApiErrorCategory.SERVER_ERROR);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.TIMEOUT));

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ global: { model: 'divergent/paid-floor' } }),
      })
    ).rejects.toBe(original);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('hop 2 is skipped when the hop-1 failure is NOT retargetable (auth surfaces the fix)', async () => {
    const original = quotaError(ApiErrorCategory.QUOTA_EXCEEDED);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.AUTHENTICATION));

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      })
    ).rejects.toBe(original);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('an INHERITED-category turn still reaches the floor on an unclassifiable hop-1 failure', async () => {
    // The demoted route's failure classifies as nothing and the hop-1
    // target's failure is unclassifiable too — but the user is demonstrably
    // rate-limited (that is why the demotion fired), so the floor stays
    // reachable.
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.AUTHENTICATION));
    const retry = vi
      .fn()
      .mockRejectedValueOnce(quotaError(ApiErrorCategory.AUTHENTICATION))
      .mockResolvedValueOnce(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({ inheritedQuotaCategory: ApiErrorCategory.RATE_LIMIT }),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ global: { model: 'paid/default' } }),
    });

    expect(retry).toHaveBeenCalledTimes(2);
    const hop2Opts = retry.mock.calls[1][0] as GenerateAttemptOpts;
    expect(hop2Opts.personality.model).toBe('divergent/paid-floor');
    expect(result.quotaFallback).toEqual({
      fromModel: 'expensive/primary',
      toModel: 'divergent/paid-floor',
      category: ApiErrorCategory.RATE_LIMIT,
      mode: 'reactive',
    });
  });

  it('a LIVE-classified turn keeps the gate: an unclassifiable hop-1 failure stays terminal', async () => {
    const original = quotaError(ApiErrorCategory.RATE_LIMIT);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.AUTHENTICATION));

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(), // no inheritedQuotaCategory — the category is live
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      })
    ).rejects.toBe(original);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('hop 2 is vetoed by the doom cache (floor already rate-limited for this scope)', async () => {
    const original = quotaError(ApiErrorCategory.SERVER_ERROR);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.TIMEOUT));
    const deps = buildDeps({ global: { model: 'paid/default' } });
    (deps.caches.rateLimit.isRateLimited as ReturnType<typeof vi.fn>).mockImplementation(
      ({ model }: { model: string }) =>
        Promise.resolve({ rateLimited: model === 'divergent/paid-floor' })
    );

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        requestId: 'req-1',
        deps,
      })
    ).rejects.toBe(original);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('a THROWING floor selection degrades to not-attempted — the pristine original still propagates', async () => {
    const original = quotaError(ApiErrorCategory.SERVER_ERROR);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.TIMEOUT));
    const deps = buildDeps({ global: { model: 'paid/default' } });
    (deps.caches.rateLimit.isRateLimited as ReturnType<typeof vi.fn>).mockImplementation(
      ({ model }: { model: string }) =>
        model === 'divergent/paid-floor'
          ? Promise.reject(new Error('redis exploded'))
          : Promise.resolve({ rateLimited: false })
    );

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        requestId: 'req-1',
        deps,
      })
    ).rejects.toBe(original);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('three-failure turn: pristine original propagates with BOTH rescue failures merged once each', async () => {
    const original = quotaError(ApiErrorCategory.SERVER_ERROR);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi
      .fn()
      .mockRejectedValueOnce(quotaError(ApiErrorCategory.TIMEOUT))
      .mockRejectedValueOnce(quotaError(ApiErrorCategory.NETWORK));

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(),
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ global: { model: 'paid/default' } }),
      })
    ).rejects.toBe(original);

    expect(retry).toHaveBeenCalledTimes(2);
    // First merge is bare (single-hop composer contract); the floor hop is
    // labeled. Each failure appears exactly once — no double-merge.
    const summary = getFallbackFailureSummary(original);
    expect(summary).toBe(
      'synthetic timeout; quota-fallback retry (divergent/paid-floor) also failed: synthetic network'
    );
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

  it('lets a reactive failure outrank a guest-mode substitution on the same turn', () => {
    // A guest request whose free model then failed: the footer must report
    // the FAILURE reason, not "guest mode" — and still trace back to the
    // model the user actually configured.
    const guest: QuotaFallbackInfo = {
      fromModel: 'configured/paid',
      toModel: 'free/default',
      category: 'guest_mode',
      mode: 'proactive',
    };
    const reactiveAfterGuest: QuotaFallbackInfo = {
      fromModel: 'free/default',
      toModel: 'divergent/paid-floor',
      category: ApiErrorCategory.RATE_LIMIT,
      mode: 'reactive',
    };

    expect(composeQuotaFallbackInfo(reactiveAfterGuest, guest)).toEqual({
      fromModel: 'configured/paid',
      toModel: 'divergent/paid-floor',
      category: ApiErrorCategory.RATE_LIMIT,
      mode: 'reactive',
    });
  });
});

describe('hop-1 floor promotion (no tier-aware retarget exists)', () => {
  // No `registerSystemSettings` here on purpose: unregistered reads serve the
  // registry fallbacks, so the free floor is the static `openrouter/free` and
  // the paid floor the static `openrouter/auto`.
  beforeEach(() => {
    vi.useFakeTimers();
    resetSystemSettingsRegistration();
    for (const method of [
      mockLogger.trace,
      mockLogger.debug,
      mockLogger.info,
      mockLogger.warn,
      mockLogger.error,
      mockLogger.fatal,
    ]) {
      method.mockClear();
    }
  });
  afterEach(() => vi.restoreAllMocks());

  /** The proactively-substituted guest: the failing model IS the free default. */
  function guestOnFreeDefaultOpts(): GenerateAttemptOpts {
    return buildOpts({
      isGuestMode: true,
      apiKey: 'sk-system-key',
      personality: {
        id: 'p1',
        name: 'Testy',
        model: 'freebie/model:free',
        temperature: 0.9,
      } as unknown as GenerateAttemptOpts['personality'],
    });
  }

  /** A live upstream 429 as the runner sees it: the retry ladder's wrapper. */
  function exhaustedRateLimitRetryError(): RetryError {
    return new RetryError(
      'Failed after 3 attempts',
      3,
      new ApiError('Rate limit exceeded', {
        type: ApiErrorType.TRANSIENT,
        category: ApiErrorCategory.RATE_LIMIT,
        statusCode: 429,
        userMessage: 'x',
        technicalMessage: 'x',
        referenceId: 'ref',
        shouldRetry: true,
      })
    );
  }

  /** The RateLimitCache short-circuit's synthetic error (see LLMInvoker). */
  function cachedRateLimitError(): ApiError {
    return new ApiError('Rate limit cached', {
      type: ApiErrorType.PERMANENT,
      category: ApiErrorCategory.RATE_LIMIT,
      statusCode: 429,
      userMessage: 'x',
      technicalMessage: 'x',
      referenceId: 'rate-limit-cache-hit',
      shouldRetry: false,
    });
  }

  it('a guest already on the free default rescues to the free floor (live 429)', async () => {
    const primary = vi.fn().mockRejectedValue(exhaustedRateLimitRetryError());
    const retry = vi.fn().mockResolvedValue(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: guestOnFreeDefaultOpts(),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' } }),
    });

    // The model crossing the invocation seam is the floor, not the dead default.
    expect(retry).toHaveBeenCalledTimes(1);
    const hop1Opts = retry.mock.calls[0][0] as GenerateAttemptOpts;
    expect(hop1Opts.personality.model).toBe('openrouter/free');
    expect(result.quotaFallback).toEqual({
      fromModel: 'freebie/model:free',
      toModel: 'openrouter/free',
      category: ApiErrorCategory.RATE_LIMIT,
      mode: 'reactive',
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ floorModel: 'openrouter/free' }),
      'No hop-1 retarget available — promoting the floor to the hop-1 target'
    );
  });

  it('an inherited CREDIT_EXHAUSTION turn also passes the widened gate to the free floor', async () => {
    // The inherited category is not always RATE_LIMIT: a proactive demotion
    // can inherit CREDIT_EXHAUSTION, whose hop 1 is the forced-system-key
    // free default. This pins that the widened gate serves that arm too —
    // re-introducing the "no solvent entity" exclusion at THIS layer would
    // redden it while every RATE_LIMIT test stayed green.
    const original = quotaError(ApiErrorCategory.AUTHENTICATION);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi
      .fn()
      .mockRejectedValueOnce(quotaError(ApiErrorCategory.AUTHENTICATION))
      .mockResolvedValueOnce(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: { ...buildOpts(), inheritedQuotaCategory: ApiErrorCategory.CREDIT_EXHAUSTION },
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' } }),
    });

    // Hop 1 is the forced free default; hop 2 descends to the free floor
    // (the static registry fallback — this describe registers no settings).
    expect(retry).toHaveBeenCalledTimes(2);
    expect((retry.mock.calls[0][0] as GenerateAttemptOpts).personality.model).toBe(
      'freebie/model:free'
    );
    expect((retry.mock.calls[1][0] as GenerateAttemptOpts).personality.model).toBe(
      'openrouter/free'
    );
    expect(result.quotaFallback?.category).toBe(ApiErrorCategory.CREDIT_EXHAUSTION);
  });

  it('a floor-promoted hop-1 target failing unclassifiably still self-excludes on hop 2', async () => {
    // Composes two separately-tested behaviors the PR body only inferred
    // together: the widened gate lets an INHERITED-category turn attempt
    // hop 2, and `excludeModels` then vetoes re-trying the very floor that
    // was promoted to hop 1 — terminal, with exactly one retry attempt.
    const original = quotaError(ApiErrorCategory.AUTHENTICATION);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.AUTHENTICATION));

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: {
          ...guestOnFreeDefaultOpts(),
          inheritedQuotaCategory: ApiErrorCategory.RATE_LIMIT,
        },
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ free: { model: 'freebie/model:free' } }),
      })
    ).rejects.toBe(original);

    // Hop 1 received the promoted floor; hop 2 was gated OPEN (inherited)
    // but the floor self-excluded, so exactly one retry crossed the seam.
    expect(retry).toHaveBeenCalledTimes(1);
    const hop1Opts = retry.mock.calls[0][0] as GenerateAttemptOpts;
    expect(hop1Opts.personality.model).toBe('openrouter/free');
  });

  it('the same rescue fires on the rate-limit CACHE-HIT error shape', async () => {
    const primary = vi.fn().mockRejectedValue(cachedRateLimitError());
    const retry = vi.fn().mockResolvedValue(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: guestOnFreeDefaultOpts(),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' } }),
    });

    const hop1Opts = retry.mock.calls[0][0] as GenerateAttemptOpts;
    expect(hop1Opts.personality.model).toBe('openrouter/free');
    expect(result.quotaFallback?.toModel).toBe('openrouter/free');
  });

  it('the floor viability check for a guest runs under the SYSTEM bucket', async () => {
    const primary = vi.fn().mockRejectedValue(exhaustedRateLimitRetryError());
    const retry = vi.fn().mockResolvedValue(okResult);
    const deps = buildDeps({ free: { model: 'freebie/model:free' } });

    await runWithQuotaFallback({
      primary,
      retry,
      opts: guestOnFreeDefaultOpts(),
      userId: '123',
      requestId: 'req-1',
      deps,
    });

    expect(deps.caches.rateLimit.isRateLimited).toHaveBeenCalledWith({
      cacheKeyId: 'system',
      model: 'openrouter/free',
    });
  });

  it('guest CREDIT_EXHAUSTION stays terminal — the floor is never attempted', async () => {
    const original = quotaError(ApiErrorCategory.CREDIT_EXHAUSTION);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn();

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: guestOnFreeDefaultOpts(),
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ free: { model: 'freebie/model:free' } }),
      })
    ).rejects.toBe(original);

    expect(retry).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ failingModel: 'freebie/model:free' }),
      'No hop-1 retarget and the floor is not attempted: credit exhaustion leaves no solvent billing entity'
    );
  });

  it('NON-guest CREDIT_EXHAUSTION stays terminal too — the carve-out is category-gated, not guest-gated', async () => {
    // A mutation scoping the carve-out to isGuestMode would survive the guest
    // test alone; this pins the category gate for the BYOK arm.
    const original = quotaError(ApiErrorCategory.CREDIT_EXHAUSTION);
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn();

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: buildOpts(), // BYOK; global default === failing model in buildDeps below
        userId: '123',
        requestId: 'req-1',
        deps: buildDeps({ global: { model: 'expensive/primary' } }),
      })
    ).rejects.toBe(original);

    expect(retry).not.toHaveBeenCalled();
  });

  it('a doom-vetoed floor stays terminal and logs the skip', async () => {
    const original = exhaustedRateLimitRetryError();
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn();
    const deps = buildDeps({ free: { model: 'freebie/model:free' } });
    (deps.caches.rateLimit.isRateLimited as ReturnType<typeof vi.fn>).mockImplementation(
      ({ model }: { model: string }) =>
        Promise.resolve({ rateLimited: model === 'openrouter/free' })
    );

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: guestOnFreeDefaultOpts(),
        userId: '123',
        requestId: 'req-1',
        deps,
      })
    ).rejects.toBe(original);

    expect(retry).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        failingModel: 'freebie/model:free',
        cause: 'the doom caches veto it',
      }),
      'No hop-1 retarget and the floor is unavailable — terminal'
    );
  });

  it('a floor-selection FAILURE degrades to terminal instead of masking the original error', async () => {
    // The never-throws contract on the promotion path: a thrown selection error
    // is logged as itself and the pristine original propagates.
    const original = exhaustedRateLimitRetryError();
    const primary = vi.fn().mockRejectedValue(original);
    const retry = vi.fn();
    const deps = buildDeps({ free: { model: 'freebie/model:free' } });
    (deps.caches.creditExhaustion.isCreditExhausted as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('redis exploded')
    );

    await expect(
      runWithQuotaFallback({
        primary,
        retry,
        opts: guestOnFreeDefaultOpts(),
        userId: '123',
        requestId: 'req-1',
        deps,
      })
    ).rejects.toBe(original);

    expect(retry).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), failingModel: 'freebie/model:free' }),
      'Floor selection threw — treating the floor as unavailable'
    );
  });

  it('promotes the floor for a non-rate-limit category too (SERVER_ERROR) — the carve-out is CREDIT_EXHAUSTION alone', async () => {
    // Pins the category-agnostic claim in selectHopOneFloorTarget's doc: a
    // mutation gating the promotion to RATE_LIMIT only would survive the two
    // rate-limit-shaped tests above and the CE carve-out test alone.
    const primary = vi.fn().mockRejectedValue(quotaError(ApiErrorCategory.SERVER_ERROR));
    const retry = vi.fn().mockResolvedValue(okResult);

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: guestOnFreeDefaultOpts(),
      userId: '123',
      requestId: 'req-1',
      deps: buildDeps({ free: { model: 'freebie/model:free' } }),
    });

    const hop1Opts = retry.mock.calls[0][0] as GenerateAttemptOpts;
    expect(hop1Opts.personality.model).toBe('openrouter/free');
    expect(result.quotaFallback?.category).toBe(ApiErrorCategory.SERVER_ERROR);
  });

  it('a z.ai-admitted GUEST floor-promotes onto the SYSTEM key, not a nonexistent BYOK key', async () => {
    // The guest ladder admits onto the z.ai piggyback, so the personality
    // carries a non-OpenRouter provider while the floor target is OpenRouter.
    // A guest has no BYOK OpenRouter key, so resolving one would abort the
    // retarget; the system key is their OpenRouter billing identity.
    const primary = vi.fn().mockRejectedValue(exhaustedRateLimitRetryError());
    const retry = vi.fn().mockResolvedValue(okResult);
    // A guest has NO BYOK OpenRouter key — the resolver returns undefined,
    // which is what makes the system-key arm load-bearing rather than cosmetic.
    const deps = buildDeps({
      free: { model: 'freebie/model:free' },
      userOpenRouterKey: undefined,
    });

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts({
        isGuestMode: true,
        apiKey: 'sk-zai-system-key',
        effectiveProvider: AIProvider.ZaiCoding,
        personality: {
          id: 'p1',
          name: 'Testy',
          model: 'freebie/model:free',
          provider: AIProvider.ZaiCoding,
          temperature: 0.9,
        } as unknown as GenerateAttemptOpts['personality'],
      }),
      userId: '123',
      requestId: 'req-1',
      deps,
    });

    // Both halves of what crosses the invocation seam: the floor model AND
    // the system credential it must run on.
    expect(retry).toHaveBeenCalledTimes(1);
    const hop1Opts = retry.mock.calls[0][0] as GenerateAttemptOpts;
    expect(hop1Opts.personality.model).toBe('openrouter/free');
    expect(hop1Opts.apiKey).toBe('sk-system-key');
    expect(hop1Opts.isGuestMode).toBe(true);
    expect(deps.resolveUserOpenRouterKey).not.toHaveBeenCalled();
    expect(result.quotaFallback?.toModel).toBe('openrouter/free');
  });

  it('a NON-guest whose global default is the failing model rescues to the paid floor on their own key', async () => {
    const primary = vi.fn().mockRejectedValue(exhaustedRateLimitRetryError());
    const retry = vi.fn().mockResolvedValue(okResult);
    const deps = buildDeps({ global: { model: 'expensive/primary' } });

    const result = await runWithQuotaFallback({
      primary,
      retry,
      opts: buildOpts(), // BYOK, personality.model === 'expensive/primary'
      userId: '123',
      requestId: 'req-1',
      deps,
    });

    const hop1Opts = retry.mock.calls[0][0] as GenerateAttemptOpts;
    expect(hop1Opts.personality.model).toBe('openrouter/auto');
    expect(hop1Opts.apiKey).toBe('sk-user-key');
    expect(result.quotaFallback?.toModel).toBe('openrouter/auto');
    expect(deps.caches.rateLimit.isRateLimited).toHaveBeenCalledWith({
      cacheKeyId: 'user:123',
      model: 'openrouter/auto',
    });
  });
});
