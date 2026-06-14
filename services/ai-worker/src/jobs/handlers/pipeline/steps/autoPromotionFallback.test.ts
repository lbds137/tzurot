/**
 * Tests for runWithAutoPromotionFallback.
 *
 * The integration-level behavior (z.ai fail → openrouter retry, both fail →
 * propagate original error, no fallback when wasAutoPromoted is false) is
 * also covered end-to-end in GenerationStep.test.ts. These tests focus on
 * the orchestrator's contract in isolation.
 */

import { describe, it, expect, vi } from 'vitest';
import { AIProvider } from '@tzurot/common-types';
import { runWithAutoPromotionFallback } from './autoPromotionFallback.js';
import type { GenerateAttemptOpts, GenerateAttemptResult } from './autoPromotionFallback.js';

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
    // source stays z.ai for the promoted attempt.
    expect(attempt.mock.calls[0]?.[0]).toMatchObject({
      personality: { provider: 'zai-coding', model: 'glm-5.1' },
      apiKey: 'zai-key',
      effectiveProvider: AIProvider.ZaiCoding,
    });
    // Second call: swapped to openrouter personality + fallback key, and the
    // cap source swaps to OpenRouter too (the fallback runs there).
    expect(attempt.mock.calls[1]?.[0]).toMatchObject({
      personality: { provider: 'openrouter', model: 'z-ai/glm-5.1' },
      apiKey: 'sk-or-fallback',
      isGuestMode: false,
      effectiveProvider: AIProvider.OpenRouter,
    });
    expect(result).toBe(fallbackResult);
  });

  it('should propagate ORIGINAL error when fallback retry also fails', async () => {
    // User-facing error should be the actual root-cause from z.ai, not the
    // fallback's failure (which may be unrelated — rate limit, network, etc.)
    const originalError = new Error('z.ai 404: model not found');
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(new Error('OpenRouter rate limited'));

    await expect(
      runWithAutoPromotionFallback(attempt, baseOpts, {
        apiKey: 'sk-or',
        provider: 'openrouter',
        model: 'z-ai/glm-5.1',
        isGuestMode: false,
      })
    ).rejects.toBe(originalError);

    expect(attempt).toHaveBeenCalledTimes(2);
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
