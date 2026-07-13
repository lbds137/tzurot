/**
 * Tests for visionAuthResolver
 *
 * Covers the unified `resolveVisionConfig` decision tree:
 * - Same-provider fast path → reuse main key, no resolver call
 * - Genuine guest → system key + free model
 * - Authenticated user with a vision-provider key → user key + natural model
 * - Authenticated user with NO vision-provider key → BROAD FREE FALLBACK
 *   (free gemma model on the system key, source 'system', isGuestMode false)
 * - Authenticated user, no vision key AND no system key → failFast
 *   (fallback-of-fallback)
 * - Transient resolver throw → graceful failFast degrade
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { AIProvider, FREE_ROUTER_MODEL } from '@tzurot/common-types/constants/ai';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import {
  resolveVisionConfig,
  resolveVisionAuth,
  createVisionQuotaTracker,
  visionAuthFailFastDescription,
} from './visionAuthResolver.js';
import { selectVisionModel, buildFailureFallback } from './VisionProcessor.js';
import type { ApiKeyResolver } from '../ApiKeyResolver.js';

// Logger mock — visionAuthResolver imports createLogger from common-types
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

// selectVisionModel is now called internally by resolveVisionConfig. Mock it so
// each test controls the "natural" model the resolver derives the provider from,
// without reaching into Redis (hasVisionSupport).
vi.mock('./VisionProcessor.js', () => ({
  selectVisionModel: vi.fn(),
  // visionAuthFailFastDescription delegates to this at call time. vi.fn so the
  // delegation test can assert the args that cross the seam (incl. the filename).
  buildFailureFallback: vi.fn(
    (category: string, source?: string) =>
      `[Image unavailable: mock ${String(category)}/${source ?? 'none'}]`
  ),
}));

// VisionDescriptionCache singleton mock — stubbed for module-load safety; we just
// verify the call shape where relevant.
const mockStoreFailure = vi.fn();
// Default: quota allows (under cap). Over-cap tests override per-case.
const mockTryConsume = vi.fn().mockResolvedValue(true);
vi.mock('../../redis.js', () => ({
  visionDescriptionCache: {
    tryAcquireInflight: vi.fn().mockResolvedValue(true),
    isInflight: vi.fn().mockResolvedValue(false),
    releaseInflight: vi.fn().mockResolvedValue(undefined),
    storeFailure: (...args: unknown[]) => mockStoreFailure(...args),
  },
  visionFallbackQuota: {
    tryConsume: (...args: unknown[]) => mockTryConsume(...args),
  },
}));

const mockSelectVisionModel = vi.mocked(selectVisionModel);

const personality: LoadedPersonality = {
  id: 'pers-1',
  ownerId: 'owner-1',
  name: 'TestPersona',
  slug: 'test',
  model: 'glm-5.1',
  visionModel: 'qwen/qwen3.5-397b-a17b',
  systemPrompt: '',
  temperature: 0.7,
  topP: 1,
} as unknown as LoadedPersonality;

const mockResolveApiKey = vi.fn();
const mockTryResolveUserKey = vi.fn();

const mockResolver: ApiKeyResolver = {
  resolveApiKey: mockResolveApiKey,
  tryResolveUserKey: mockTryResolveUserKey,
} as unknown as ApiKeyResolver;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: under the daily fallback cap. Over-cap tests override per-case.
  mockTryConsume.mockResolvedValue(true);
});

describe('resolveVisionConfig', () => {
  describe('same-provider fast path', () => {
    it('reuses main key + natural model when vision and main share provider', async () => {
      // Natural model is on OpenRouter; mainProvider is OpenRouter → fast path.
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b');

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: 'main-or-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(result).toEqual({
        kind: 'resolved',
        config: {
          apiKey: 'main-or-key',
          provider: AIProvider.OpenRouter,
          model: 'qwen/qwen3.5-397b-a17b',
          source: 'user',
          isGuestMode: false,
        },
      });
      expect(mockResolveApiKey).not.toHaveBeenCalled();
      expect(mockTryResolveUserKey).not.toHaveBeenCalled();
    });

    it('marks source as "system" on the fast path when main was guest-mode', async () => {
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b');

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: 'system-or-key',
        isGuestMode: true,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved') {
        expect(result.config.source).toBe('system');
        expect(result.config.isGuestMode).toBe(true);
      }
    });

    it('skips fast path when mainApiKey is empty (AuthStep degraded path)', async () => {
      // main+vision both OpenRouter, but mainApiKey empty → per-provider resolution.
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3-72b');
      mockTryResolveUserKey.mockResolvedValue('user-or-key');

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: '',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved') {
        expect(result.config.apiKey).toBe('user-or-key');
      }
    });

    it('skips fast path when mainProvider is undefined (upload-time job)', async () => {
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b');
      mockTryResolveUserKey.mockResolvedValue('user-or-key');

      const result = await resolveVisionConfig({
        personality,
        mainProvider: undefined,
        mainApiKey: undefined,
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      // No fast path → per-provider authenticated lookup runs.
      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
      expect(result.kind).toBe('resolved');
    });
  });

  describe('genuine guest', () => {
    it('resolves system key + free model via resolveApiKey when isGuestMode=true', async () => {
      // selectVisionModel returns the free model for guests.
      mockSelectVisionModel.mockResolvedValue(FREE_ROUTER_MODEL);
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'system-or-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        isGuestMode: true,
        userId: undefined,
      });

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'system-zai-key',
        isGuestMode: true,
        userId: undefined,
        apiKeyResolver: mockResolver,
      });

      expect(result).toEqual({
        kind: 'resolved',
        config: {
          apiKey: 'system-or-key',
          provider: AIProvider.OpenRouter,
          model: FREE_ROUTER_MODEL,
          source: 'system',
          isGuestMode: true,
        },
      });
      expect(mockResolveApiKey).toHaveBeenCalledWith(undefined, AIProvider.OpenRouter);
      expect(mockTryResolveUserKey).not.toHaveBeenCalled();
    });
  });

  describe('live free-floor read (fallbackVisionModelFree)', () => {
    it('a divergent-from-fallback registered value flows into the guest floor resolution', async () => {
      // The registry fallback coincidentally equals the retired constant, so
      // only a divergent value proves the resolver reads the live setting.
      registerSystemSettings({
        get: (key: string) =>
          key === 'fallbackVisionModelFree' ? 'divergent/guest-vision:free' : undefined,
      } as unknown as SystemSettingsService);
      try {
        mockSelectVisionModel.mockResolvedValue('divergent/guest-vision:free');
        mockResolveApiKey.mockResolvedValue({
          apiKey: 'system-or-key',
          source: 'system',
          provider: AIProvider.OpenRouter,
          isGuestMode: true,
          userId: undefined,
        });

        const result = await resolveVisionConfig({
          personality,
          mainProvider: AIProvider.ZaiCoding,
          mainApiKey: 'user-zai-key',
          isGuestMode: false, // zai BYOK cross-provider path — hits the free-floor branch
          userId: 'user-1',
          apiKeyResolver: mockResolver,
        });

        expect(result.kind).toBe('resolved');
        if (result.kind === 'resolved') {
          expect(result.config.model).toBe('divergent/guest-vision:free');
        }
      } finally {
        resetSystemSettingsRegistration();
      }
    });
  });

  describe('authenticated user with vision-provider key', () => {
    it('returns user key + natural model when the user has the vision-provider key', async () => {
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b'); // OpenRouter
      mockTryResolveUserKey.mockResolvedValue('user-or-key');

      const result = await resolveVisionConfig({
        personality, // main=glm-5.1 (z.ai), vision=qwen/... (OpenRouter)
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(result).toEqual({
        kind: 'resolved',
        config: {
          apiKey: 'user-or-key',
          provider: AIProvider.OpenRouter,
          model: 'qwen/qwen3.5-397b-a17b',
          source: 'user',
          isGuestMode: false,
        },
      });
      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
      // No system fallback was consulted for the natural provider.
      expect(mockResolveApiKey).not.toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
    });
  });

  describe('BROAD FREE FALLBACK — authenticated user, no vision-provider key', () => {
    it('downgrades to the free gemma model on the system key (source system, isGuestMode false)', async () => {
      // Natural model is on OpenRouter; user has NO OpenRouter key.
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b');
      mockTryResolveUserKey.mockResolvedValue(null);
      // resolveApiKey for the FREE provider returns the system key.
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'system-or-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        isGuestMode: true,
        userId: 'user-1',
      });

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved') {
        // Headline assertions: free model forced, system key, NOT guest.
        expect(result.config.model).toBe(FREE_ROUTER_MODEL);
        expect(result.config.apiKey).toBe('system-or-key');
        expect(result.config.source).toBe('system');
        expect(result.config.isGuestMode).toBe(false);
        expect(result.config.provider).toBe(AIProvider.OpenRouter);
      }
      // The free model lives on OpenRouter — resolveApiKey was asked for that provider.
      expect(mockResolveApiKey).toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
      // The system-key downgrade is counted against the per-user daily cap.
      expect(mockTryConsume).toHaveBeenCalledWith('user-1');
    });

    it('fails fast when the user is over the daily system-fallback cap', async () => {
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b');
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'system-or-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        isGuestMode: true,
        userId: 'user-1',
      });
      mockTryConsume.mockResolvedValue(false); // over the cap

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(result).toEqual({ kind: 'failFast', provider: AIProvider.OpenRouter });
    });

    it('does NOT consume the cap when the user falls back onto their OWN OpenRouter key', async () => {
      // User has no key for the vision provider but DOES have an OpenRouter key,
      // so resolveApiKey returns source 'user' — their own key, not the owner's
      // system key, so the freeloading cap must not apply.
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b');
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'user-or-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        isGuestMode: false,
        userId: 'user-1',
      });

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved') {
        expect(result.config.source).toBe('user');
        expect(result.config.model).toBe(FREE_ROUTER_MODEL);
      }
      expect(mockTryConsume).not.toHaveBeenCalled();
    });
  });

  describe('fallback-of-fallback — no system key for the free provider', () => {
    it('fails fast against the ORIGINAL vision provider when resolveApiKey throws', async () => {
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b'); // OpenRouter
      mockTryResolveUserKey.mockResolvedValue(null);
      // No system OpenRouter key configured → resolveApiKey throws.
      mockResolveApiKey.mockRejectedValue(
        new Error('No API key available for provider openrouter')
      );

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(result).toEqual({ kind: 'failFast', provider: AIProvider.OpenRouter });
    });

    it('fails fast when resolveApiKey returns an empty key (defense in depth)', async () => {
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b');
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockResolvedValue({
        apiKey: '',
        source: 'system',
        provider: AIProvider.OpenRouter,
        isGuestMode: true,
        userId: 'user-1',
      });

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(result).toEqual({ kind: 'failFast', provider: AIProvider.OpenRouter });
    });
  });

  describe('transient resolver throw', () => {
    it('degrades to failFast when tryResolveUserKey throws (authenticated path)', async () => {
      mockSelectVisionModel.mockResolvedValue('qwen/qwen3.5-397b-a17b');
      mockTryResolveUserKey.mockRejectedValue(new Error('Redis blip'));

      const result = await resolveVisionConfig({
        personality,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(result).toEqual({ kind: 'failFast', provider: AIProvider.OpenRouter });
    });
  });
});

describe('resolveVisionAuth (direct, model-parameterized)', () => {
  // resolveVisionConfig delegates to resolveVisionAuth after computing the natural
  // model; these lock the parameterization the Phase-4 fallback loop relies on —
  // the caller supplies the tier model, and resolveVisionAuth honors it verbatim
  // WITHOUT consulting selectVisionModel.
  it('honors the caller-supplied targetModel (does not call selectVisionModel)', async () => {
    mockTryResolveUserKey.mockResolvedValue('user-or-key');

    const result = await resolveVisionAuth(
      'fallback/tier-model',
      {
        personality,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: '', // empty → skip fast path → per-provider resolution
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      },
      createVisionQuotaTracker('user-1'),
      false
    );

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.config.model).toBe('fallback/tier-model');
      // Provider is self-derived from the target model (detectVisionProvider) → OpenRouter.
      expect(result.config.provider).toBe(AIProvider.OpenRouter);
    }
    // The tier model is provided by the caller — resolveVisionAuth must not re-derive it.
    expect(mockSelectVisionModel).not.toHaveBeenCalled();
  });

  it('reuses the main key on the same-provider fast path for the PRIMARY tier', async () => {
    const result = await resolveVisionAuth(
      'fallback/tier-model',
      {
        personality,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: 'main-or-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      },
      createVisionQuotaTracker('user-1'),
      true
    );

    expect(result).toEqual({
      kind: 'resolved',
      config: {
        apiKey: 'main-or-key',
        provider: AIProvider.OpenRouter,
        model: 'fallback/tier-model',
        source: 'user',
        isGuestMode: false,
      },
    });
    expect(mockSelectVisionModel).not.toHaveBeenCalled();
  });

  it('skips the fast path on a FALLBACK tier even when providers match', async () => {
    // The dead-key resilience seam: after a tier-1 failure, a same-provider tier-2
    // must NOT re-hand back the identical upstream key — per-provider resolution
    // picks up the user's wallet key instead.
    mockTryResolveUserKey.mockResolvedValue('wallet-key');

    const result = await resolveVisionAuth(
      'fallback/tier-model',
      {
        personality,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: 'main-or-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      },
      createVisionQuotaTracker('user-1'),
      false
    );

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      // The wallet key, NOT the reused main key.
      expect(result.config.apiKey).toBe('wallet-key');
    }
    expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
  });

  it('forces the free model for a GUEST on a fallback tier (no system key on paid tiers)', async () => {
    // A stamped fallback can be the admin's PAID global default; a guest walking
    // onto it must not put the system key on a paid model.
    mockResolveApiKey.mockResolvedValue({
      apiKey: 'system-key',
      source: 'system',
      isGuestMode: true,
    });

    const result = await resolveVisionAuth(
      'paid/global-default-vision',
      {
        personality,
        mainProvider: undefined,
        mainApiKey: undefined,
        isGuestMode: true,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      },
      createVisionQuotaTracker('user-1'),
      false
    );

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.config.model).toBe(FREE_ROUTER_MODEL);
      expect(result.config.apiKey).toBe('system-key');
    }
  });
});

describe('createVisionQuotaTracker', () => {
  it('latches after ANY real check — an over-cap first answer stops later store hits', async () => {
    // The seam: the underlying Redis-backed store must be hit at most ONCE per
    // tracker, even when the first answer is over-cap (false) — the answer can't
    // change within one tracker's lifetime, and re-hitting the store costs real
    // INCR+EXPIRE round-trips for an already-denied user.
    mockTryConsume.mockResolvedValueOnce(false);
    const tracker = createVisionQuotaTracker('user-1');

    expect(await tracker.tryConsume()).toBe(false);
    expect(await tracker.tryConsume()).toBe(false);
    expect(mockTryConsume).toHaveBeenCalledTimes(1);
  });

  it('visionAuthFailFastDescription renders the AUTH+user placeholder with the filename', () => {
    // Delegates to buildFailureFallback (mocked above as
    // `[Image unavailable: mock <category>/<source>]`) with the AUTH+user branch;
    // the filename is forwarded as the third arg for the per-request render.
    const rendered = visionAuthFailFastDescription('photo.png');
    expect(rendered).toBe('[Image unavailable: mock authentication/user]');
    // The seam: category, source, AND the filename must all cross to the renderer.
    expect(vi.mocked(buildFailureFallback)).toHaveBeenCalledWith(
      'authentication',
      'user',
      'photo.png'
    );
  });
});
