import { AIProvider } from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateAttemptOpts } from '../jobs/handlers/pipeline/steps/autoPromotionFallback.js';
import { selectHopOneFloorTarget } from '../jobs/handlers/pipeline/steps/hopOneFloorTarget.js';
import {
  buildPostRouteLlmAuth,
  provenanceFromResolution,
} from '../jobs/handlers/pipeline/steps/postRouteLlmAuth.js';
import {
  tryPromotionDemotion,
  type DemotableAuth,
} from '../jobs/handlers/pipeline/steps/promotionDemotion.js';
import type { ApiKeySource } from './ApiKeyResolver.js';
import { authCacheKeyId, type EffectiveTier, resolveEffectiveTier } from './effectiveTier.js';
import { selectVisionModel } from './multimodal/VisionProcessor.js';
import type { ResolvedRoute } from './ProviderRouter.js';
import {
  type QuotaFallbackCaches,
  selectFloorTarget,
  selectQuotaFallbackTarget,
} from './quotaFallback.js';
import { SYSTEM_CACHE_KEY_ID } from './RateLimitCache.js';

const DISCORD_USER_ID = '278863839632818186';
const FAKE_USER_KEY = 'fake-user-wallet-key-12345';
const FAKE_SYSTEM_KEY = 'fake-system-operator-key-67890';
const FREE_FLOOR_MODEL = 'openrouter/free-floor:free';
const PAID_FLOOR_MODEL = 'openrouter/paid-floor';

const BASE_PERSONALITY = {
  id: 'p-matrix',
  name: 'MatrixBot',
  displayName: 'MatrixBot',
  slug: 'matrix-bot',
  systemPrompt: 'prompt',
  model: 'deepseek/deepseek-v3.2',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 1000,
  contextWindowTokens: 8192,
} as LoadedPersonality;

type UserKind = 'guest' | 'free-keyless' | 'BYOK' | 'BYOK-degraded-to-system';
type KeyState = 'none' | 'ok';
type MatrixPath =
  'chat-route' | 'promote' | 'floor-selection' | 'ladder-entry' | 'vision-selection';

interface MatrixRow {
  userKind: UserKind;
  keyState: KeyState;
  path: MatrixPath;
  expected: {
    effectiveTier: EffectiveTier;
    cacheKeyId: string;
    floorTarget: string;
  };
}

const MATRIX_ROWS: MatrixRow[] = [
  // --- userKind: 'guest', keyState: 'none' (source: 'system', no key, isGuestMode: true) ---
  {
    userKind: 'guest',
    keyState: 'none',
    path: 'chat-route',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyState: 'none',
    path: 'promote',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyState: 'none',
    path: 'floor-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyState: 'none',
    path: 'ladder-entry',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyState: 'none',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'guest', keyState: 'ok' (source: 'system', operator system key, isGuestMode: true) ---
  {
    userKind: 'guest',
    keyState: 'ok',
    path: 'chat-route',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyState: 'ok',
    path: 'promote',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyState: 'ok',
    path: 'floor-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyState: 'ok',
    path: 'ladder-entry',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'free-keyless', keyState: 'none' (source: 'system', no key, isGuestMode: false) ---
  {
    userKind: 'free-keyless',
    keyState: 'none',
    path: 'chat-route',
    // was: effectiveTier implicitly 'paid' and selectFloorTarget returned PAID_FLOOR_MODEL when isGuestMode=false
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'free-keyless',
    keyState: 'none',
    path: 'promote',
    // was: demoted to paid fallbackTextModel floor when isGuestMode=false
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'free-keyless',
    keyState: 'none',
    path: 'floor-selection',
    // was: selectFloorTarget(isGuestMode=false) returned PAID_FLOOR_MODEL instead of FREE_FLOOR_MODEL
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'free-keyless',
    keyState: 'none',
    path: 'ladder-entry',
    // was: selectQuotaFallbackTarget with isGuestMode=false selected PAID_FLOOR_MODEL via getGlobalDefaultConfig instead of FREE_FLOOR_MODEL via getFreeDefaultConfig
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'free-keyless',
    keyState: 'none',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'BYOK-degraded-to-system', keyState: 'ok' (source: 'system', operator system key, isGuestMode: false) ---
  {
    userKind: 'BYOK-degraded-to-system',
    keyState: 'ok',
    path: 'chat-route',
    // was: cacheKeyId 'user:278863839632818186' (D10 leak) and floorTarget PAID_FLOOR_MODEL when isGuestMode=false
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK-degraded-to-system',
    keyState: 'ok',
    path: 'promote',
    // was: cacheKeyId 'user:278863839632818186' (D10 leak) and floorTarget PAID_FLOOR_MODEL when isGuestMode=false
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK-degraded-to-system',
    keyState: 'ok',
    path: 'floor-selection',
    // was: cacheKeyId 'user:278863839632818186' (D10 leak) and floorTarget PAID_FLOOR_MODEL when isGuestMode=false
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK-degraded-to-system',
    keyState: 'ok',
    path: 'ladder-entry',
    // was: cacheKeyId 'user:278863839632818186' (D10 leak) and selectQuotaFallbackTarget selected PAID_FLOOR_MODEL via getGlobalDefaultConfig when isGuestMode=false
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK-degraded-to-system',
    keyState: 'ok',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'BYOK', keyState: 'none' (source: 'user', missing/empty key, isGuestMode: false) ---
  {
    userKind: 'BYOK',
    keyState: 'none',
    path: 'chat-route',
    // was: floorTarget PAID_FLOOR_MODEL when isGuestMode=false despite empty key
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyState: 'none',
    path: 'promote',
    // was: floorTarget PAID_FLOOR_MODEL when isGuestMode=false despite empty key
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyState: 'none',
    path: 'floor-selection',
    // was: selectFloorTarget(isGuestMode=false) returned PAID_FLOOR_MODEL
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyState: 'none',
    path: 'ladder-entry',
    // was: selectQuotaFallbackTarget with isGuestMode=false selected PAID_FLOOR_MODEL via getGlobalDefaultConfig instead of FREE_FLOOR_MODEL via getFreeDefaultConfig
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyState: 'none',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'BYOK', keyState: 'ok' (source: 'user', valid personal wallet key, isGuestMode: false) ---
  {
    userKind: 'BYOK',
    keyState: 'ok',
    path: 'chat-route',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyState: 'ok',
    path: 'promote',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyState: 'ok',
    path: 'floor-selection',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyState: 'ok',
    path: 'ladder-entry',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyState: 'ok',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },
];

function deriveFixtureInputs(
  userKind: UserKind,
  keyState: KeyState
): {
  source: ApiKeySource;
  resolvedApiKey: string | undefined;
  isGuestModeFlag: boolean;
} {
  const source: ApiKeySource = userKind === 'BYOK' ? 'user' : 'system';
  if (keyState === 'none') {
    return {
      source,
      resolvedApiKey: undefined,
      isGuestModeFlag: userKind === 'guest',
    };
  }
  return {
    source,
    resolvedApiKey: source === 'user' ? FAKE_USER_KEY : FAKE_SYSTEM_KEY,
    isGuestModeFlag: userKind === 'guest',
  };
}

function buildViableCaches(): QuotaFallbackCaches {
  return {
    creditExhaustion: { isCreditExhausted: vi.fn().mockResolvedValue({ exhausted: false }) },
    rateLimit: { isRateLimited: vi.fn().mockResolvedValue({ rateLimited: false }) },
  } as unknown as QuotaFallbackCaches;
}

describe('effectiveTier seam matrix', () => {
  beforeEach(() => {
    registerSystemSettings({
      get: (key: string) =>
        key === 'fallbackTextModel' || key === 'fallbackVisionModel'
          ? PAID_FLOOR_MODEL
          : key === 'fallbackTextModelFree' || key === 'fallbackVisionModelFree'
            ? FREE_FLOOR_MODEL
            : undefined,
    } as unknown as SystemSettingsService);
  });

  afterEach(() => {
    resetSystemSettingsRegistration();
  });

  it.each(MATRIX_ROWS)(
    'resolves ($userKind, keyState=$keyState, path=$path)',
    async ({ userKind, keyState, path, expected }) => {
      const { source, resolvedApiKey, isGuestModeFlag } = deriveFixtureInputs(userKind, keyState);
      const caches = buildViableCaches();

      let effectiveTier: EffectiveTier;
      let cacheKeyId: string;
      let floorTarget: string | undefined;

      if (path === 'chat-route') {
        const route: ResolvedRoute = {
          effectiveProvider: AIProvider.OpenRouter,
          effectiveModel: 'deepseek/deepseek-v3.2',
          apiKey: resolvedApiKey ?? '',
          source,
          isGuestMode: isGuestModeFlag,
          fallthroughTriggered: false,
          wasAutoPromoted: false,
        };
        const llmAuth = buildPostRouteLlmAuth(route, BASE_PERSONALITY);
        expect(llmAuth.isGuestMode).toBe(isGuestModeFlag);
        effectiveTier = llmAuth.effectiveTier;
        cacheKeyId = authCacheKeyId(
          { keyProvenance: llmAuth.keyProvenance },
          llmAuth.resolvedApiKey,
          DISCORD_USER_ID
        );
        const floor = await selectFloorTarget({
          tier: effectiveTier,
          excludeModels: [],
          cacheKeyId,
          caches,
        });
        floorTarget = floor?.config.model;
      } else if (path === 'promote') {
        const keyProvenance = provenanceFromResolution(source, resolvedApiKey);
        const initialTier = resolveEffectiveTier({ keyProvenance });
        const promotedAuth: DemotableAuth = {
          effectivePersonality: { model: 'glm-5.2', provider: AIProvider.ZaiCoding },
          resolvedApiKey,
          resolvedProvider: AIProvider.ZaiCoding,
          isGuestMode: isGuestModeFlag,
          keyProvenance,
          effectiveTier: initialTier,
          wasAutoPromoted: true,
          fallback: {
            apiKey: resolvedApiKey ?? '',
            source,
            provider: AIProvider.OpenRouter,
            model: 'z-ai/glm-5.2',
            isGuestMode: isGuestModeFlag,
          },
        };
        const demoted = await tryPromotionDemotion(
          promotedAuth,
          DISCORD_USER_ID,
          ApiErrorCategory.QUOTA_EXCEEDED,
          caches
        );
        const finalAuth = initialTier === 'paid' ? demoted! : promotedAuth;
        effectiveTier = finalAuth.effectiveTier;
        cacheKeyId = authCacheKeyId(
          { keyProvenance: finalAuth.keyProvenance },
          finalAuth.resolvedApiKey,
          DISCORD_USER_ID
        );
        const floor = await selectFloorTarget({
          tier: effectiveTier,
          excludeModels: [],
          cacheKeyId,
          caches,
        });
        floorTarget = floor?.config.model;
      } else if (path === 'floor-selection') {
        const keyProvenance = provenanceFromResolution(source, resolvedApiKey);
        effectiveTier = resolveEffectiveTier({ keyProvenance });
        cacheKeyId = authCacheKeyId({ keyProvenance }, resolvedApiKey, DISCORD_USER_ID);
        const attemptOpts: GenerateAttemptOpts = {
          personality: BASE_PERSONALITY,
          message: 'hello',
          conversationContext: { userId: DISCORD_USER_ID },
          recentAssistantMessages: [],
          apiKey: resolvedApiKey,
          sttDispatch: undefined,
          isGuestMode: isGuestModeFlag,
          keyProvenance,
          effectiveTier,
          jobId: 'job-matrix',
        };
        const floor = await selectHopOneFloorTarget({
          category: ApiErrorCategory.TIMEOUT,
          opts: attemptOpts,
          caches,
        });
        floorTarget = floor?.config.model;
      } else if (path === 'vision-selection') {
        const route: ResolvedRoute = {
          effectiveProvider: AIProvider.OpenRouter,
          effectiveModel: 'deepseek/deepseek-v3.2',
          apiKey: resolvedApiKey ?? '',
          source,
          isGuestMode: isGuestModeFlag,
          fallthroughTriggered: false,
          wasAutoPromoted: false,
        };
        const llmAuth = buildPostRouteLlmAuth(route, BASE_PERSONALITY);
        expect(llmAuth.isGuestMode).toBe(isGuestModeFlag);
        effectiveTier = llmAuth.effectiveTier;
        cacheKeyId = authCacheKeyId(
          { keyProvenance: llmAuth.keyProvenance },
          llmAuth.resolvedApiKey,
          DISCORD_USER_ID
        );
        floorTarget = await selectVisionModel(
          { ...BASE_PERSONALITY, visionModel: PAID_FLOOR_MODEL },
          effectiveTier === 'free'
        );
      } else {
        const keyProvenance = provenanceFromResolution(source, resolvedApiKey);
        effectiveTier = resolveEffectiveTier({ keyProvenance });
        cacheKeyId = authCacheKeyId({ keyProvenance }, resolvedApiKey, DISCORD_USER_ID);
        const configResolver = {
          getFreeDefaultConfig: vi.fn().mockResolvedValue({ model: FREE_FLOOR_MODEL }),
          getGlobalDefaultConfig: vi.fn().mockResolvedValue({ model: PAID_FLOOR_MODEL }),
        };
        const target = await selectQuotaFallbackTarget({
          category: ApiErrorCategory.QUOTA_EXCEEDED,
          tier: effectiveTier,
          failingModel: 'expensive/primary',
          cacheKeyId,
          configResolver: configResolver as never,
          caches,
        });
        floorTarget = target?.config.model;
      }

      expect({
        effectiveTier,
        cacheKeyId,
        floorTarget,
      }).toEqual(expected);
    }
  );

  describe('D10 firewall regression', () => {
    it('returns SYSTEM_CACHE_KEY_ID for system provenance even when isGuestMode is false', () => {
      const nonGuestSystemAuth = { keyProvenance: 'system' as const, isGuestMode: false };
      const guestSystemAuth = { keyProvenance: 'system' as const, isGuestMode: true };

      expect(authCacheKeyId(nonGuestSystemAuth, FAKE_SYSTEM_KEY, DISCORD_USER_ID)).toBe(
        SYSTEM_CACHE_KEY_ID
      );
      expect(authCacheKeyId(guestSystemAuth, FAKE_SYSTEM_KEY, DISCORD_USER_ID)).toBe(
        SYSTEM_CACHE_KEY_ID
      );
    });

    it('returns per-user cacheKeyId only when keyProvenance is user and apiKey is present', () => {
      expect(authCacheKeyId({ keyProvenance: 'user' }, FAKE_USER_KEY, DISCORD_USER_ID)).toBe(
        `user:${DISCORD_USER_ID}`
      );
      expect(authCacheKeyId({ keyProvenance: 'user' }, undefined, DISCORD_USER_ID)).toBe(
        SYSTEM_CACHE_KEY_ID
      );
      expect(authCacheKeyId({ keyProvenance: 'none' }, FAKE_USER_KEY, DISCORD_USER_ID)).toBe(
        SYSTEM_CACHE_KEY_ID
      );
    });

    it('demotes user keyProvenance to free tier when keyState is low-credit or invalid', () => {
      expect(resolveEffectiveTier({ keyProvenance: 'user' })).toBe('paid');
      expect(resolveEffectiveTier({ keyProvenance: 'user', keyState: 'ok' })).toBe('paid');
      expect(resolveEffectiveTier({ keyProvenance: 'user', keyState: 'low-credit' })).toBe('free');
      expect(resolveEffectiveTier({ keyProvenance: 'user', keyState: 'invalid' })).toBe('free');
      expect(resolveEffectiveTier({ keyProvenance: 'system', keyState: 'ok' })).toBe('free');
      expect(resolveEffectiveTier({ keyProvenance: 'none', keyState: 'ok' })).toBe('free');
    });
  });
});
