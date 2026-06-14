/**
 * Tests for visionAuthResolver
 *
 * Covers the cross-provider vision-auth decision tree:
 * - Same-provider fast path → reuse main key, no resolver call
 * - Cross-provider, guest mode → resolveApiKey (system fallback OK)
 * - Cross-provider, authenticated, has user vision key → user key
 * - Cross-provider, authenticated, no user vision key → null (fail-fast)
 *
 * Plus the buildVisionAuthFailureResults helper that produces the
 * synthetic-failure batch when the resolver returns null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AIProvider,
  AttachmentType,
  ApiErrorCategory,
  type LoadedPersonality,
  type AttachmentMetadata,
} from '@tzurot/common-types';
import { resolveVisionAuth, buildVisionAuthFailureResults } from './visionAuthResolver.js';
import type { ApiKeyResolver } from '../ApiKeyResolver.js';

// Logger mock — visionAuthResolver imports createLogger from common-types
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

// VisionDescriptionCache singleton mock — buildVisionAuthFailureResults writes
// to it; we just verify the call shape.
const mockStoreFailure = vi.fn();
vi.mock('../../redis.js', () => ({
  visionDescriptionCache: {
    storeFailure: (...args: unknown[]) => mockStoreFailure(...args),
  },
}));

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

const personalitySameProvider: LoadedPersonality = {
  ...personality,
  model: 'qwen/qwen3-72b',
  visionModel: 'qwen/qwen3.5-397b-a17b',
} as unknown as LoadedPersonality;

const personalityNoVisionOverride: LoadedPersonality = {
  ...personality,
  visionModel: null,
  model: 'glm-5.1',
} as unknown as LoadedPersonality;

const mockResolveApiKey = vi.fn();
const mockTryResolveUserKey = vi.fn();

const mockResolver: ApiKeyResolver = {
  resolveApiKey: mockResolveApiKey,
  tryResolveUserKey: mockTryResolveUserKey,
} as unknown as ApiKeyResolver;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveVisionAuth', () => {
  describe('same-provider fast path', () => {
    it('reuses main key without calling resolver when vision and main share provider', async () => {
      const auth = await resolveVisionAuth({
        personality: personalitySameProvider,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: 'main-or-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(auth).toEqual({
        apiKey: 'main-or-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
      });
      expect(mockResolveApiKey).not.toHaveBeenCalled();
      expect(mockTryResolveUserKey).not.toHaveBeenCalled();
    });

    it('marks source as "system" on the fast path when main was guest-mode', async () => {
      const auth = await resolveVisionAuth({
        personality: personalitySameProvider,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: 'system-or-key',
        isGuestMode: true,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      // Null guard explicit: the fast path can never return null (only the
      // cross-provider authenticated-no-key branch returns null), so a null
      // here would be a real regression. Asserting it explicitly prevents the
      // optional-chain `auth?.source` from masking a null with a passing test.
      expect(auth).not.toBeNull();
      expect(auth?.source).toBe('system');
    });
  });

  describe('cross-provider, authenticated user', () => {
    it('returns user key for vision provider when available (user has both keys)', async () => {
      mockTryResolveUserKey.mockResolvedValue('user-or-key');

      const auth = await resolveVisionAuth({
        personality, // main=glm-5.1 (z.ai), vision=qwen/... (OpenRouter)
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(auth).toEqual({
        apiKey: 'user-or-key',
        source: 'user',
        provider: AIProvider.OpenRouter,
      });
      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
      // Authenticated path uses tryResolveUserKey (no system fallback), not resolveApiKey.
      expect(mockResolveApiKey).not.toHaveBeenCalled();
    });

    it('returns null (fail-fast) when authenticated user has no key for vision provider', async () => {
      mockTryResolveUserKey.mockResolvedValue(null);

      const auth = await resolveVisionAuth({
        personality, // main=z.ai, vision=OpenRouter
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(auth).toBeNull();
      // Critically: resolveApiKey is NOT called (no system fallback for auth users)
      expect(mockResolveApiKey).not.toHaveBeenCalled();
    });
  });

  describe('cross-provider, guest mode', () => {
    it('falls back to system key via resolveApiKey when isGuestMode=true', async () => {
      mockResolveApiKey.mockResolvedValue({
        apiKey: 'system-or-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
        isGuestMode: true,
        userId: undefined,
      });

      const auth = await resolveVisionAuth({
        personality,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'system-zai-key',
        isGuestMode: true,
        userId: undefined,
        apiKeyResolver: mockResolver,
      });

      expect(auth).toEqual({
        apiKey: 'system-or-key',
        source: 'system',
        provider: AIProvider.OpenRouter,
      });
      expect(mockResolveApiKey).toHaveBeenCalledWith(undefined, AIProvider.OpenRouter);
      expect(mockTryResolveUserKey).not.toHaveBeenCalled();
    });
  });

  describe('degraded upstream auth (AuthStep error-recovery case)', () => {
    it('skips fast path and resolves per-provider when mainApiKey is undefined', async () => {
      // AuthStep's catch branch returns `resolvedApiKey: undefined` when
      // ProviderRouter.resolveRoute throws. Same provider fast path would
      // otherwise hand createChatModel an empty Authorization header,
      // reproducing the original bug. We force per-provider resolution so
      // the user's actual keys (if any) get picked up.
      mockTryResolveUserKey.mockResolvedValue('user-or-key');

      const auth = await resolveVisionAuth({
        personality: personalitySameProvider, // main+vision both OpenRouter
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: undefined, // ← AuthStep failure
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(auth?.apiKey).toBe('user-or-key');
      // Same-provider fast path was bypassed → tryResolveUserKey was called.
      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
    });

    it('skips fast path and resolves per-provider when mainApiKey is empty string', async () => {
      // Defensive: a future caller might pass `auth.apiKey ?? ''` and end up
      // with an empty string. The empty-string check guards against that
      // exactly the same way as undefined.
      mockTryResolveUserKey.mockResolvedValue('user-or-key');

      const auth = await resolveVisionAuth({
        personality: personalitySameProvider,
        mainProvider: AIProvider.OpenRouter,
        mainApiKey: '',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      expect(auth?.apiKey).toBe('user-or-key');
      expect(mockTryResolveUserKey).toHaveBeenCalled();
    });
  });

  describe('vision-model fallback when no override', () => {
    it('uses main model name to detect provider when personality.visionModel is null', async () => {
      const auth = await resolveVisionAuth({
        personality: personalityNoVisionOverride, // main=glm-5.1, vision=null
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
      });

      // glm-5.1 → ZaiCoding, matches mainProvider → fast path
      expect(auth?.provider).toBe(AIProvider.ZaiCoding);
      expect(auth?.apiKey).toBe('user-zai-key');
      expect(mockTryResolveUserKey).not.toHaveBeenCalled();
    });
  });

  describe('effectiveVisionModel override', () => {
    it('uses caller-provided effectiveVisionModel over personality fields', async () => {
      mockTryResolveUserKey.mockResolvedValue('user-or-key');

      const auth = await resolveVisionAuth({
        personality: personalityNoVisionOverride, // says ZaiCoding model
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'user-zai-key',
        isGuestMode: false,
        userId: 'user-1',
        apiKeyResolver: mockResolver,
        effectiveVisionModel: 'anthropic/claude-3.5-sonnet', // overrides
      });

      // The override should make it OpenRouter, triggering cross-provider lookup
      expect(auth?.provider).toBe(AIProvider.OpenRouter);
      expect(mockTryResolveUserKey).toHaveBeenCalledWith('user-1', AIProvider.OpenRouter);
    });
  });
});

describe('buildVisionAuthFailureResults', () => {
  it('writes a synthetic AUTH-failure cache entry per attachment and returns fallback descriptions', async () => {
    mockStoreFailure.mockResolvedValue(undefined);

    const attachments: AttachmentMetadata[] = [
      {
        id: 'att-1',
        url: 'https://cdn.discordapp.com/img1.png',
        contentType: 'image/png',
        name: 'img1.png',
        size: 100,
      } as AttachmentMetadata,
      {
        id: 'att-2',
        url: 'https://cdn.discordapp.com/img2.png',
        contentType: 'image/png',
        name: 'img2.png',
        size: 100,
      } as AttachmentMetadata,
    ];

    const results = await buildVisionAuthFailureResults(attachments);

    expect(results).toHaveLength(2);
    expect(results[0]?.type).toBe(AttachmentType.Image);
    expect(results[0]?.description).toContain('check /settings apikey set');
    expect(results[0]?.originalUrl).toBe('https://cdn.discordapp.com/img1.png');
    expect(results[1]?.originalUrl).toBe('https://cdn.discordapp.com/img2.png');

    expect(mockStoreFailure).toHaveBeenCalledTimes(2);
    // Assert each call's argument shape explicitly — `toHaveBeenCalledTimes`
    // alone wouldn't catch a future partial-application bug where the second
    // call ends up with a stale or default category.
    expect(mockStoreFailure).toHaveBeenNthCalledWith(1, {
      attachmentId: 'att-1',
      url: 'https://cdn.discordapp.com/img1.png',
      category: ApiErrorCategory.AUTHENTICATION,
    });
    expect(mockStoreFailure).toHaveBeenNthCalledWith(2, {
      attachmentId: 'att-2',
      url: 'https://cdn.discordapp.com/img2.png',
      category: ApiErrorCategory.AUTHENTICATION,
    });
  });
});
