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

  it('should propagate fallback isGuestMode when fallback was a system-key resolution', async () => {
    // If the OpenRouter fallback resolution returned the system key (guest
    // mode), that should propagate to the retried attempt — affects model
    // restriction and footer rendering downstream.
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error('z.ai err'))
      .mockResolvedValueOnce(successResult);

    await runWithAutoPromotionFallback(attempt, baseOpts, {
      apiKey: 'sk-or-system',
      provider: 'openrouter',
      model: 'z-ai/glm-5.1',
      isGuestMode: true, // <-- guest mode on fallback
    });

    expect(attempt.mock.calls[1]?.[0].isGuestMode).toBe(true);
  });
});
