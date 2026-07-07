import { describe, it, expect, vi } from 'vitest';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import type {
  QuotaFallbackCaches,
  QuotaFallbackCategory,
} from '../../../../services/quotaFallback.js';
import { resolveRetargetRoute, type RetargetRouteDeps } from './retargetRoute.js';

const CATEGORY = ApiErrorCategory.QUOTA_EXCEEDED as QuotaFallbackCategory;

function makeDeps(overrides?: {
  userOpenRouterKey?: string;
  systemKey?: string;
  freeConfig?: { model: string } | null;
}): RetargetRouteDeps {
  return {
    apiKeyResolver: {
      resolveUserOpenRouterKey: vi.fn().mockResolvedValue(overrides?.userOpenRouterKey),
      resolveSystemOpenRouterKey: vi.fn().mockResolvedValue(overrides?.systemKey),
    } as unknown as ApiKeyResolver,
    configResolver: {
      getFreeDefaultConfig: vi.fn().mockResolvedValue(overrides?.freeConfig ?? null),
    } as unknown as LlmConfigResolver,
    caches: {
      creditExhaustion: { isCreditExhausted: vi.fn().mockResolvedValue({ exhausted: false }) },
      rateLimit: { isRateLimited: vi.fn().mockResolvedValue({ rateLimited: false }) },
    } as unknown as QuotaFallbackCaches,
  };
}

const paidTarget = { config: { model: 'paid/default' }, forceSystemKey: false } as never;

describe('resolveRetargetRoute', () => {
  it('same-provider request keeps its own key and the target config', async () => {
    const route = await resolveRetargetRoute({
      target: paidTarget,
      personality: { model: 'some/model', provider: 'openrouter' },
      apiKey: 'sk-user',
      isGuestMode: false,
      userId: 'u1',
      category: CATEGORY,
      cacheKeyId: 'ck',
      deps: makeDeps(),
    });
    expect(route).toEqual({
      config: { model: 'paid/default' },
      apiKey: 'sk-user',
      isGuestMode: false,
    });
  });

  it('cross-provider with a user OpenRouter key swaps to that key', async () => {
    const route = await resolveRetargetRoute({
      target: paidTarget,
      personality: { model: 'glm-5.2', provider: 'zai-coding' },
      apiKey: 'sk-zai',
      isGuestMode: false,
      userId: 'u1',
      category: CATEGORY,
      cacheKeyId: 'ck',
      deps: makeDeps({ userOpenRouterKey: 'sk-or-user' }),
    });
    expect(route?.apiKey).toBe('sk-or-user');
    expect(route?.config.model).toBe('paid/default');
  });

  it('cross-provider WITHOUT a user key degrades to the FREE default on the system key', async () => {
    const route = await resolveRetargetRoute({
      target: paidTarget,
      personality: { model: 'glm-5.2', provider: 'zai-coding' },
      apiKey: 'sk-zai',
      isGuestMode: false,
      userId: 'u1',
      category: CATEGORY,
      cacheKeyId: 'ck',
      deps: makeDeps({ systemKey: 'sk-system', freeConfig: { model: 'free/default' } }),
    });
    expect(route).toEqual({
      config: { model: 'free/default' },
      apiKey: 'sk-system',
      isGuestMode: true,
    });
  });

  it('downgrade aborts (null) when no system key or free default exists', async () => {
    const noSystem = await resolveRetargetRoute({
      target: paidTarget,
      personality: { model: 'glm-5.2', provider: 'zai-coding' },
      apiKey: 'sk-zai',
      isGuestMode: false,
      userId: 'u1',
      category: CATEGORY,
      cacheKeyId: 'ck',
      deps: makeDeps({ freeConfig: { model: 'free/default' } }),
    });
    expect(noSystem).toBeNull();

    const noFree = await resolveRetargetRoute({
      target: paidTarget,
      personality: { model: 'glm-5.2', provider: 'zai-coding' },
      apiKey: 'sk-zai',
      isGuestMode: false,
      userId: 'u1',
      category: CATEGORY,
      cacheKeyId: 'ck',
      deps: makeDeps({ systemKey: 'sk-system', freeConfig: null }),
    });
    expect(noFree).toBeNull();
  });

  it('forced system-key target (credit exhaustion) uses the system key with guest semantics', async () => {
    const route = await resolveRetargetRoute({
      target: { config: { model: 'free/default' }, forceSystemKey: true } as never,
      personality: { model: 'some/model', provider: 'openrouter' },
      apiKey: 'sk-user',
      isGuestMode: false,
      userId: 'u1',
      category: CATEGORY,
      cacheKeyId: 'ck',
      deps: makeDeps({ systemKey: 'sk-system' }),
    });
    expect(route).toEqual({
      config: { model: 'free/default' },
      apiKey: 'sk-system',
      isGuestMode: true,
    });
  });
});
