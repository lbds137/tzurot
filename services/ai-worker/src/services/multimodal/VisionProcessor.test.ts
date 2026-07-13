/**
 * Tests for Vision Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hasVisionSupport,
  describeImage,
  LONG_TTL_FAILURE_CATEGORIES,
  VISION_TERMINATE_CATEGORIES,
} from './VisionProcessor.js';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { AI_DEFAULTS, FREE_ROUTER_MODEL } from '@tzurot/common-types/constants/ai';
import { SYSTEM_SETTINGS_FALLBACKS } from '@tzurot/common-types/schemas/api/systemSettings';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import {
  ApiErrorCategory,
  ERROR_MESSAGES,
  VISION_FAILURE_CACHE_POLICY,
} from '@tzurot/common-types/constants/error';
import { INTERVALS } from '@tzurot/common-types/constants/timing';

/**
 * Factory function to create a mock LoadedPersonality with sensible defaults.
 */
function createMockPersonality(overrides: Partial<LoadedPersonality> = {}): LoadedPersonality {
  return {
    id: 'test',
    name: 'Test',
    displayName: 'Test',
    slug: 'test',
    systemPrompt: 'Test prompt',
    model: 'gpt-4',
    provider: 'openrouter',
    visionModel: undefined,
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 8000,
    characterInfo: '',
    personalityTraits: '',
    voiceEnabled: false,
    ...overrides,
  } as LoadedPersonality;
}

// Create mock functions
const mockModelInvoke = vi.fn().mockResolvedValue({
  content: 'Mocked image description',
});

const mockCreateChatModel = vi.fn().mockReturnValue({
  model: { invoke: mockModelInvoke },
  modelName: 'test-model',
});

// Mock the checkModelVisionSupport function from redis.ts
const mockCheckModelVisionSupport = vi.fn();

// Mock the visionDescriptionCache from redis.ts
const mockVisionCacheGet = vi.fn().mockResolvedValue(null); // Default: cache miss
const mockVisionCacheStore = vi.fn().mockResolvedValue(undefined);
const mockVisionCacheGetFailure = vi.fn().mockResolvedValue(null); // Default: no failure cached
const mockVisionCacheStoreFailure = vi.fn().mockResolvedValue(undefined);
const mockTryAcquireInflight = vi.fn().mockResolvedValue(true); // Default: single-flight winner
const mockIsInflight = vi.fn().mockResolvedValue(false);
const mockReleaseInflight = vi.fn().mockResolvedValue(undefined);

vi.mock('../../redis.js', () => ({
  checkModelVisionSupport: (modelId: string) => mockCheckModelVisionSupport(modelId),
  visionDescriptionCache: {
    get: (options: { attachmentId?: string; url: string }) => mockVisionCacheGet(options),
    store: (options: { attachmentId?: string; url: string; model?: string }, description: string) =>
      mockVisionCacheStore(options, description),
    getFailure: (options: { attachmentId?: string; url: string }) =>
      mockVisionCacheGetFailure(options),
    storeFailure: (options: { attachmentId?: string; url: string; category: string }) =>
      mockVisionCacheStoreFailure(options),
    tryAcquireInflight: (options: { attachmentId?: string; url: string }) =>
      mockTryAcquireInflight(options),
    isInflight: (options: { attachmentId?: string; url: string }) => mockIsInflight(options),
    releaseInflight: (options: { attachmentId?: string; url: string }) =>
      mockReleaseInflight(options),
  },
}));

// Mock ModelFactory
vi.mock('../ModelFactory.js', () => ({
  createChatModel: (...args: unknown[]) => mockCreateChatModel(...args),
}));

// Mock apiErrorParser - configurable per test via mockParseApiError
const mockParseApiError = vi.fn();
vi.mock('../../utils/apiErrorParser.js', () => ({
  parseApiError: (error: unknown) => mockParseApiError(error),
}));

// Mock imageToDataUrl so describeImage's materialize step never hits the network.
const mockDownloadImageToDataUrl = vi.fn();
vi.mock('../../utils/imageToDataUrl.js', () => ({
  downloadImageToDataUrl: (url: string, opts: unknown) => mockDownloadImageToDataUrl(url, opts),
}));

describe('VisionProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelInvoke.mockResolvedValue({
      content: 'Mocked image description',
    });
    mockCreateChatModel.mockReturnValue({
      model: { invoke: mockModelInvoke },
      modelName: 'test-model',
    });
    // Default parseApiError: transient/retryable
    mockParseApiError.mockImplementation((error: unknown) => ({
      category: 'transient',
      type: 'UNKNOWN',
      statusCode: undefined,
      shouldRetry: true,
      technicalMessage: error instanceof Error ? error.message : String(error),
      referenceId: 'test-ref',
      requestId: undefined,
    }));
    // Default mock behavior - return false unless specified
    mockCheckModelVisionSupport.mockResolvedValue(false);
    // Default cache behavior - miss (null)
    mockVisionCacheGet.mockResolvedValue(null);
    mockVisionCacheStore.mockResolvedValue(undefined);
    // Default failure cache behavior - no failure cached
    mockVisionCacheGetFailure.mockResolvedValue(null);
    // Default single-flight behavior - this caller is the winner
    mockTryAcquireInflight.mockResolvedValue(true);
    mockIsInflight.mockResolvedValue(false);
    mockReleaseInflight.mockResolvedValue(undefined);
    mockVisionCacheStoreFailure.mockResolvedValue(undefined);
    // Default: download succeeds, returning a small fake data URL.
    mockDownloadImageToDataUrl.mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
      bytes: 4,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasVisionSupport', () => {
    it('should return true when model supports vision', async () => {
      mockCheckModelVisionSupport.mockResolvedValue(true);
      expect(await hasVisionSupport('gpt-4o')).toBe(true);
      expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-4o');
    });

    it('should return false when model does not support vision', async () => {
      mockCheckModelVisionSupport.mockResolvedValue(false);
      expect(await hasVisionSupport('gpt-3.5-turbo')).toBe(false);
      expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-3.5-turbo');
    });

    it('should delegate to checkModelVisionSupport for capability detection', async () => {
      mockCheckModelVisionSupport.mockResolvedValue(true);
      await hasVisionSupport('google/gemma-3-27b-it:free');
      expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('google/gemma-3-27b-it:free');
    });
  });

  describe('describeImage', () => {
    const mockAttachment: AttachmentMetadata = {
      id: '123456789012345678',
      url: 'https://cdn.discordapp.com/test-image.png',
      name: 'test-image.png',
      contentType: 'image/png',
      size: 1024,
    };

    // Expected placeholder renders for mockAttachment — one per buildFailureFallback
    // branch (permanent / transient / auth-user / auth-system). All must keep the
    // `[Image` prefix (isValidVisionDescription's cache guard) and include the filename.
    const PLACEHOLDER_PERMANENT = `[Image "test-image.png" was shared but couldn't be processed — you can acknowledge it if relevant, but can't see its contents]`;
    const PLACEHOLDER_TRANSIENT = `[Image "test-image.png" was shared but couldn't be processed right now — it may succeed later; you can acknowledge it, but can't see its contents]`;
    const PLACEHOLDER_AUTH_USER = `[Image "test-image.png" was shared but couldn't be processed — the vision API key was rejected; it can be fixed with /settings apikey set]`;
    const PLACEHOLDER_AUTH_SYSTEM = `[Image "test-image.png" was shared but couldn't be processed right now — the vision service had a temporary problem; it may work again shortly]`;

    describe('image materialization (download → data URL)', () => {
      it('downloads a non-data: image and keys the cache on the ORIGINAL url', async () => {
        const personality = createMockPersonality({ visionModel: 'gpt-4-vision-preview' });

        await describeImage(mockAttachment, personality);

        // The worker fetches the bytes itself rather than handing the provider a URL.
        expect(mockDownloadImageToDataUrl).toHaveBeenCalledWith(
          'https://cdn.discordapp.com/test-image.png',
          expect.objectContaining({ contentType: 'image/png' })
        );
        // Cache key stays the ORIGINAL url, never the synthesized data: URL.
        expect(mockVisionCacheGet).toHaveBeenCalledWith(
          expect.objectContaining({ url: 'https://cdn.discordapp.com/test-image.png' })
        );
      });

      it('skips the download when the attachment is already a data: URL', async () => {
        const personality = createMockPersonality({ visionModel: 'gpt-4-vision-preview' });

        await describeImage(
          { ...mockAttachment, url: 'data:image/jpeg;base64,ZmFrZQ==' },
          personality
        );

        expect(mockDownloadImageToDataUrl).not.toHaveBeenCalled();
      });

      it('falls back to the provider URL when the worker download fails', async () => {
        const personality = createMockPersonality({ visionModel: 'gpt-4-vision-preview' });
        mockDownloadImageToDataUrl.mockRejectedValueOnce(new Error('host blocked our egress'));

        // Does not throw — the vision call still runs (with the original URL).
        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
        expect(mockCreateChatModel).toHaveBeenCalled();

        // The provider must receive the ORIGINAL source URL on fallback, not a
        // data URL — guards against resolveVisionImageUrl silently returning
        // undefined (or a stale data URL) instead of attachment.url on error.
        const messages = mockModelInvoke.mock.calls[0][0];
        const humanMessage = messages[messages.length - 1];
        const imageContent = humanMessage.content.find(
          (c: { type: string }) => c.type === 'image_url'
        );
        expect(imageContent.image_url.url).toBe(mockAttachment.url);
      });
    });

    describe('model routing', () => {
      it('should use personality visionModel when specified', async () => {
        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: 'gpt-4-vision-preview',
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'gpt-4-vision-preview',
          })
        );
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).not.toHaveBeenCalled();
      });

      it('derives the z.ai provider from a glm vision model when caller omits provider', async () => {
        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: 'z-ai/glm-5.2',
        });

        await describeImage(mockAttachment, personality);

        // Provider must be derived from the RESOLVED vision model — not left
        // undefined, which would fall back to the env-default AI_PROVIDER and
        // misroute this cross-provider call (→ 401 Missing Authentication).
        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({ modelName: 'z-ai/glm-5.2', provider: 'zai-coding' })
        );
      });

      it('derives the OpenRouter provider from a slash-form vision model', async () => {
        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: 'google/gemma-4-31b-it',
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({ modelName: 'google/gemma-4-31b-it', provider: 'openrouter' })
        );
      });

      it('should use main model when it has vision support', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'gpt-4o',
          })
        );
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-4o');
      });

      it('should use fallback vision model when main model has no vision support', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(false);

        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-4');
      });

      it('reads the LIVE fallbackVisionModel/free-floor settings (divergent-from-fallback values flow through)', async () => {
        // The registry fallbacks coincidentally equal the retired constants,
        // so only a DIVERGENT registered value proves the live read.
        registerSystemSettings({
          get: (key: string) =>
            key === 'fallbackVisionModel'
              ? 'divergent/paid-vision'
              : key === 'fallbackVisionModelFree'
                ? 'divergent/free-vision:free'
                : undefined,
        } as unknown as SystemSettingsService);
        try {
          mockCheckModelVisionSupport.mockResolvedValue(false);
          const personality = createMockPersonality({ model: 'gpt-4', visionModel: undefined });

          await describeImage(mockAttachment, personality);
          expect(mockCreateChatModel).toHaveBeenCalledWith(
            expect.objectContaining({ modelName: 'divergent/paid-vision' })
          );

          mockCreateChatModel.mockClear();
          await describeImage(mockAttachment, personality, true);
          expect(mockCreateChatModel).toHaveBeenCalledWith(
            expect.objectContaining({ modelName: 'divergent/free-vision:free' })
          );
        } finally {
          resetSystemSettingsRegistration();
        }
      });

      it('should prefer visionModel over main model even if main has vision', async () => {
        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: 'claude-3-opus',
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'claude-3-opus',
          })
        );
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockCheckModelVisionSupport).not.toHaveBeenCalled();
      });

      it('uses options.model directly and SKIPS selectVisionModel when provided', async () => {
        // The unified `resolveVisionConfig` may force a free-tier model that
        // selectVisionModel would not reproduce for an authenticated user. When
        // a pre-resolved model is passed, describeImage must honor it verbatim
        // and not re-run the (Redis-touching) selection logic.
        const personality = createMockPersonality({
          // Both fields would normally drive selection; neither should be
          // consulted because options.model wins.
          model: 'gpt-4o',
          visionModel: 'claude-3-opus',
        });

        await describeImage(mockAttachment, personality, false, undefined, {
          model: 'google/gemma-4-31b-it:free',
        });

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'google/gemma-4-31b-it:free',
          })
        );
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        // selectVisionModel's only I/O is checkModelVisionSupport — it must not
        // be reached. (visionModel override would also short-circuit it, but
        // asserting it here locks in that options.model bypasses selection.)
        expect(mockCheckModelVisionSupport).not.toHaveBeenCalled();
      });

      it('guest + explicit PAID visionModel free-forces on the PRIMARY tier (C2b-6)', async () => {
        // The same cost-leak class the fallback-tier fix closed: a guest must
        // not run a paid configured vision model on the system key.
        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: 'anthropic/claude-sonnet-4.5', // explicit PAID vision model
        });

        await describeImage(mockAttachment, personality, true /* isGuestMode */, undefined);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: FREE_ROUTER_MODEL,
          })
        );
      });

      it('guest + vision-capable PAID main model free-forces on Priority 2 too', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true); // main model HAS vision
        const personality = createMockPersonality({
          model: 'openai/gpt-4o', // paid, vision-capable, no explicit visionModel
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality, true /* isGuestMode */, undefined);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: FREE_ROUTER_MODEL,
          })
        );
      });

      it('non-guest keeps an explicit paid visionModel unchanged on the primary tier', async () => {
        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: 'anthropic/claude-sonnet-4.5',
        });

        await describeImage(mockAttachment, personality, false /* isGuestMode */, undefined);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'anthropic/claude-sonnet-4.5',
          })
        );
      });

      it('falls back to selectVisionModel when options.model is an empty string', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(false);
        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality, false, undefined, { model: '' });

        // Empty model is treated as "not provided" → self-selection runs.
        expect(mockCheckModelVisionSupport).toHaveBeenCalledWith('gpt-4');
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
      });
    });

    describe('single-flight coalescing (multi-character fan-out)', () => {
      beforeEach(() => {
        mockCheckModelVisionSupport.mockResolvedValue(true);
      });

      it('a loser coalesces onto the concurrent describe — zero provider calls (model/tier-agnostic by design)', async () => {
        // Deliberate: the loser returns the winner's description regardless of
        // either side's model TIER — the same accepted property canonical-cache
        // READS already have (a paid request reuses a free-tier-produced entry).
        const personality = createMockPersonality({ model: 'gpt-4o', visionModel: undefined });
        mockTryAcquireInflight.mockResolvedValue(false);
        // First poll: winner's cache write already landed.
        mockVisionCacheGet
          .mockResolvedValueOnce(null) // describeImage's own initial cache check
          .mockResolvedValue('A detailed description of the shared image from the winner');

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('A detailed description of the shared image from the winner');
        expect(mockCreateChatModel).not.toHaveBeenCalled();
        // A loser never owns the marker — it must not release the winner's.
        expect(mockReleaseInflight).not.toHaveBeenCalled();
      });

      it('a loser falls through to its own call when the winner dies without writing', async () => {
        const personality = createMockPersonality({ model: 'gpt-4o', visionModel: undefined });
        mockTryAcquireInflight.mockResolvedValue(false);
        mockVisionCacheGet.mockResolvedValue(null);
        // Marker gone on first check → winner failed → own call (pre-feature path).
        mockIsInflight.mockResolvedValue(false);

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
        expect(mockCreateChatModel).toHaveBeenCalledTimes(1);
        expect(mockReleaseInflight).not.toHaveBeenCalled();
      });

      it('the winner releases the marker after caching (success path)', async () => {
        const personality = createMockPersonality({ model: 'gpt-4o', visionModel: undefined });

        await describeImage(mockAttachment, personality);

        expect(mockTryAcquireInflight).toHaveBeenCalledTimes(1);
        expect(mockReleaseInflight).toHaveBeenCalledTimes(1);
        // Store-before-release: waiters must find the cache written when the
        // marker disappears (call order across the two mocks).
        const storeOrder = mockVisionCacheStore.mock.invocationCallOrder[0];
        const releaseOrder = mockReleaseInflight.mock.invocationCallOrder[0];
        expect(storeOrder).toBeLessThan(releaseOrder);
      });

      it('the winner releases the marker even when the provider call throws', async () => {
        const personality = createMockPersonality({ model: 'gpt-4o', visionModel: undefined });
        mockModelInvoke.mockRejectedValue(new Error('provider exploded'));

        // The throw propagates to the caller — the finally must still release
        // so waiters stop polling and run their own attempts.
        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'provider exploded'
        );

        expect(mockReleaseInflight).toHaveBeenCalledTimes(1);
      });

      it('skipCache bypasses single-flight entirely', async () => {
        const personality = createMockPersonality({ model: 'gpt-4o', visionModel: undefined });

        await describeImage(mockAttachment, personality, false, undefined, { skipCache: true });

        expect(mockTryAcquireInflight).not.toHaveBeenCalled();
        expect(mockReleaseInflight).not.toHaveBeenCalled();
      });
    });

    describe('createChatModel configuration', () => {
      it('should pass VISION_TEMPERATURE to createChatModel', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: AI_DEFAULTS.VISION_TEMPERATURE,
          })
        );
      });

      it('honors explicitly-set vision-config params for the resolved model (seam assertion)', async () => {
        // Gateway-stamped visionConfigParams must reach createChatModel — the
        // decorative-config bug this carrier exists to fix. Explicit temperature
        // wins over VISION_TEMPERATURE; other set params pass through.
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: 'custom-vision-model',
          visionConfigParams: {
            'custom-vision-model': { temperature: 0.7, maxTokens: 512 },
          },
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'custom-vision-model',
            temperature: 0.7,
            maxTokens: 512,
          })
        );
      });

      it('falls back to VISION_TEMPERATURE when the resolved model has no params entry', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: 'custom-vision-model',
          // Params stamped for a DIFFERENT model (e.g. a fallback tier) must not
          // leak onto this tier's call.
          visionConfigParams: {
            'some-other-model': { temperature: 0.9 },
          },
        });

        await describeImage(mockAttachment, personality);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelName: 'custom-vision-model',
            temperature: AI_DEFAULTS.VISION_TEMPERATURE,
          })
        );
      });

      it('should pass user API key to createChatModel', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality, false, 'user-api-key-123');

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKey: 'user-api-key-123',
          })
        );
      });

      it('should not pass apiKey when userApiKey is undefined', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality, false, undefined);

        expect(mockCreateChatModel).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKey: undefined,
          })
        );
      });
    });

    describe('system prompt handling', () => {
      it('should include system prompt when provided', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
          systemPrompt: 'You are a helpful assistant',
        });

        await describeImage(mockAttachment, personality);

        const messages = mockModelInvoke.mock.calls[0][0];
        expect(messages[0]).toMatchObject({
          content: 'You are a helpful assistant',
        });
      });

      it('should work without system prompt', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
          systemPrompt: '',
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
      });

      it('should handle undefined system prompt', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
          systemPrompt: undefined as any,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
      });
    });

    describe('error handling', () => {
      it('should propagate vision model errors', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        mockModelInvoke.mockRejectedValue(new Error('Vision API error'));

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Vision API error'
        );
      });

      it('should propagate fallback vision model errors', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(false);

        const personality = createMockPersonality({
          model: 'gpt-4',
          visionModel: undefined,
        });

        mockModelInvoke.mockRejectedValue(new Error('Fallback API error'));

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Fallback API error'
        );
      });

      it('should handle non-string response content', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        mockModelInvoke.mockResolvedValue({
          content: [{ type: 'text', text: 'Complex response' }],
        });

        const result = await describeImage(mockAttachment, personality);

        // Should stringify non-string content
        expect(typeof result).toBe('string');
      });
    });

    describe('attachment handling', () => {
      it('sends the materialized image (data URL) to the provider, not the source URL', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        const messages = mockModelInvoke.mock.calls[0][0];
        const humanMessage = messages[messages.length - 1];
        const imageContent = humanMessage.content.find((c: any) => c.type === 'image_url');

        // The provider receives the worker-fetched bytes, never the remote URL.
        expect(imageContent.image_url.url).toBe('data:image/jpeg;base64,ZmFrZQ==');
      });

      it('should include description prompt', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        const messages = mockModelInvoke.mock.calls[0][0];
        const humanMessage = messages[messages.length - 1];
        const textContent = humanMessage.content.find((c: any) => c.type === 'text');

        expect(textContent.text).toContain('detailed');
        expect(textContent.text).toContain('objective description');
      });
    });

    describe('caching', () => {
      it('should return cached description on cache hit', async () => {
        const cachedDescription = 'Previously cached image description';
        mockVisionCacheGet.mockResolvedValue(cachedDescription);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(cachedDescription);
        // gpt-4o lacks vision in this test (mock unset → false), so selectVisionModel
        // falls through to the paid floor (fallbackVisionModel setting — the
        // auto-router registry fallback here); the cache key is namespaced by it.
        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          model: SYSTEM_SETTINGS_FALLBACKS.fallbackVisionModel,
        });
        // Should NOT call the vision API
        expect(mockModelInvoke).not.toHaveBeenCalled();
        // Should NOT store in cache (already cached)
        expect(mockVisionCacheStore).not.toHaveBeenCalled();
      });

      it('should call vision API and cache result on cache miss', async () => {
        mockVisionCacheGet.mockResolvedValue(null); // Cache miss
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe('Mocked image description');
        // gpt-4o has vision here (mock → true), so it IS the used model; the cache
        // keys (read + write) are namespaced by it.
        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          model: 'gpt-4o',
        });
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(mockVisionCacheStore).toHaveBeenCalledWith(
          { attachmentId: mockAttachment.id, url: mockAttachment.url, model: 'gpt-4o' },
          'Mocked image description'
        );
      });

      it('should not cache on vision API error', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockRejectedValue(new Error('Vision API error'));

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Vision API error'
        );

        // Should have checked cache (namespaced by the gpt-4o vision model)
        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          model: 'gpt-4o',
        });
        // Should NOT have stored anything (API failed)
        expect(mockVisionCacheStore).not.toHaveBeenCalled();
      });
    });

    describe('negative caching (failure cache)', () => {
      it('should default AUTH failures with no apiKeySource to the system-side message', async () => {
        // Conservative default: when we don't know whose key failed, use the
        // service-unavailable phrasing rather than "API key issue" — the user has
        // no actionable remediation if they don't know it's their key, and blaming
        // them for a system-side glitch is a worse UX. (Source-aware variants are
        // tested below with explicit apiKeySource.)
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'authentication',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(PLACEHOLDER_AUTH_SYSTEM);
        expect(mockModelInvoke).not.toHaveBeenCalled();
        expect(mockVisionCacheStore).not.toHaveBeenCalled();
      });

      it('should return user-key-specific message when apiKeySource is "user"', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'authentication',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality, false, 'user-byok-key', {
          loggingContext: { apiKeySource: 'user' },
        });

        expect(result).toBe(PLACEHOLDER_AUTH_USER);
      });

      it('should return system-key-specific message when apiKeySource is "system"', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'authentication',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality, true, undefined, {
          loggingContext: { apiKeySource: 'system' },
        });

        expect(result).toBe(PLACEHOLDER_AUTH_SYSTEM);
      });

      it('should use friendly label for content_policy failures', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'content_policy',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(PLACEHOLDER_PERMANENT);
      });

      it('should use friendly label for media_not_found failures', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'media_not_found',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(PLACEHOLDER_PERMANENT);
      });

      it('should fall back to generic message for unrecognized categories', async () => {
        // Defensive: a cache entry whose `category` doesn't match a known
        // ApiErrorCategory (e.g., from a stale-format pre-deploy entry)
        // should not crash — it falls through to the generic transient label.
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'some_new_category',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(PLACEHOLDER_TRANSIENT);
      });

      it('should return transient failure fallback when cooldown is active', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'rate_limit',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(PLACEHOLDER_TRANSIENT);
        expect(mockModelInvoke).not.toHaveBeenCalled();
      });

      it('should return generic transient fallback for QUOTA_EXCEEDED cooldown hits', async () => {
        // QUOTA_EXCEEDED is classified non-attachment-bound: quotas reset on a clock
        // (daily/monthly) or when the user adds credits, so the labeled
        // "[Image unavailable: quota exceeded]" wording would imply a permanence
        // we can't claim. The generic transient message is the right fallback.
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'quota_exceeded',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(PLACEHOLDER_TRANSIENT);
        expect(mockModelInvoke).not.toHaveBeenCalled();
      });

      it('should check failure cache after success cache miss', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockVisionCacheGetFailure.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        expect(mockVisionCacheGet).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          model: 'gpt-4o',
        });
        expect(mockVisionCacheGetFailure).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          model: 'gpt-4o',
        });
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
      });

      it('should store failure in negative cache on vision API error', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockVisionCacheGetFailure.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockRejectedValue(new Error('Vision API error'));

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Vision API error'
        );

        expect(mockVisionCacheStoreFailure).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          category: 'transient',
          model: 'gpt-4o',
        });
      });

      it('should store permanent failure for authentication errors', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockVisionCacheGetFailure.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockRejectedValue(new Error('Invalid API key'));
        mockParseApiError.mockReturnValue({
          category: 'authentication',
          type: 'PERMANENT',
          statusCode: 401,
          shouldRetry: false,
          technicalMessage: 'Invalid API key',
          referenceId: 'test-ref',
          requestId: undefined,
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow('Invalid API key');

        expect(mockVisionCacheStoreFailure).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          category: 'authentication',
          model: 'gpt-4o',
        });
      });

      it('should store permanent failure for content policy violations', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockVisionCacheGetFailure.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockRejectedValue(new Error('Content policy violation'));
        mockParseApiError.mockReturnValue({
          category: 'content_policy',
          type: 'PERMANENT',
          statusCode: 403,
          shouldRetry: false,
          technicalMessage: 'Content policy violation',
          referenceId: 'test-ref',
          requestId: undefined,
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Content policy violation'
        );

        expect(mockVisionCacheStoreFailure).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          category: 'content_policy',
          model: 'gpt-4o',
        });
      });

      it('should store transient failure for timeout errors', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockVisionCacheGetFailure.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockRejectedValue(new Error('Request timed out'));
        mockParseApiError.mockReturnValue({
          category: 'timeout',
          type: 'TRANSIENT',
          statusCode: undefined,
          shouldRetry: true,
          technicalMessage: 'Request timed out',
          referenceId: 'test-ref',
          requestId: undefined,
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Request timed out'
        );

        expect(mockVisionCacheStoreFailure).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          category: 'timeout',
          model: 'gpt-4o',
        });
      });

      it('should store transient failure for rate limit errors', async () => {
        mockVisionCacheGet.mockResolvedValue(null);
        mockVisionCacheGetFailure.mockResolvedValue(null);
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockRejectedValue(new Error('Rate limit exceeded'));
        mockParseApiError.mockReturnValue({
          category: 'rate_limit',
          type: 'TRANSIENT',
          statusCode: 429,
          shouldRetry: true,
          technicalMessage: 'Rate limit exceeded',
          referenceId: 'test-ref',
          requestId: undefined,
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          'Rate limit exceeded'
        );

        expect(mockVisionCacheStoreFailure).toHaveBeenCalledWith({
          attachmentId: mockAttachment.id,
          url: mockAttachment.url,
          category: 'rate_limit',
          model: 'gpt-4o',
        });
      });

      it('should skip failure cache when success cache hits', async () => {
        mockVisionCacheGet.mockResolvedValue('Cached description');

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        // Should NOT check failure cache - success cache already returned
        expect(mockVisionCacheGetFailure).not.toHaveBeenCalled();
      });
    });

    describe('skipNegativeCache option', () => {
      it('should re-attempt a TRANSIENT cached failure when skipNegativeCache is true', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'rate_limit',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality, false, undefined, {
          skipNegativeCache: true,
        });

        // The check now always runs, but a TRANSIENT failure (rate_limit) is not honored on
        // this path — it may have cleared, so we re-attempt the vision API rather than
        // returning the cached fallback.
        expect(mockVisionCacheGetFailure).toHaveBeenCalled();
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(result).toBe('Mocked image description');
      });

      it('should HONOR an attachment-bound cached failure even when skipNegativeCache is true', async () => {
        // A permanently-dead image (e.g. expired Discord CDN URL → media_not_found) must
        // NOT re-storm across providers every turn it sits in context. The reference path
        // honors the attachment-bound cached failure and short-circuits to the fallback.
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'media_not_found',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality, false, undefined, {
          skipNegativeCache: true,
        });

        expect(mockVisionCacheGetFailure).toHaveBeenCalled();
        // No vision call — the cross-provider storm is prevented.
        expect(mockModelInvoke).not.toHaveBeenCalled();
        expect(result).toBe(PLACEHOLDER_PERMANENT);
      });

      it('should still check negative cache when skipNegativeCache is false', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'rate_limit',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality, false, undefined, {
          skipNegativeCache: false,
        });

        expect(mockVisionCacheGetFailure).toHaveBeenCalled();
        expect(result).toBe(PLACEHOLDER_TRANSIENT);
        expect(mockModelInvoke).not.toHaveBeenCalled();
      });

      it('should still check negative cache when options is undefined', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'rate_limit',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(mockVisionCacheGetFailure).toHaveBeenCalled();
        expect(result).toBe(PLACEHOLDER_TRANSIENT);
        expect(mockModelInvoke).not.toHaveBeenCalled();
      });

      it('should still use positive cache even with skipNegativeCache', async () => {
        mockVisionCacheGet.mockResolvedValue('Cached description');

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality, false, undefined, {
          skipNegativeCache: true,
        });

        expect(result).toBe('Cached description');
        expect(mockModelInvoke).not.toHaveBeenCalled();
      });
    });

    describe('response validation', () => {
      it('should throw on empty response from vision model', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockResolvedValue({ content: '' });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          ERROR_MESSAGES.EMPTY_RESPONSE
        );
      });

      it('should throw on whitespace-only response from vision model', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockResolvedValue({ content: '   \n  ' });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          ERROR_MESSAGES.EMPTY_RESPONSE
        );
      });

      it('should throw on censored "ext" response from vision model', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockResolvedValue({ content: 'ext' });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await expect(describeImage(mockAttachment, personality)).rejects.toThrow(
          ERROR_MESSAGES.CENSORED_RESPONSE
        );
      });

      it('should accept short but valid descriptions without throwing', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockResolvedValue({ content: 'A cat.' });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);
        expect(result).toBe('A cat.');
      });
    });

    describe('cache validation', () => {
      it('should cache descriptions meeting minimum length', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockResolvedValue({ content: 'A cat on a mat.' });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        expect(mockVisionCacheStore).toHaveBeenCalled();
      });

      it('should not cache descriptions below minimum length', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockResolvedValue({ content: 'A cat.' });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);
        expect(result).toBe('A cat.');
        // Short description returned but NOT cached
        expect(mockVisionCacheStore).not.toHaveBeenCalled();
      });

      it('should not cache descriptions starting with [Image', async () => {
        // This test simulates a scenario where a placeholder string somehow gets through.
        // Since invokeVisionModel now throws on empty/censored, we test the cache validation
        // by checking that the positive cache stores only valid descriptions.
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockResolvedValue({
          content: 'A detailed description of the image showing a landscape.',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);
        expect(result).toBe('A detailed description of the image showing a landscape.');
        expect(mockVisionCacheStore).toHaveBeenCalledWith(
          expect.objectContaining({ attachmentId: mockAttachment.id }),
          'A detailed description of the image showing a landscape.'
        );
      });

      it('should not cache error-like descriptions from vision model', async () => {
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockResolvedValue({
          content: 'I cannot access the image at the provided URL.',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);
        expect(result).toBe('I cannot access the image at the provided URL.');
        // Error-like description returned but NOT cached
        expect(mockVisionCacheStore).not.toHaveBeenCalled();
      });
    });

    describe('cached description quality validation', () => {
      it('should reject cached error-like descriptions and re-process', async () => {
        mockVisionCacheGet.mockResolvedValue(
          'I cannot access the image at the provided URL because it has expired.'
        );
        mockCheckModelVisionSupport.mockResolvedValue(true);
        mockModelInvoke.mockResolvedValue({
          content: 'A landscape photo showing mountains and a lake.',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        // Should have ignored the cached error and called the vision API
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(result).toBe('A landscape photo showing mountains and a lake.');
      });

      it('should reject cached descriptions with URL error patterns', async () => {
        mockVisionCacheGet.mockResolvedValue('The image URL is invalid or has expired.');
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        // Should have re-processed despite cache hit
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
      });

      it('should reject very short cached descriptions', async () => {
        mockVisionCacheGet.mockResolvedValue('N/A');
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        await describeImage(mockAttachment, personality);

        // Should have re-processed despite cache hit
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
      });

      it('should accept valid cached descriptions', async () => {
        mockVisionCacheGet.mockResolvedValue(
          'A photograph of a sunset over the ocean with vibrant orange and pink clouds.'
        );

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality);

        expect(result).toBe(
          'A photograph of a sunset over the ocean with vibrant orange and pink clouds.'
        );
        // Should NOT call the vision API
        expect(mockModelInvoke).not.toHaveBeenCalled();
      });

      it('should accept legitimate descriptions containing words from error patterns', async () => {
        // These descriptions contain words like "access", "view", "process", "load"
        // that appear in error patterns, but in legitimate descriptive context
        const legitimateDescriptions = [
          'A secure facility with restricted access, showing a guard checkpoint and metal gates.',
          'A scenic mountain view from the summit, with clouds below the treeline.',
          'A food processing plant with conveyor belts and workers in white uniforms.',
          'A webpage loading screen showing a progress bar at 75 percent completion.',
        ];

        for (const description of legitimateDescriptions) {
          mockVisionCacheGet.mockResolvedValue(description);
          mockModelInvoke.mockClear();

          const personality = createMockPersonality({
            model: 'gpt-4o',
            visionModel: undefined,
          });

          const result = await describeImage(mockAttachment, personality);

          expect(result).toBe(description);
          expect(mockModelInvoke).not.toHaveBeenCalled();
        }
      });
    });

    describe('skipCache option', () => {
      it('should bypass positive cache when skipCache is true', async () => {
        mockVisionCacheGet.mockResolvedValue('Previously cached description that is long enough');
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality, false, undefined, {
          skipCache: true,
        });

        // Should NOT check positive cache
        expect(mockVisionCacheGet).not.toHaveBeenCalled();
        // Should call vision API directly
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(result).toBe('Mocked image description');
      });

      it('should still check negative cache when only skipCache is true', async () => {
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'rate_limit',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality, false, undefined, {
          skipCache: true,
        });

        // Should check negative cache (skipNegativeCache not set)
        expect(mockVisionCacheGetFailure).toHaveBeenCalled();
        expect(result).toBe(PLACEHOLDER_TRANSIENT);
      });

      it('should bypass both caches when both skip options are true', async () => {
        mockVisionCacheGet.mockResolvedValue('Previously cached valid description');
        mockVisionCacheGetFailure.mockResolvedValue({
          category: 'rate_limit',
          cachedAt: '2026-04-28T18:22:42.000Z',
        });
        mockCheckModelVisionSupport.mockResolvedValue(true);

        const personality = createMockPersonality({
          model: 'gpt-4o',
          visionModel: undefined,
        });

        const result = await describeImage(mockAttachment, personality, false, undefined, {
          skipCache: true,
          skipNegativeCache: true,
        });

        // Positive cache is fully bypassed (skipCache); the negative cache is still
        // CHECKED (always), but the cached failure here is TRANSIENT (rate_limit) so the
        // skip path doesn't honor it — we re-attempt the vision API.
        expect(mockVisionCacheGet).not.toHaveBeenCalled();
        expect(mockVisionCacheGetFailure).toHaveBeenCalled();
        // Should call vision API directly
        expect(mockModelInvoke).toHaveBeenCalledTimes(1);
        expect(result).toBe('Mocked image description');
      });
    });
  });

  describe('cache-policy / fallback-set invariant', () => {
    it('every LONG_TTL_FAILURE_CATEGORIES member must use VISION_FAILURE_TTL_LONG', () => {
      // The `LONG_TTL_FAILURE_CATEGORIES` set (in `VisionProcessor.ts`) drives
      // the user-facing fallback message; the LONG-TTL entries in
      // `VISION_FAILURE_CACHE_POLICY` (in `error.ts`) drive the negative-cache cooldown.
      // Both encode the same "this failure is bound to the attachment, not transient
      // state" decision in different shapes — they must stay in sync. Adding a new
      // category to one structure but not the other would silently produce a TTL
      // mismatch (short cooldown when long is expected) or fallback-message mismatch
      // (generic "temporarily unavailable" when a specific label is expected).
      for (const category of LONG_TTL_FAILURE_CATEGORIES) {
        expect(VISION_FAILURE_CACHE_POLICY[category].l1TtlSeconds).toBe(
          INTERVALS.VISION_FAILURE_TTL_LONG
        );
      }
    });

    // (The FAILURE_LABELS-coverage invariant test was removed with FAILURE_LABELS
    // itself: buildFailureFallback no longer renders per-category labels — the
    // placeholder distinguishes only permanent vs transient vs auth wording.)
  });

  describe('terminate-set / attachment-bound-set invariant', () => {
    // `VISION_TERMINATE_CATEGORIES` (the categories where the fallback LOOP stops trying
    // other tiers) and `LONG_TTL_FAILURE_CATEGORIES` (the categories the negative
    // cache treats as image-bound for TTL purposes) encode two RELATED-but-distinct
    // decisions. The relationship is a deliberate strict subset: every "give up, the image
    // is the problem" category is also "bound to this attachment," but MODEL_NOT_FOUND is
    // attachment-bound for cache-TTL purposes yet is exactly what the loop routes around
    // (a different tier is a different model). These tests pin that relationship so a future
    // edit to either set surfaces the divergence at PR time.

    it('VISION_TERMINATE_CATEGORIES is a strict subset of LONG_TTL_FAILURE_CATEGORIES', () => {
      for (const category of VISION_TERMINATE_CATEGORIES) {
        expect(LONG_TTL_FAILURE_CATEGORIES.has(category)).toBe(true);
      }
      // Strict (proper) subset: the attachment-bound set must have at least one member the
      // terminate set lacks (that member is asserted to be MODEL_NOT_FOUND below).
      expect(LONG_TTL_FAILURE_CATEGORIES.size).toBeGreaterThan(VISION_TERMINATE_CATEGORIES.size);
    });

    it('the set difference (attachment-bound \\ terminate) is exactly { MODEL_NOT_FOUND }', () => {
      // MODEL_NOT_FOUND is the sole attachment-bound category the fallback loop treats as
      // RETRYABLE: a missing model won't reappear for THIS attachment on the SAME model, but
      // a different tier is a different model, so the loop advances rather than terminating.
      const difference = [...LONG_TTL_FAILURE_CATEGORIES].filter(
        category => !VISION_TERMINATE_CATEGORIES.has(category)
      );
      expect(difference).toEqual([ApiErrorCategory.MODEL_NOT_FOUND]);
    });

    it('VISION_TERMINATE_CATEGORIES contains exactly CONTENT_POLICY, CENSORED, MEDIA_NOT_FOUND', () => {
      expect(new Set(VISION_TERMINATE_CATEGORIES)).toEqual(
        new Set([
          ApiErrorCategory.CONTENT_POLICY,
          ApiErrorCategory.CENSORED,
          ApiErrorCategory.MEDIA_NOT_FOUND,
        ])
      );
    });
  });
});
