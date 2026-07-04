/**
 * Tests for ProviderRouter
 *
 * Covers the routing decision tree:
 * - Non-zai-coding providers passthrough unchanged
 * - zai-coding with user key → direct route
 * - zai-coding without user key → OpenRouter fallthrough with model rewrite
 * - zai-coding without ANY key → throws (inherited from ApiKeyResolver)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import {
  ProviderRouter,
  detectVisionProvider,
  effectiveVisionModelName,
} from './ProviderRouter.js';
import type { ApiKeyResolver, ApiKeyResolutionResult } from './ApiKeyResolver.js';

// Mock logger via the shared common-types mock pattern
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

describe('ProviderRouter', () => {
  let mockResolveApiKey: ReturnType<typeof vi.fn>;
  let mockTryResolveUserKey: ReturnType<typeof vi.fn>;
  let mockApiKeyResolver: ApiKeyResolver;
  let router: ProviderRouter;

  beforeEach(() => {
    mockResolveApiKey = vi.fn();
    mockTryResolveUserKey = vi.fn();
    mockApiKeyResolver = {
      resolveApiKey: mockResolveApiKey,
      tryResolveUserKey: mockTryResolveUserKey,
    } as unknown as ApiKeyResolver;
    router = new ProviderRouter(mockApiKeyResolver);
  });

  describe('non-zai-coding providers (passthrough)', () => {
    it('should pass through OpenRouter without invoking the fallthrough path', async () => {
      const resolution: ApiKeyResolutionResult = {
        apiKey: 'sk-or-user-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      };
      mockResolveApiKey.mockResolvedValue(resolution);

      const route = await router.resolveRoute(
        AIProvider.OpenRouter,
        'anthropic/claude-sonnet-4.5',
        'user-123'
      );

      expect(mockResolveApiKey).toHaveBeenCalledWith('user-123', AIProvider.OpenRouter);
      // Auto-promotion check fires on every OpenRouter request to inspect the
      // model. For non-z-ai/ models (like anthropic/...) it short-circuits
      // before the key lookup, so tryResolveUserKey is not called.
      expect(mockTryResolveUserKey).not.toHaveBeenCalled();
      expect(route).toEqual({
        effectiveProvider: AIProvider.OpenRouter,
        effectiveModel: 'anthropic/claude-sonnet-4.5',
        apiKey: 'sk-or-user-key',
        isGuestMode: false,
        fallthroughTriggered: false,
        wasAutoPromoted: false,
      });
    });

    it('should preserve guest-mode status from resolveApiKey on passthrough', async () => {
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'system-openrouter-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: true,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(
        AIProvider.OpenRouter,
        'glm-4.5-air:free',
        'user-123'
      );

      expect(route.isGuestMode).toBe(true);
      expect(route.fallthroughTriggered).toBe(false);
    });
  });

  describe('zai-coding with user key (direct route)', () => {
    it('should route directly to z.ai with the configured model when user has zai-coding key', async () => {
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');

      const route = await router.resolveRoute(AIProvider.ZaiCoding, 'glm-4.7', 'user-123');

      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-123', AIProvider.ZaiCoding);
      expect(mockResolveApiKey).not.toHaveBeenCalled(); // No fallthrough
      expect(route).toEqual({
        effectiveProvider: AIProvider.ZaiCoding,
        effectiveModel: 'glm-4.7',
        apiKey: 'zai-user-key',
        isGuestMode: false,
        fallthroughTriggered: false,
        wasAutoPromoted: false,
      });
    });

    it('should NOT rewrite the model name on direct z.ai route', async () => {
      // Critical: the model rewrite (`glm-4.7` → `z-ai/glm-4.7`) only fires
      // on fallthrough. Direct route uses the configured model verbatim.
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');

      const route = await router.resolveRoute(AIProvider.ZaiCoding, 'glm-4.5-flash', 'user-456');

      expect(route.effectiveModel).toBe('glm-4.5-flash');
      expect(route.effectiveModel).not.toContain('z-ai/');
    });

    it('should always set isGuestMode=false on direct z.ai route (no system fallback)', async () => {
      // z.ai has no operator-provided fallback key; if the user has a key
      // they're paying via their own subscription, not on the system.
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');

      const route = await router.resolveRoute(AIProvider.ZaiCoding, 'glm-4.7', 'user-123');

      expect(route.isGuestMode).toBe(false);
    });
  });

  describe('zai-coding without user key (auto-fallthrough)', () => {
    it('should route to OpenRouter with z-ai/ prefix when user has no zai-coding key', async () => {
      mockTryResolveUserKey.mockResolvedValue(null); // No user key
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-user-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.ZaiCoding, 'glm-4.7', 'user-123');

      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-123', AIProvider.ZaiCoding);
      expect(mockResolveApiKey).toHaveBeenCalledWith('user-123', AIProvider.OpenRouter);
      expect(route).toEqual({
        effectiveProvider: AIProvider.OpenRouter,
        effectiveModel: 'z-ai/glm-4.7',
        apiKey: 'sk-or-user-key',
        isGuestMode: false,
        fallthroughTriggered: true,
        wasAutoPromoted: false,
      });
    });

    it('should preserve guest-mode status from OpenRouter system fallback on fallthrough', async () => {
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'system-openrouter-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: true,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.ZaiCoding, 'glm-4.7', 'user-123');

      expect(route.isGuestMode).toBe(true);
      expect(route.fallthroughTriggered).toBe(true);
    });

    it('should rewrite glm-4.5-flash → z-ai/glm-4.5-flash on fallthrough', async () => {
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.ZaiCoding, 'glm-4.5-flash', 'user-123');

      expect(route.effectiveModel).toBe('z-ai/glm-4.5-flash');
    });

    it('should NOT double-prefix already-namespaced model on fallthrough (z-ai/glm-4.7 stays z-ai/glm-4.7)', async () => {
      // Edge case: someone configures provider: 'zai-coding' with an
      // already-OpenRouter-namespaced model like 'z-ai/glm-4.7'. Naive concat
      // would produce 'z-ai/z-ai/glm-4.7' which 404s silently. Guard reuses
      // the configured model verbatim when it's already prefixed.
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.ZaiCoding, 'z-ai/glm-4.7', 'user-123');

      expect(route.effectiveModel).toBe('z-ai/glm-4.7');
      expect(route.effectiveModel).not.toContain('z-ai/z-ai/');
      expect(route.fallthroughTriggered).toBe(true);
    });

    it('should propagate ApiKeyResolver throw when both zai-coding AND OpenRouter resolution fail', async () => {
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockRejectedValue(
        new Error('No API key available for provider openrouter.')
      );

      await expect(
        router.resolveRoute(AIProvider.ZaiCoding, 'glm-4.7', 'user-with-no-keys')
      ).rejects.toThrow(/No API key available/);
    });
  });

  describe('userId handling', () => {
    it('should pass undefined userId through to ApiKeyResolver on passthrough', async () => {
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'system-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: undefined,
        isGuestMode: true,
      } satisfies ApiKeyResolutionResult);

      await router.resolveRoute(AIProvider.OpenRouter, 'glm-4.5-air:free', undefined);

      expect(mockResolveApiKey).toHaveBeenCalledWith(undefined, AIProvider.OpenRouter);
    });

    it('should trigger fallthrough when userId is undefined (tryResolveUserKey returns null per contract)', async () => {
      // When userId is undefined, tryResolveUserKey returns null per contract.
      // The null result triggers the fallthrough path — we still call
      // tryResolveUserKey because its contract is well-defined for the
      // undefined-userId case.
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'system-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: undefined,
        isGuestMode: true,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.ZaiCoding, 'glm-4.7', undefined);

      expect(route.fallthroughTriggered).toBe(true);
      expect(route.effectiveModel).toBe('z-ai/glm-4.7');
    });
  });

  describe('OpenRouter z-ai/ auto-promotion', () => {
    it('should promote z-ai/glm-5.1 to z.ai-direct when user has zai-coding key', async () => {
      // The single-preset UX: user has one preset configured for OpenRouter
      // (the broadly-compatible default) with model z-ai/glm-5.1, AND has a
      // z.ai-coding key. ProviderRouter should detect this and route direct
      // to z.ai with the bare model name (stripped z-ai/ prefix).
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');
      // Promotion pre-computes the OpenRouter fallback for retry-with-fallback;
      // the mock must serve openrouter resolution even though the happy path
      // never uses the result directly.
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-user-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.OpenRouter, 'z-ai/glm-5.1', 'user-123');

      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-123', AIProvider.ZaiCoding);
      expect(mockResolveApiKey).toHaveBeenCalledWith('user-123', AIProvider.OpenRouter);
      expect(route).toEqual({
        effectiveProvider: AIProvider.ZaiCoding,
        effectiveModel: 'glm-5.1', // bare, stripped of z-ai/ prefix
        apiKey: 'zai-user-key',
        isGuestMode: false,
        fallthroughTriggered: false,
        wasAutoPromoted: true,
        fallback: {
          apiKey: 'sk-or-user-key',
          provider: AIProvider.OpenRouter,
          model: 'z-ai/glm-5.1', // original namespaced form preserved for retry
          isGuestMode: false,
        },
      } satisfies typeof route);
    });

    it('should stay on OpenRouter when user has NO zai-coding key', async () => {
      // No key → promotion doesn't fire, request stays on OpenRouter with the
      // namespaced model name verbatim.
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-user-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.OpenRouter, 'z-ai/glm-5.1', 'user-123');

      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-123', AIProvider.ZaiCoding);
      expect(mockResolveApiKey).toHaveBeenCalledWith('user-123', AIProvider.OpenRouter);
      expect(route).toEqual({
        effectiveProvider: AIProvider.OpenRouter,
        effectiveModel: 'z-ai/glm-5.1', // unchanged — stays on OpenRouter
        apiKey: 'sk-or-user-key',
        isGuestMode: false,
        fallthroughTriggered: false,
        wasAutoPromoted: false,
      } satisfies typeof route);
    });

    it('should stay on OpenRouter when bare model is NOT in coding-plan whitelist', async () => {
      // Whitelist guard against catalog drift: if z.ai ships z-ai/foo to
      // OpenRouter that isn't on the coding plan, promotion would 404.
      // Even with a key present, unknown bare models stay on OpenRouter.
      // Key mock is configured with a valid key so the assertion below can
      // prove the whitelist check fires *before* the key lookup — not because
      // no key exists, but because the whitelist miss short-circuits
      // unconditionally.
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-user-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(
        AIProvider.OpenRouter,
        'z-ai/glm-99-future',
        'user-123'
      );

      // Whitelist miss → tryResolveUserKey is NOT called (short-circuits before
      // the key check to avoid the cost of looking up keys for non-promotable
      // models).
      expect(mockTryResolveUserKey).not.toHaveBeenCalled();
      expect(mockResolveApiKey).toHaveBeenCalledWith('user-123', AIProvider.OpenRouter);
      expect(route.wasAutoPromoted).toBe(false);
      expect(route.effectiveProvider).toBe(AIProvider.OpenRouter);
      expect(route.effectiveModel).toBe('z-ai/glm-99-future');
    });

    it('should NOT promote non-z-ai/ models even with a zai-coding key', async () => {
      // OpenRouter request with anthropic/, openai/, etc. — different
      // namespace, not eligible for z.ai promotion regardless of key state.
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-user-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(
        AIProvider.OpenRouter,
        'anthropic/claude-sonnet-4',
        'user-123'
      );

      expect(mockTryResolveUserKey).not.toHaveBeenCalled(); // short-circuit on prefix miss
      // End-to-end verification: the prefix-miss null return falls through to
      // the OpenRouter passthrough branch (resolveApiKey called for openrouter).
      expect(mockResolveApiKey).toHaveBeenCalledWith('user-123', AIProvider.OpenRouter);
      expect(route.wasAutoPromoted).toBe(false);
      expect(route.effectiveProvider).toBe(AIProvider.OpenRouter);
    });

    it('should stay on OpenRouter when bare model is empty (z-ai/ prefix only)', async () => {
      // Edge case: configuredModel is exactly 'z-ai/' so bareModel becomes ''.
      // isZaiCodingPlanModel('') returns false (covered in ai.test.ts), so the
      // whitelist guard correctly short-circuits and the request stays on
      // OpenRouter via the passthrough branch.
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-user-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.OpenRouter, 'z-ai/', 'user-123');

      expect(mockTryResolveUserKey).not.toHaveBeenCalled(); // whitelist miss short-circuits
      expect(mockResolveApiKey).toHaveBeenCalledWith('user-123', AIProvider.OpenRouter);
      expect(route.wasAutoPromoted).toBe(false);
      expect(route.effectiveProvider).toBe(AIProvider.OpenRouter);
      expect(route.effectiveModel).toBe('z-ai/');
    });

    it('should case-normalize the model name for whitelist lookup', async () => {
      // Preset configs are user-typed strings; z-ai/GLM-5.1 should promote
      // the same as z-ai/glm-5.1. Promoted model name uses lowercase form
      // (z.ai's documented model names are lowercase).
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-user-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: false,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.OpenRouter, 'z-ai/GLM-5.1', 'user-123');

      expect(route.wasAutoPromoted).toBe(true);
      expect(route.effectiveProvider).toBe(AIProvider.ZaiCoding);
      expect(route.effectiveModel).toBe('glm-5.1'); // normalized to lowercase
      // Fallback preserves the original (uppercase) model name verbatim — if
      // OpenRouter retry fires, it'll hit OpenRouter with whatever the preset
      // had. OpenRouter handles case-insensitive matching on its side.
      expect(route.fallback?.model).toBe('z-ai/GLM-5.1');
    });

    it('should still promote when OpenRouter fallback resolution fails (degrade to no-fallback)', async () => {
      // Defensive edge case: if resolveApiKey throws for OpenRouter (DB hiccup,
      // resolver bug), the z.ai promotion should still succeed — the z.ai
      // route is independently viable. The route returns without a `fallback`
      // field, so retry-with-fallback simply won't fire if z.ai later 404s
      // (degrades to pre-PR-#928 UX, which is strictly no worse).
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');
      mockResolveApiKey.mockRejectedValue(new Error('OpenRouter resolver unavailable'));

      const route = await router.resolveRoute(AIProvider.OpenRouter, 'z-ai/glm-5.1', 'user-123');

      expect(route.wasAutoPromoted).toBe(true);
      expect(route.effectiveProvider).toBe(AIProvider.ZaiCoding);
      expect(route.effectiveModel).toBe('glm-5.1');
      expect(route.apiKey).toBe('zai-user-key');
      // Fallback couldn't be computed — but promotion still happened.
      expect(route.fallback).toBeUndefined();
    });

    it('should pre-compute fallback route alongside promotion (for retry-with-fallback)', async () => {
      // Defense in depth against catalog drift: the fallback contains the
      // OpenRouter route ready to swap if z.ai 404s on a stale-whitelist
      // model. Computed on the happy path so the retry decision stays
      // synchronous in GenerationStep.
      mockTryResolveUserKey.mockResolvedValue('zai-user-key');
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'sk-or-system-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: 'user-123',
        isGuestMode: true,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.OpenRouter, 'z-ai/glm-4.7', 'user-123');

      expect(route.wasAutoPromoted).toBe(true);
      expect(route.fallback).toEqual({
        apiKey: 'sk-or-system-key',
        provider: AIProvider.OpenRouter,
        model: 'z-ai/glm-4.7',
        isGuestMode: true, // propagated from openrouter resolution (system key)
      });
    });

    it('should not promote when userId is undefined (no-key path)', async () => {
      // tryResolveUserKey returns null for undefined userId per contract; the
      // null result short-circuits promotion and the request continues on
      // OpenRouter via the standard passthrough.
      mockTryResolveUserKey.mockResolvedValue(null);
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'system-or-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        userId: undefined,
        isGuestMode: true,
      } satisfies ApiKeyResolutionResult);

      const route = await router.resolveRoute(AIProvider.OpenRouter, 'z-ai/glm-5.1', undefined);

      expect(route.wasAutoPromoted).toBe(false);
      expect(route.effectiveProvider).toBe(AIProvider.OpenRouter);
      expect(route.isGuestMode).toBe(true);
    });
  });
});

describe('detectVisionProvider', () => {
  it('routes z-ai/-prefixed models to ZaiCoding', () => {
    expect(detectVisionProvider('z-ai/glm-4.5-air')).toBe(AIProvider.ZaiCoding);
    expect(detectVisionProvider('z-ai/glm-5.1')).toBe(AIProvider.ZaiCoding);
  });

  it('routes bare GLM model names to ZaiCoding (z.ai-direct format)', () => {
    expect(detectVisionProvider('glm-5.1')).toBe(AIProvider.ZaiCoding);
    expect(detectVisionProvider('glm-4.7')).toBe(AIProvider.ZaiCoding);
    expect(detectVisionProvider('glm-4.5-air')).toBe(AIProvider.ZaiCoding);
  });

  it('routes vendor/model formats to OpenRouter', () => {
    expect(detectVisionProvider('qwen/qwen3.5-397b-a17b')).toBe(AIProvider.OpenRouter);
    expect(detectVisionProvider('anthropic/claude-sonnet-4')).toBe(AIProvider.OpenRouter);
    expect(detectVisionProvider('openai/gpt-4o')).toBe(AIProvider.OpenRouter);
    expect(detectVisionProvider('google/gemini-2.5-pro')).toBe(AIProvider.OpenRouter);
    expect(detectVisionProvider('meta-llama/llama-3.3-70b')).toBe(AIProvider.OpenRouter);
  });

  it('does not auto-promote z-ai/ prefixes (deliberately differs from resolveRoute)', () => {
    // detectVisionProvider's purpose is to honor explicit personality choice;
    // a personality that says vision = `z-ai/glm-5v` wants z.ai, not OpenRouter.
    // resolveRoute's auto-promote behavior is for main-model resolution where
    // we adapt to the user's available subscriptions; vision is explicit.
    expect(detectVisionProvider('z-ai/glm-5v')).toBe(AIProvider.ZaiCoding);
  });

  it('routes legacy bare names (no slash, non-glm) to OpenRouter as the catch-all', () => {
    // OpenRouter is the broader catalog; bare names without a recognized z.ai
    // prefix are safer to route via OpenRouter than to mis-detect as z.ai.
    expect(detectVisionProvider('gpt-4-vision-preview')).toBe(AIProvider.OpenRouter);
    expect(detectVisionProvider('claude-3.5-sonnet')).toBe(AIProvider.OpenRouter);
  });
});

describe('effectiveVisionModelName', () => {
  it('returns visionModel when set and non-empty', () => {
    expect(
      effectiveVisionModelName({
        model: 'glm-5.1',
        visionModel: 'qwen/qwen3.5-397b-a17b',
      })
    ).toBe('qwen/qwen3.5-397b-a17b');
  });

  it('falls back to model when visionModel is undefined', () => {
    expect(
      effectiveVisionModelName({
        model: 'gpt-4o',
        visionModel: undefined,
      })
    ).toBe('gpt-4o');
  });

  it('falls back to model when visionModel is null', () => {
    // Zod-narrowed `LoadedPersonality` declares `string | undefined`, but the
    // upstream `LlmConfigResolver` shape is `string | null`. Defensive null
    // handling matches what the inline expressions used to do at the call sites.
    expect(
      effectiveVisionModelName({
        model: 'gpt-4o',
        visionModel: null,
      })
    ).toBe('gpt-4o');
  });

  it('falls back to model when visionModel is empty string', () => {
    // Schema validation rejects null on this job-data field, so callers
    // sometimes use empty-string as the "unset" sentinel. The helper
    // treats empty-string the same as null/undefined.
    expect(
      effectiveVisionModelName({
        model: 'glm-5.1',
        visionModel: '',
      })
    ).toBe('glm-5.1');
  });
});
