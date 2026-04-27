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
import { AIProvider } from '@tzurot/common-types';
import { ProviderRouter } from './ProviderRouter.js';
import type { ApiKeyResolver, ApiKeyResolutionResult } from './ApiKeyResolver.js';

// Mock logger via the shared common-types mock pattern
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
      expect(mockTryResolveUserKey).not.toHaveBeenCalled();
      expect(route).toEqual({
        effectiveProvider: AIProvider.OpenRouter,
        effectiveModel: 'anthropic/claude-sonnet-4.5',
        apiKey: 'sk-or-user-key',
        isGuestMode: false,
        fallthroughTriggered: false,
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
});
