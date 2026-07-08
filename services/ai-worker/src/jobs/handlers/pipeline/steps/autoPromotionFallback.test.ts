/**
 * Tests for runWithAutoPromotionFallback.
 *
 * The integration-level behavior (z.ai fail → openrouter retry, both fail →
 * propagate original error, no fallback when wasAutoPromoted is false) is
 * also covered end-to-end in GenerationStep.test.ts. These tests focus on
 * the orchestrator's contract in isolation.
 */

import { describe, it, expect, vi } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { RetryError } from '../../../../utils/retry.js';
import { ApiErrorCategory, ApiErrorType } from '@tzurot/common-types/constants/error';
import { ApiError } from '../../../../utils/apiErrorParser.js';
import {
  runWithAutoPromotionFallback,
  getFallbackFailureSummary,
  getAttemptedFallbackProvider,
} from './autoPromotionFallback.js';
import type { GenerateAttemptOpts, GenerateAttemptResult } from './autoPromotionFallback.js';

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

const baseOpts: GenerateAttemptOpts = {
  personality: {
    id: 'p',
    name: 'Test',
    displayName: 'Test',
    slug: 'test',
    ownerId: 'owner',
    systemPrompt: 'sys',
    model: 'glm-5.1',
    provider: 'zai-coding',
    temperature: 0.7,
    maxTokens: 100,
    contextWindowTokens: 8192,
    characterInfo: 'info',
    personalityTraits: 'traits',
    voiceEnabled: false,
  },
  message: 'hello',
  conversationContext: {
    conversationHistory: [],
    rawConversationHistory: [],
    participants: [],
    userId: 'user-1',
  },
  recentAssistantMessages: [],
  apiKey: 'zai-key',
  sttDispatch: undefined,
  isGuestMode: false,
  jobId: 'job-1',
  effectiveProvider: AIProvider.ZaiCoding,
};

const successResult: GenerateAttemptResult = {
  response: { content: 'ok', retrievedMemories: 0, tokensIn: 1, tokensOut: 1 },
  duplicateRetries: 0,
  emptyRetries: 0,
  leakedThinkingRetries: 0,
};

describe('runWithAutoPromotionFallback', () => {
  it('does NOT rescue via a guest-mode fallback (owner-cost boundary) — runs the plain attempt', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('z.ai 429'));
    const guestFallback = {
      apiKey: 'sk-system',
      provider: 'openrouter',
      model: 'z-ai/glm-5.2',
      isGuestMode: true,
    };

    await expect(
      runWithAutoPromotionFallback(attempt, baseOpts as never, guestFallback)
    ).rejects.toThrow('z.ai 429');

    // Exactly one attempt — the paid-model-on-system-key rescue was refused,
    // and note: NO maxLlmAttempts:1 override (plain passthrough call shape).
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0][0]).toEqual(baseOpts);
  });

  it('should pass through directly when fallback is undefined', async () => {
    const attempt = vi.fn().mockResolvedValue(successResult);

    const result = await runWithAutoPromotionFallback(attempt, baseOpts, undefined);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith(baseOpts);
    expect(result).toBe(successResult);
  });

  it('should pass through when attempt succeeds even with fallback present', async () => {
    // Happy path on the promoted route — fallback was pre-computed but never
    // invoked because the z.ai call succeeded.
    const attempt = vi.fn().mockResolvedValue(successResult);

    const result = await runWithAutoPromotionFallback(attempt, baseOpts, {
      apiKey: 'sk-or',
      provider: 'openrouter',
      model: 'z-ai/glm-5.1',
      isGuestMode: false,
    });

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(result).toBe(successResult);
  });

  it('should swap to fallback and retry when first attempt fails', async () => {
    const fallbackResult: GenerateAttemptResult = {
      ...successResult,
      response: { ...successResult.response, content: 'from fallback' },
    };
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error('z.ai 404'))
      .mockResolvedValueOnce(fallbackResult);

    const result = await runWithAutoPromotionFallback(attempt, baseOpts, {
      apiKey: 'sk-or-fallback',
      provider: 'openrouter',
      model: 'z-ai/glm-5.1',
      isGuestMode: false,
    });

    expect(attempt).toHaveBeenCalledTimes(2);
    // First call: original opts (zai-coding personality + zai key); the cap
    // source stays z.ai for the promoted attempt. Capped at a single LLM attempt
    // so a z.ai transient/429 swaps to the fallback immediately (no 3×retry burn).
    expect(attempt.mock.calls[0]?.[0]).toMatchObject({
      personality: { provider: 'zai-coding', model: 'glm-5.1' },
      apiKey: 'zai-key',
      effectiveProvider: AIProvider.ZaiCoding,
      maxLlmAttempts: 1,
    });
    // Second call: swapped to openrouter personality + fallback key, and the
    // cap source swaps to OpenRouter too (the fallback runs there).
    expect(attempt.mock.calls[1]?.[0]).toMatchObject({
      personality: { provider: 'openrouter', model: 'z-ai/glm-5.1' },
      apiKey: 'sk-or-fallback',
      isGuestMode: false,
      effectiveProvider: AIProvider.OpenRouter,
    });
    // The fallback keeps the default retry budget — only the primary fails fast.
    expect(attempt.mock.calls[1]?.[0]?.maxLlmAttempts).toBeUndefined();
    // Result is the fallback's, tagged with the effective provider (OpenRouter)
    // so the response footer links to the OpenRouter model card, not z.ai docs.
    expect(result).toEqual({ ...fallbackResult, effectiveProviderUsed: AIProvider.OpenRouter });
  });

  it('attaches the reactive footer breadcrumb when the swap rescues a quota-class failure', async () => {
    // The first-fallback footer gap: the response said "via OpenRouter" but
    // carried no `from → to (rate limited)` annotation — only SUBSEQUENT
    // requests (proactive demotion off the doom cache) showed it.
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests: rate limit exceeded'))
      .mockResolvedValueOnce(successResult);

    const result = await runWithAutoPromotionFallback(attempt, baseOpts, {
      apiKey: 'sk-or-fallback',
      provider: 'openrouter',
      model: 'z-ai/glm-5.1',
      isGuestMode: false,
    });

    expect(result.autoPromotionFallback).toEqual({
      fromModel: 'glm-5.1',
      toModel: 'z-ai/glm-5.1',
      category: ApiErrorCategory.RATE_LIMIT,
      mode: 'reactive',
    });
  });

  it('attaches NO breadcrumb for a non-quota swap reason (catalog drift stays unannotated)', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error('model not found: glm-5.1'))
      .mockResolvedValueOnce(successResult);

    const result = await runWithAutoPromotionFallback(attempt, baseOpts, {
      apiKey: 'sk-or-fallback',
      provider: 'openrouter',
      model: 'z-ai/glm-5.1',
      isGuestMode: false,
    });

    expect(result.autoPromotionFallback).toBeUndefined();
    expect(result.effectiveProviderUsed).toBe(AIProvider.OpenRouter);
  });

  it('classifies the UNWRAPPED error for the breadcrumb when the failure is RetryError-wrapped', async () => {
    const wrapped = new RetryError('LLM invocation failed', 1, new Error('too many requests'));
    const attempt = vi.fn().mockRejectedValueOnce(wrapped).mockResolvedValueOnce(successResult);

    const result = await runWithAutoPromotionFallback(attempt, baseOpts, {
      apiKey: 'sk-or-fallback',
      provider: 'openrouter',
      model: 'z-ai/glm-5.1',
      isGuestMode: false,
    });

    expect(result.autoPromotionFallback?.category).toBe(ApiErrorCategory.RATE_LIMIT);
    expect(result.autoPromotionFallback?.mode).toBe('reactive');
  });

  it("honors a synthetic ApiError's authoritative category over its generic message", async () => {
    // The rate-limit-cache short-circuit throws ApiError('Rate limit cached',
    // { category: QUOTA_EXCEEDED, ... }) — regex-parsing that message would
    // mislabel the breadcrumb RATE_LIMIT. classifyQuotaFailure trusts the
    // instance's own category.
    const synthetic = new ApiError('Rate limit cached', {
      type: ApiErrorType.PERMANENT,
      category: ApiErrorCategory.QUOTA_EXCEEDED,
      userMessage: 'x',
      technicalMessage: 'x',
      referenceId: 'ref',
      shouldRetry: false,
    });
    const attempt = vi.fn().mockRejectedValueOnce(synthetic).mockResolvedValueOnce(successResult);

    const result = await runWithAutoPromotionFallback(attempt, baseOpts, {
      apiKey: 'sk-or-fallback',
      provider: 'openrouter',
      model: 'z-ai/glm-5.1',
      isGuestMode: false,
    });

    expect(result.autoPromotionFallback?.category).toBe(ApiErrorCategory.QUOTA_EXCEEDED);
  });

  it('propagates the ORIGINAL error untouched with the fallback summary attached separately', async () => {
    // The message must stay PRISTINE — parseApiError classifies via regex over
    // message text, so appending the fallback's wording there could flip the
    // root-cause category. The fallback story rides a separate property that
    // the error-result composer reads after classification.
    const originalError = new Error('Rate limit cached');
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(
        new Error('402 This request requires more credits, or fewer max_tokens')
      );

    await expect(
      runWithAutoPromotionFallback(attempt, baseOpts, {
        apiKey: 'sk-or',
        provider: 'openrouter',
        model: 'z-ai/glm-5.1',
        isGuestMode: false,
      })
    ).rejects.toBe(originalError);

    expect(attempt).toHaveBeenCalledTimes(2);
    // Message untouched (classification safety) …
    expect(originalError.message).toBe('Rate limit cached');
    // … and the second half of the story attached for the composer.
    expect(getFallbackFailureSummary(originalError)).toBe(
      '402 This request requires more credits, or fewer max_tokens'
    );
    // The attempted route rides along too, so the error footer can render the
    // full chain ("via Z.AI Coding Plan → OpenRouter") instead of the primary.
    expect(getAttemptedFallbackProvider(originalError)).toBe('openrouter');
  });

  it('summarizes the UNWRAPPED provider error when the fallback failure is RetryError-wrapped', async () => {
    // The retry machinery rethrows a RetryError whose own message is the
    // generic wrapper — summarizing THAT buries the provider detail the user
    // needs (observed in prod: a fallback 402 credit error surfaced as just
    // "LLM invocation (z-ai/glm-5.2) failed with non-retryable error").
    const originalError = new Error('Rate limit cached');
    const providerError = new Error(
      '402 This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens'
    );
    const wrapped = new RetryError(
      'LLM invocation (z-ai/glm-5.1) failed with non-retryable error',
      1,
      providerError
    );
    const attempt = vi.fn().mockRejectedValueOnce(originalError).mockRejectedValueOnce(wrapped);

    await expect(
      runWithAutoPromotionFallback(attempt, baseOpts, {
        apiKey: 'sk-or',
        provider: 'openrouter',
        model: 'z-ai/glm-5.1',
        isGuestMode: false,
      })
    ).rejects.toBe(originalError);

    expect(getFallbackFailureSummary(originalError)).toBe(
      '402 This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens'
    );
    expect(getFallbackFailureSummary(originalError)).not.toContain('non-retryable');
  });

  it('caps an over-long fallback failure summary', async () => {
    const originalError = new Error('primary failed');
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(new Error('x'.repeat(500)));

    await expect(
      runWithAutoPromotionFallback(attempt, baseOpts, {
        apiKey: 'sk-or',
        provider: 'openrouter',
        model: 'z-ai/glm-5.1',
        isGuestMode: false,
      })
    ).rejects.toBe(originalError);

    const summary = getFallbackFailureSummary(originalError);
    // 160 code points + ellipsis — persona-voiced errors stay readable.
    expect(summary).toContain('…');
    expect(summary?.length).toBeLessThanOrEqual(161);
  });

  it('returns undefined from getFallbackFailureSummary for errors without one', () => {
    expect(getFallbackFailureSummary(new Error('plain'))).toBeUndefined();
    expect(getFallbackFailureSummary(null)).toBeUndefined();
    expect(getFallbackFailureSummary('string error')).toBeUndefined();
  });

  it('returns undefined from getAttemptedFallbackProvider for errors without fallback info', () => {
    expect(getAttemptedFallbackProvider(new Error('plain'))).toBeUndefined();
    expect(getAttemptedFallbackProvider(null)).toBeUndefined();
    expect(getAttemptedFallbackProvider('string error')).toBeUndefined();
  });

  it('rejects a malformed fallback-info payload (shape check)', () => {
    // Only runWithAutoPromotionFallback attaches this payload, but the readers
    // shape-check anyway — a non-string field must not leak through as info.
    const error = new Error('primary failed');
    (error as unknown as Record<PropertyKey, unknown>)[Symbol.for('tzurot.fallbackFailureInfo')] = {
      summary: 42,
      provider: 'openrouter',
    };

    expect(getFallbackFailureSummary(error)).toBeUndefined();
    expect(getAttemptedFallbackProvider(error)).toBeUndefined();
  });

  it('should propagate the error directly when fallback is undefined and attempt fails', async () => {
    // No fallback to retry with — error bubbles up from the single call.
    const error = new Error('OpenRouter timeout');
    const attempt = vi.fn().mockRejectedValueOnce(error);

    await expect(runWithAutoPromotionFallback(attempt, baseOpts, undefined)).rejects.toBe(error);

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('refuses a guest-mode (system-key) fallback entirely — no paid model on the owner key', async () => {
    // A guest-mode fallback means the OpenRouter resolution landed on the
    // SYSTEM key. Rescuing would run the paid z-ai/<model> on the owner's
    // key, so the rescue is refused: one plain attempt, failure propagates
    // (the reactive quota fallback downstream retargets guests to the free
    // default). This test previously asserted the guest flag PROPAGATED
    // through a rescue — that assertion encoded the owner-cost hole.
    const attempt = vi.fn().mockRejectedValueOnce(new Error('z.ai err'));

    await expect(
      runWithAutoPromotionFallback(attempt, baseOpts, {
        apiKey: 'sk-or-system',
        provider: 'openrouter',
        model: 'z-ai/glm-5.1',
        isGuestMode: true, // <-- guest mode on fallback
      })
    ).rejects.toThrow('z.ai err');

    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
