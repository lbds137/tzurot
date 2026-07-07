import { describe, it, expect, vi } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { tryPromotionDemotion, type DemotableAuth } from './promotionDemotion.js';
import type {
  QuotaFallbackCaches,
  QuotaFallbackCategory,
} from '../../../../services/quotaFallback.js';

const CATEGORY = ApiErrorCategory.QUOTA_EXCEEDED as QuotaFallbackCategory;

function makeCaches(fallbackDoomed: boolean): QuotaFallbackCaches {
  return {
    creditExhaustion: { isCreditExhausted: vi.fn().mockResolvedValue({ exhausted: false }) },
    rateLimit: {
      isRateLimited: vi.fn().mockResolvedValue({ rateLimited: fallbackDoomed }),
    },
  } as unknown as QuotaFallbackCaches;
}

const promotedAuth: DemotableAuth = {
  effectivePersonality: { model: 'glm-5.2', provider: 'zai-coding' },
  resolvedApiKey: 'sk-zai',
  resolvedProvider: AIProvider.ZaiCoding,
  isGuestMode: false,
  wasAutoPromoted: true,
  fallback: {
    apiKey: 'sk-openrouter',
    provider: AIProvider.OpenRouter,
    model: 'z-ai/glm-5.2',
    isGuestMode: false,
  },
};

describe('tryPromotionDemotion', () => {
  it('demotes to the passthrough when its pool is viable, announcing the swap', async () => {
    const result = await tryPromotionDemotion(promotedAuth, 'user-1', CATEGORY, makeCaches(false));

    expect(result).not.toBeNull();
    expect(result?.effectivePersonality.model).toBe('z-ai/glm-5.2');
    expect(result?.resolvedApiKey).toBe('sk-openrouter');
    expect(result?.resolvedProvider).toBe(AIProvider.OpenRouter);
    expect(result?.quotaFallback).toEqual({
      fromModel: 'glm-5.2',
      toModel: 'z-ai/glm-5.2',
      category: CATEGORY,
      mode: 'proactive',
    });
    expect(result?.wasAutoPromoted).toBeUndefined();
    expect(result?.fallback).toBeUndefined();
  });

  it('returns null for a GUEST-MODE fallback (owner-cost boundary: paid model must not run on the system key)', async () => {
    const guestFallbackAuth: DemotableAuth = {
      ...promotedAuth,
      fallback: { ...promotedAuth.fallback!, apiKey: 'sk-system', isGuestMode: true },
    };
    await expect(
      tryPromotionDemotion(guestFallbackAuth, 'user-1', CATEGORY, makeCaches(false))
    ).resolves.toBeNull();
  });

  it('returns null when the passthrough pool is ALSO doomed', async () => {
    await expect(
      tryPromotionDemotion(promotedAuth, 'user-1', CATEGORY, makeCaches(true))
    ).resolves.toBeNull();
  });

  it('returns null for non-promoted auth, missing fallback, or missing caches', async () => {
    await expect(
      tryPromotionDemotion(
        { ...promotedAuth, wasAutoPromoted: undefined },
        'user-1',
        CATEGORY,
        makeCaches(false)
      )
    ).resolves.toBeNull();
    await expect(
      tryPromotionDemotion(
        { ...promotedAuth, fallback: undefined },
        'user-1',
        CATEGORY,
        makeCaches(false)
      )
    ).resolves.toBeNull();
    await expect(
      tryPromotionDemotion(promotedAuth, 'user-1', CATEGORY, undefined)
    ).resolves.toBeNull();
  });
});
