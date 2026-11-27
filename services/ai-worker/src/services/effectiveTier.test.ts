import { AIProvider } from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateAttemptOpts } from '../jobs/handlers/pipeline/steps/autoPromotionFallback.js';
import { selectHopOneFloorTarget } from '../jobs/handlers/pipeline/steps/hopOneFloorTarget.js';
import { buildPostRouteLlmAuth } from '../jobs/handlers/pipeline/steps/postRouteLlmAuth.js';
import {
  tryPromotionDemotion,
  type DemotableAuth,
} from '../jobs/handlers/pipeline/steps/promotionDemotion.js';
import type { ApiKeySource } from './ApiKeyResolver.js';
import { CreditExhaustionCache } from './CreditExhaustionCache.js';
import {
  authCacheKeyId,
  type EffectiveTier,
  type KeyState,
  provenanceFromResolution,
  resolveEffectiveTier,
  resolveKeyState,
} from './effectiveTier.js';
import { KeyInvalidCache } from './KeyInvalidCache.js';
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
type KeyPresence = 'none' | 'ok';
type MatrixPath =
  'chat-route' | 'promote' | 'floor-selection' | 'ladder-entry' | 'vision-selection';

interface MatrixRow {
  userKind: UserKind;
  keyPresence: KeyPresence;
  keyState?: KeyState;
  path: MatrixPath;
  expected: {
    effectiveTier: EffectiveTier;
    cacheKeyId: string;
    floorTarget: string;
  };
}

const MATRIX_ROWS: MatrixRow[] = [
  // --- userKind: 'guest', keyPresence: 'none' (source: 'system', no key, isGuestMode: true) ---
  {
    userKind: 'guest',
    keyPresence: 'none',
    path: 'chat-route',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyPresence: 'none',
    path: 'promote',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyPresence: 'none',
    path: 'floor-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyPresence: 'none',
    path: 'ladder-entry',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyPresence: 'none',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'guest', keyPresence: 'ok' (source: 'system', operator system key, isGuestMode: true) ---
  {
    userKind: 'guest',
    keyPresence: 'ok',
    path: 'chat-route',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyPresence: 'ok',
    path: 'promote',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyPresence: 'ok',
    path: 'floor-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'guest',
    keyPresence: 'ok',
    path: 'ladder-entry',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'free-keyless', keyPresence: 'none' (source: 'system', no key, isGuestMode: false) ---
  {
    userKind: 'free-keyless',
    keyPresence: 'none',
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
    keyPresence: 'none',
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
    keyPresence: 'none',
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
    keyPresence: 'none',
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
    keyPresence: 'none',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'BYOK-degraded-to-system', keyPresence: 'ok' (source: 'system', operator system key, isGuestMode: false) ---
  {
    userKind: 'BYOK-degraded-to-system',
    keyPresence: 'ok',
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
    keyPresence: 'ok',
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
    keyPresence: 'ok',
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
    keyPresence: 'ok',
    path: 'ladder-entry',
    // was: cacheKeyId 'user:278863839632818186' (D10 leak) and selectQuotaFallbackTarget selected PAID_FLOOR_MODEL via getGlobalDefaultConfig instead of FREE_FLOOR_MODEL via getFreeDefaultConfig
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK-degraded-to-system',
    keyPresence: 'ok',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'BYOK', keyPresence: 'none' (source: 'user', missing/empty key, isGuestMode: false) ---
  {
    userKind: 'BYOK',
    keyPresence: 'none',
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
    keyPresence: 'none',
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
    keyPresence: 'none',
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
    keyPresence: 'none',
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
    keyPresence: 'none',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: SYSTEM_CACHE_KEY_ID,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'BYOK', keyPresence: 'ok' (source: 'user', valid personal wallet key, isGuestMode: false) ---
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    path: 'chat-route',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    path: 'promote',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    path: 'floor-selection',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    path: 'ladder-entry',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'paid',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: PAID_FLOOR_MODEL,
    },
  },

  // --- userKind: 'BYOK', keyPresence: 'ok', keyState: 'low-credit' (demoted BYOK key) ---
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    keyState: 'low-credit',
    path: 'chat-route',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    keyState: 'low-credit',
    path: 'floor-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    keyState: 'low-credit',
    path: 'ladder-entry',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    keyState: 'low-credit',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },

  // --- userKind: 'BYOK', keyPresence: 'ok', keyState: 'invalid' (demoted BYOK key) ---
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    keyState: 'invalid',
    path: 'chat-route',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    keyState: 'invalid',
    path: 'floor-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    keyState: 'invalid',
    path: 'ladder-entry',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
  {
    userKind: 'BYOK',
    keyPresence: 'ok',
    keyState: 'invalid',
    path: 'vision-selection',
    expected: {
      effectiveTier: 'free',
      cacheKeyId: `user:${DISCORD_USER_ID}`,
      floorTarget: FREE_FLOOR_MODEL,
    },
  },
];

function deriveFixtureInputs(
  userKind: UserKind,
  keyPresence: KeyPresence
): {
  source: ApiKeySource;
  resolvedApiKey: string | undefined;
  isGuestModeFlag: boolean;
} {
  const source: ApiKeySource = userKind === 'BYOK' ? 'user' : 'system';
  if (keyPresence === 'none') {
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
    creditExhaustion: {
      isCreditExhausted: vi.fn().mockResolvedValue({ exhausted: false }),
    } as unknown as QuotaFallbackCaches['creditExhaustion'],
    keyInvalid: {
      isKeyInvalid: vi.fn().mockResolvedValue({ invalid: false }),
    } as unknown as QuotaFallbackCaches['keyInvalid'],
    rateLimit: {
      isRateLimited: vi.fn().mockResolvedValue({ rateLimited: false }),
    } as unknown as QuotaFallbackCaches['rateLimit'],
  } satisfies QuotaFallbackCaches;
}

describe('provenanceFromResolution', () => {
  it('returns none when resolvedApiKey is empty or undefined regardless of source', () => {
    expect(provenanceFromResolution('user', '')).toBe('none');
    expect(provenanceFromResolution('system', '')).toBe('none');
    expect(provenanceFromResolution('user', undefined)).toBe('none');
    expect(provenanceFromResolution('system', undefined)).toBe('none');
  });

  it('returns system when source is system and key is non-empty', () => {
    expect(provenanceFromResolution('system', FAKE_SYSTEM_KEY)).toBe('system');
  });

  it('returns user when source is user and key is non-empty', () => {
    expect(provenanceFromResolution('user', FAKE_USER_KEY)).toBe('user');
  });
});

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
    'resolves ($userKind, keyPresence=$keyPresence, keyState=$keyState, path=$path)',
    async ({ userKind, keyPresence, keyState, path, expected }) => {
      const { source, resolvedApiKey, isGuestModeFlag } = deriveFixtureInputs(
        userKind,
        keyPresence
      );
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
        const llmAuth = buildPostRouteLlmAuth(route, BASE_PERSONALITY, undefined, keyState);
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
        const initialTier = resolveEffectiveTier({ keyProvenance, keyState });
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
        effectiveTier = resolveEffectiveTier({ keyProvenance, keyState });
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
        const llmAuth = buildPostRouteLlmAuth(route, BASE_PERSONALITY, undefined, keyState);
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
        effectiveTier = resolveEffectiveTier({ keyProvenance, keyState });
        cacheKeyId = authCacheKeyId({ keyProvenance }, resolvedApiKey, DISCORD_USER_ID);
        const configResolver = {
          getFreeDefaultConfig: vi.fn().mockResolvedValue({ model: FREE_FLOOR_MODEL }),
          getGlobalDefaultConfig: vi.fn().mockResolvedValue({ model: PAID_FLOOR_MODEL }),
        };
        const target = await selectQuotaFallbackTarget({
          category: ApiErrorCategory.QUOTA_EXCEEDED,
          tier: effectiveTier,
          keyProvenance,
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

  describe('resolveKeyState producer', () => {
    const USER_CACHE_KEY_ID = `user:${DISCORD_USER_ID}`;

    function buildProducerCaches(opts?: {
      exhausted?: boolean;
      invalid?: boolean;
      exhaustedTtlSeconds?: number;
      invalidTtlSeconds?: number;
      rejectExhausted?: boolean;
      rejectInvalid?: boolean;
    }): { creditExhaustion: CreditExhaustionCache; keyInvalid: KeyInvalidCache } {
      const creditExhaustion = {
        isCreditExhausted: opts?.rejectExhausted
          ? vi.fn().mockRejectedValue(new Error('redis down'))
          : vi.fn().mockResolvedValue(
              opts?.exhausted
                ? {
                    exhausted: true,
                    exhaustedAtMs: 1_000,
                    ttlSeconds: opts?.exhaustedTtlSeconds ?? 600,
                  }
                : { exhausted: false }
            ),
      } as unknown as CreditExhaustionCache;
      const keyInvalid = {
        isKeyInvalid: opts?.rejectInvalid
          ? vi.fn().mockRejectedValue(new Error('redis down'))
          : vi.fn().mockResolvedValue(
              opts?.invalid
                ? {
                    invalid: true,
                    invalidAtMs: 1_000,
                    ttlSeconds: opts?.invalidTtlSeconds ?? 600,
                  }
                : { invalid: false }
            ),
      } as unknown as KeyInvalidCache;
      return { creditExhaustion, keyInvalid };
    }

    it('returns low-credit when the credit-exhaustion cache reports an active mark', async () => {
      const caches = buildProducerCaches({ exhausted: true });
      const state = await resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches });
      expect(state).toBe('low-credit');
      expect(resolveEffectiveTier({ keyProvenance: 'user', keyState: state })).toBe('free');
    });

    it('returns invalid when the key-invalid cache reports an active mark', async () => {
      const caches = buildProducerCaches({ invalid: true });
      const state = await resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches });
      expect(state).toBe('invalid');
      expect(resolveEffectiveTier({ keyProvenance: 'user', keyState: state })).toBe('free');
    });

    it('an active credit mark with a floored sub-second ttl (ttlSeconds: 0) still demotes to low-credit', async () => {
      const caches = buildProducerCaches({ exhausted: true, exhaustedTtlSeconds: 0 });
      const state = await resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches });
      expect(state).toBe('low-credit');
    });

    it('an active invalid mark with a floored sub-second ttl (ttlSeconds: 0) still demotes to invalid', async () => {
      const caches = buildProducerCaches({ invalid: true, invalidTtlSeconds: 0 });
      const state = await resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches });
      expect(state).toBe('invalid');
    });

    it('returns invalid (precedence) when BOTH invalid and credit-exhaustion marks exist', async () => {
      const caches = buildProducerCaches({ invalid: true, exhausted: true });
      const state = await resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches });
      expect(state).toBe('invalid');
      // The two reads run concurrently, so both caches are queried; the
      // precedence lives in the RETURNED label only.
      expect(caches.creditExhaustion.isCreditExhausted).toHaveBeenCalled();
    });

    it('returns ok when neither cache has a mark', async () => {
      const caches = buildProducerCaches();
      const state = await resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches });
      expect(state).toBe('ok');
      expect(resolveEffectiveTier({ keyProvenance: 'user', keyState: state })).toBe('paid');
    });

    it('returns ok for an empty cacheKeyId without querying either cache', async () => {
      const caches = buildProducerCaches({ invalid: true, exhausted: true });
      const state = await resolveKeyState({ cacheKeyId: '', caches });
      expect(state).toBe('ok');
      expect(caches.keyInvalid.isKeyInvalid).not.toHaveBeenCalled();
      expect(caches.creditExhaustion.isCreditExhausted).not.toHaveBeenCalled();
    });

    it('fails open to ok when a cache read rejects', async () => {
      const bothReject = buildProducerCaches({ rejectInvalid: true, rejectExhausted: true });
      await expect(
        resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches: bothReject })
      ).resolves.toBe('ok');

      const invalidRejectsExhaustedHits = buildProducerCaches({
        rejectInvalid: true,
        exhausted: true,
      });
      await expect(
        resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches: invalidRejectsExhaustedHits })
      ).resolves.toBe('low-credit');
    });

    it('recovers to ok and paid tier once the mark TTL expires', async () => {
      vi.useFakeTimers();
      try {
        const FIXED_NOW_MS = 1_777_500_000_000;
        vi.setSystemTime(FIXED_NOW_MS);

        // Models Redis key eviction at the setex TTL: an expired key reads null.
        const store = new Map<string, { value: string; expiresAtMs: number }>();
        const fakeRedis = {
          setex: vi.fn((key: string, ttl: number, value: string) => {
            store.set(key, { value, expiresAtMs: Date.now() + ttl * 1000 });
            return Promise.resolve('OK');
          }),
          get: vi.fn((key: string) => {
            const entry = store.get(key);
            return Promise.resolve(
              entry !== undefined && entry.expiresAtMs > Date.now() ? entry.value : null
            );
          }),
          del: vi.fn((key: string) => {
            const existed = store.delete(key);
            return Promise.resolve(existed ? 1 : 0);
          }),
        } as unknown as Redis;

        const creditCache = new CreditExhaustionCache(fakeRedis);
        const invalidCache = new KeyInvalidCache(fakeRedis);
        const caches = { creditExhaustion: creditCache, keyInvalid: invalidCache };

        await creditCache.markCreditExhausted({ cacheKeyId: USER_CACHE_KEY_ID, ttlSeconds: 60 });

        const duringTtlState = await resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches });
        expect(duringTtlState).toBe('low-credit');
        expect(resolveEffectiveTier({ keyProvenance: 'user', keyState: duringTtlState })).toBe(
          'free'
        );

        // Advance past the 60s TTL window
        vi.advanceTimersByTime(61_000);

        const postExpiryState = await resolveKeyState({ cacheKeyId: USER_CACHE_KEY_ID, caches });
        expect(postExpiryState).toBe('ok');
        expect(resolveEffectiveTier({ keyProvenance: 'user', keyState: postExpiryState })).toBe(
          'paid'
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
