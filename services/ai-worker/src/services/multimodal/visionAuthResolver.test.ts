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
 *
 * Plus the buildVisionAuthFailureResults helper that produces the
 * synthetic-failure batch when the resolver returns failFast.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AIProvider,
  AttachmentType,
  MODEL_DEFAULTS,
  type LoadedPersonality,
  type AttachmentMetadata,
} from '@tzurot/common-types';
import {
  resolveVisionConfig,
  resolveVisionAuth,
  buildVisionAuthFailureResults,
} from './visionAuthResolver.js';
import { selectVisionModel } from './VisionProcessor.js';
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

// selectVisionModel is now called internally by resolveVisionConfig. Mock it so
// each test controls the "natural" model the resolver derives the provider from,
// without reaching into Redis (hasVisionSupport).
vi.mock('./VisionProcessor.js', () => ({
  selectVisionModel: vi.fn(),
}));

// VisionDescriptionCache singleton mock — buildVisionAuthFailureResults writes
// to it; we just verify the call shape.
const mockStoreFailure = vi.fn();
// Default: quota allows (under cap). Over-cap tests override per-case.
const mockTryConsume = vi.fn().mockResolvedValue(true);
vi.mock('../../redis.js', () => ({
  visionDescriptionCache: {
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
      mockSelectVisionModel.mockResolvedValue(MODEL_DEFAULTS.VISION_FALLBACK_FREE);
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
          model: MODEL_DEFAULTS.VISION_FALLBACK_FREE,
          source: 'system',
          isGuestMode: true,
        },
      });
      expect(mockResolveApiKey).toHaveBeenCalledWith(undefined, AIProvider.OpenRouter);
      expect(mockTryResolveUserKey).not.toHaveBeenCalled();
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
        expect(result.config.model).toBe(MODEL_DEFAULTS.VISION_FALLBACK_FREE);
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
        expect(result.config.model).toBe(MODEL_DEFAULTS.VISION_FALLBACK_FREE);
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

    const result = await resolveVisionAuth('fallback/tier-model', AIProvider.OpenRouter, {
      personality,
      mainProvider: AIProvider.OpenRouter,
      mainApiKey: '', // empty → skip fast path → per-provider resolution
      isGuestMode: false,
      userId: 'user-1',
      apiKeyResolver: mockResolver,
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.config.model).toBe('fallback/tier-model');
      expect(result.config.provider).toBe(AIProvider.OpenRouter);
    }
    // The tier model is provided by the caller — resolveVisionAuth must not re-derive it.
    expect(mockSelectVisionModel).not.toHaveBeenCalled();
  });

  it('reuses the main key on the same-provider fast path with the target model', async () => {
    const result = await resolveVisionAuth('fallback/tier-model', AIProvider.OpenRouter, {
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
        model: 'fallback/tier-model',
        source: 'user',
        isGuestMode: false,
      },
    });
    expect(mockSelectVisionModel).not.toHaveBeenCalled();
  });
});

describe('buildVisionAuthFailureResults', () => {
  it('returns a "configure your key" fallback description per attachment', () => {
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

    const results = buildVisionAuthFailureResults(attachments);

    expect(results).toHaveLength(2);
    expect(results[0]?.type).toBe(AttachmentType.Image);
    expect(results[0]?.description).toContain('check /settings apikey set');
    expect(results[0]?.originalUrl).toBe('https://cdn.discordapp.com/img1.png');
    expect(results[1]?.originalUrl).toBe('https://cdn.discordapp.com/img2.png');
  });
});
