/**
 * AuthStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { AIProvider, GUEST_MODE } from '@tzurot/common-types/constants/ai';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { AuthStep } from './AuthStep.js';
import type { GenerationContext, ResolvedConfig } from '../types.js';
import type {
  ApiKeyResolver,
  ApiKeyResolutionResult,
} from '../../../../services/ApiKeyResolver.js';
import type { SttProvider } from '@tzurot/common-types/types/sttProvider';
import type { LlmConfigResolver, SttResolver } from '@tzurot/config-resolver';

// Mock common-types logger and isFreeModel
vi.mock('@tzurot/common-types/constants/ai', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/ai')>(
    '@tzurot/common-types/constants/ai'
  );
  return {
    ...actual,
    isFreeModel: vi.fn((model: string) => model.includes('free') || model.includes('gemma')),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-123',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  ownerId: 'owner-uuid-test',
  systemPrompt: 'You are a helpful assistant.',
  model: 'anthropic/claude-sonnet-4', // Paid model
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'A helpful test personality',
  personalityTraits: 'Helpful, friendly',
  voiceEnabled: false,
};

function createValidJobData(): LLMGenerationJobData {
  return {
    requestId: 'test-req-001',
    jobType: JobType.LLMGeneration,
    personality: TEST_PERSONALITY,
    message: 'Hello, how are you?',
    context: {
      userId: 'user-456',
      userName: 'TestUser',
      channelId: 'channel-789',
    },
    responseDestination: {
      type: 'discord',
      channelId: 'channel-789',
    },
  };
}

function createMockJob(data: Partial<LLMGenerationJobData> = {}): Job<LLMGenerationJobData> {
  return {
    id: 'job-123',
    data: { ...createValidJobData(), ...data } as LLMGenerationJobData,
  } as Job<LLMGenerationJobData>;
}

function createMockApiKeyResolver(): ApiKeyResolver {
  return {
    resolveApiKey: vi.fn(),
    tryResolveUserKey: vi.fn(),
    invalidateUserCache: vi.fn(),
    clearCache: vi.fn(),
    // Never-throwing convenience helpers used by the quota-fallback paths.
    resolveSystemOpenRouterKey: vi.fn().mockResolvedValue('sk-system-key'),
    resolveUserOpenRouterKey: vi.fn().mockResolvedValue('sk-user-key'),
  } as unknown as ApiKeyResolver;
}

function createMockConfigResolver(): LlmConfigResolver {
  return {
    resolveConfig: vi.fn(),
    getFreeDefaultConfig: vi.fn(),
    invalidateUserCache: vi.fn(),
    clearCache: vi.fn(),
  } as unknown as LlmConfigResolver;
}

function createMockSttResolver(provider: SttProvider): SttResolver {
  return {
    resolveProvider: vi.fn().mockResolvedValue({ provider, source: 'hardcoded' }),
    invalidateUserCache: vi.fn(),
    clearCache: vi.fn(),
  } as unknown as SttResolver;
}

describe('AuthStep', () => {
  let step: AuthStep;
  let mockApiKeyResolver: ApiKeyResolver;
  let mockConfigResolver: LlmConfigResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiKeyResolver = createMockApiKeyResolver();
    mockConfigResolver = createMockConfigResolver();
  });

  it('should have correct name', () => {
    step = new AuthStep();
    expect(step.name).toBe('AuthResolution');
  });

  describe('process', () => {
    it('should throw error if config is missing', async () => {
      step = new AuthStep();

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        // No config
      };

      await expect(step.process(context)).rejects.toThrow('ConfigStep must run before AuthStep');
    });

    it('should return auth with no key when no resolver provided', async () => {
      step = new AuthStep(); // No resolver

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.auth).toBeDefined();
      expect(result.auth?.apiKey).toBeUndefined();
      expect(result.auth?.isGuestMode).toBe(false);
    });

    it('should resolve API key from resolver (BYOK)', async () => {
      const keyResult: ApiKeyResolutionResult = {
        apiKey: 'sk-test-key',
        provider: AIProvider.OpenRouter,
        source: 'user',
        isGuestMode: false,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(keyResult);

      step = new AuthStep(mockApiKeyResolver);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.auth?.apiKey).toBe('sk-test-key');
      expect(result.auth?.provider).toBe(AIProvider.OpenRouter);
      expect(result.auth?.isGuestMode).toBe(false);
    });

    it('should enter guest mode when resolver indicates guest mode', async () => {
      const keyResult: ApiKeyResolutionResult = {
        apiKey: 'system-key',
        provider: AIProvider.OpenRouter,
        source: 'system',
        isGuestMode: true,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(keyResult);
      vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue(null);

      step = new AuthStep(mockApiKeyResolver, mockConfigResolver);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.auth?.isGuestMode).toBe(true);
      // Should override model to guest default
      expect(result.config?.effectivePersonality.model).toBe(GUEST_MODE.DEFAULT_MODEL);
    });

    it('should fall back to guest mode when resolver throws', async () => {
      vi.mocked(mockApiKeyResolver.resolveApiKey).mockRejectedValue(
        new Error('Database connection failed')
      );
      vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue(null);

      step = new AuthStep(mockApiKeyResolver, mockConfigResolver);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.auth?.isGuestMode).toBe(true);
      expect(result.auth?.apiKey).toBeUndefined();
    });

    describe('proactive quota fallback', () => {
      const BYOK_RESULT: ApiKeyResolutionResult = {
        apiKey: 'sk-user-key',
        provider: AIProvider.OpenRouter,
        source: 'user',
        isGuestMode: false,
      };
      const SYSTEM_RESULT: ApiKeyResolutionResult = {
        apiKey: 'sk-system-key',
        provider: AIProvider.OpenRouter,
        source: 'system',
        isGuestMode: true,
      };

      function buildCaches(overrides?: { exhausted?: boolean; rateLimitedModels?: string[] }): {
        creditExhaustion: { isCreditExhausted: ReturnType<typeof vi.fn> };
        rateLimit: { isRateLimited: ReturnType<typeof vi.fn> };
      } {
        const rateLimitedModels = overrides?.rateLimitedModels ?? [];
        return {
          creditExhaustion: {
            isCreditExhausted: vi
              .fn()
              .mockResolvedValue(
                overrides?.exhausted === true
                  ? { exhausted: true, exhaustedAtMs: 0, ttlSeconds: 60 }
                  : { exhausted: false }
              ),
          },
          rateLimit: {
            isRateLimited: vi
              .fn()
              .mockImplementation(({ model }: { model: string }) =>
                Promise.resolve(
                  rateLimitedModels.includes(model) ? { rateLimited: true } : { rateLimited: false }
                )
              ),
          },
        };
      }

      function buildContext(): GenerationContext {
        return {
          job: createMockJob(),
          startTime: Date.now(),
          config: { effectivePersonality: TEST_PERSONALITY, configSource: 'personality' },
        };
      }

      it('retargets a rate-limited model to the global default and announces it', async () => {
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(BYOK_RESULT);
        const resolverWithGlobal = {
          ...mockConfigResolver,
          getGlobalDefaultConfig: vi
            .fn()
            .mockResolvedValue({ model: 'paid/default', temperature: 0.5 }),
        } as unknown as LlmConfigResolver;
        const caches = buildCaches({
          rateLimitedModels: [TEST_PERSONALITY.model],
        });

        step = new AuthStep(
          mockApiKeyResolver,
          resolverWithGlobal,
          undefined,
          undefined,
          caches as never
        );
        const result = await step.process(buildContext());

        // Seam assertions: the personality actually got rewritten and the swap announced.
        expect(result.config?.effectivePersonality.model).toBe('paid/default');
        expect(result.config?.effectivePersonality.temperature).toBe(0.5);
        expect(result.auth?.apiKey).toBe('sk-user-key');
        expect(result.auth?.quotaFallback).toEqual({
          fromModel: TEST_PERSONALITY.model,
          toModel: 'paid/default',
          category: 'quota_exceeded',
          mode: 'proactive',
        });
      });

      it('credit-exhausted BYOK: retargets to the free default on the SYSTEM key with guest semantics', async () => {
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockImplementation(userId =>
          Promise.resolve(userId === undefined ? SYSTEM_RESULT : BYOK_RESULT)
        );
        const resolverWithFree = {
          ...mockConfigResolver,
          getFreeDefaultConfig: vi.fn().mockResolvedValue({ model: 'free/model' }),
          getGlobalDefaultConfig: vi.fn().mockResolvedValue(null),
        } as unknown as LlmConfigResolver;
        const caches = buildCaches({ exhausted: true });

        step = new AuthStep(
          mockApiKeyResolver,
          resolverWithFree,
          undefined,
          undefined,
          caches as never
        );
        const result = await step.process(buildContext());

        expect(result.config?.effectivePersonality.model).toBe('free/model');
        expect(result.auth?.apiKey).toBe('sk-system-key');
        expect(result.auth?.isGuestMode).toBe(true);
        expect(result.auth?.quotaFallback?.category).toBe('credit_exhaustion');
        expect(result.auth?.quotaFallback?.mode).toBe('proactive');
      });

      it('does nothing when the resolved model is viable', async () => {
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(BYOK_RESULT);
        const caches = buildCaches();

        step = new AuthStep(
          mockApiKeyResolver,
          mockConfigResolver,
          undefined,
          undefined,
          caches as never
        );
        const result = await step.process(buildContext());

        expect(result.config?.effectivePersonality.model).toBe(TEST_PERSONALITY.model);
        expect(result.auth?.quotaFallback).toBeUndefined();
      });

      it('z.ai-promoted personality: retarget resets provider, swaps to the user OpenRouter key, and clears the stale auto-promotion route', async () => {
        // The motivating incident's population — the reviewer-flagged
        // zero-coverage intersection of auto-promotion and quota fallback.
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockImplementation((_userId, provider) =>
          Promise.resolve(
            provider === AIProvider.ZaiCoding
              ? {
                  apiKey: 'sk-zai-key',
                  provider: AIProvider.ZaiCoding,
                  source: 'user',
                  isGuestMode: false,
                }
              : BYOK_RESULT
          )
        );
        const resolverWithGlobal = {
          ...mockConfigResolver,
          getGlobalDefaultConfig: vi
            .fn()
            .mockResolvedValue({ model: 'paid/default', provider: 'openrouter' }),
        } as unknown as LlmConfigResolver;
        // z-ai model auto-promotes via the real ProviderRouter (no injected
        // router), then the doom-cache blocks the promoted model.
        const caches = buildCaches({ rateLimitedModels: ['glm-5.2'] });

        step = new AuthStep(
          mockApiKeyResolver,
          resolverWithGlobal,
          undefined,
          undefined,
          caches as never
        );
        const context: GenerationContext = {
          job: createMockJob({
            personality: { ...TEST_PERSONALITY, model: 'z-ai/glm-5.2', provider: 'openrouter' },
          }),
          startTime: Date.now(),
          config: {
            effectivePersonality: {
              ...TEST_PERSONALITY,
              model: 'z-ai/glm-5.2',
              provider: 'openrouter',
            },
            configSource: 'personality',
          },
        };
        const result = await step.process(context);

        // Provider rewritten with the model — not left as zai-coding.
        expect(result.config?.effectivePersonality.model).toBe('paid/default');
        expect(result.config?.effectivePersonality.provider).toBe('openrouter');
        // Key swapped to the user's OpenRouter credential, not the z.ai key.
        expect(result.auth?.apiKey).toBe('sk-user-key');
        // The separately-tracked provider tier follows the retarget (drives
        // the context-window clamp, vision auth, and the footer badge).
        expect(result.auth?.provider).toBe(AIProvider.OpenRouter);
        // Stale auto-promotion route cleared — GenerationStep must not retry
        // a failure via the replaced model's passthrough route.
        expect(result.auth?.wasAutoPromoted).toBeUndefined();
        expect(result.auth?.fallback).toBeUndefined();
        expect(result.auth?.quotaFallback?.fromModel).toBe('glm-5.2');
        expect(result.auth?.quotaFallback?.toModel).toBe('paid/default');
      });

      it('does nothing when the caches are not wired (test fixtures)', async () => {
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(BYOK_RESULT);

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver);
        const result = await step.process(buildContext());

        expect(result.auth?.quotaFallback).toBeUndefined();
      });
    });

    describe('zai-coding provider routing', () => {
      const ZAI_PERSONALITY: LoadedPersonality = {
        ...TEST_PERSONALITY,
        provider: 'zai-coding',
        model: 'glm-4.7',
      };

      it('should apply fallthrough overrides to effectivePersonality when user has no z.ai key', async () => {
        // No z.ai-coding key → ProviderRouter returns OpenRouter fallthrough.
        // AuthStep MUST apply the model + provider overrides to effectivePersonality
        // so downstream code (ConversationalRAGService → ModelFactory) reads the
        // post-route values. Regression in this block silently sends wrong-provider
        // requests with wrong-key.
        vi.mocked(mockApiKeyResolver.tryResolveUserKey).mockResolvedValue(null);
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue({
          apiKey: 'sk-or-user-key',
          provider: AIProvider.OpenRouter,
          source: 'user',
          isGuestMode: false,
        });

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver);
        const result = await step.process({
          job: createMockJob(),
          startTime: Date.now(),
          config: { effectivePersonality: ZAI_PERSONALITY, configSource: 'personality' },
        });

        // Override applied: model gets z-ai/ prefix, provider becomes openrouter
        expect(result.config?.effectivePersonality.model).toBe('z-ai/glm-4.7');
        expect(result.config?.effectivePersonality.provider).toBe(AIProvider.OpenRouter);
        expect(result.auth?.apiKey).toBe('sk-or-user-key');
        expect(result.auth?.provider).toBe(AIProvider.OpenRouter);
      });

      it('should NOT override effectivePersonality on direct z.ai-coding route', async () => {
        // User has z.ai-coding key → direct route, no fallthrough, no override.
        // effectivePersonality.model and .provider stay as configured.
        vi.mocked(mockApiKeyResolver.tryResolveUserKey).mockResolvedValue('zai-user-key');

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver);
        const result = await step.process({
          job: createMockJob(),
          startTime: Date.now(),
          config: { effectivePersonality: ZAI_PERSONALITY, configSource: 'personality' },
        });

        expect(result.config?.effectivePersonality.model).toBe('glm-4.7');
        expect(result.config?.effectivePersonality.provider).toBe('zai-coding');
        expect(result.auth?.apiKey).toBe('zai-user-key');
        expect(result.auth?.provider).toBe(AIProvider.ZaiCoding);
        // resolveApiKey should NOT be called for the LLM path on direct z.ai route
        // (it'll be called once for ElevenLabs after, but not for OpenRouter fallthrough)
        const orCalls = vi
          .mocked(mockApiKeyResolver.resolveApiKey)
          .mock.calls.filter(c => c[1] === AIProvider.OpenRouter);
        expect(orCalls).toHaveLength(0);
      });

      it('should apply auto-promotion overrides to effectivePersonality when openrouter z-ai/ + user has z.ai key', async () => {
        // Inverse symmetry of fallthrough: preset configured for OpenRouter
        // with model `z-ai/glm-5.1`, user has z.ai-coding key. ProviderRouter
        // auto-promotes; AuthStep MUST apply the model + provider overrides
        // to effectivePersonality so ModelFactory builds the z.ai client with
        // the bare model name (not the OpenRouter client with the prefixed name).
        const OR_ZAI_PERSONALITY: LoadedPersonality = {
          ...TEST_PERSONALITY,
          provider: 'openrouter',
          model: 'z-ai/glm-5.1',
        };
        vi.mocked(mockApiKeyResolver.tryResolveUserKey).mockResolvedValue('zai-user-key');
        // ProviderRouter pre-computes the OpenRouter fallback alongside the
        // promotion (for retry-with-fallback in GenerationStep), so the mock
        // must serve the openrouter resolution.
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue({
          apiKey: 'sk-or-user-key',
          provider: AIProvider.OpenRouter,
          source: 'user',
          isGuestMode: false,
        });

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver);
        const result = await step.process({
          job: createMockJob(),
          startTime: Date.now(),
          config: { effectivePersonality: OR_ZAI_PERSONALITY, configSource: 'personality' },
        });

        // Override applied: model gets z-ai/ stripped, provider becomes zai-coding
        expect(result.config?.effectivePersonality.model).toBe('glm-5.1');
        expect(result.config?.effectivePersonality.provider).toBe(AIProvider.ZaiCoding);
        expect(result.auth?.apiKey).toBe('zai-user-key');
        expect(result.auth?.provider).toBe(AIProvider.ZaiCoding);
        // wasAutoPromoted + fallback plumbed onto auth for retry-with-fallback
        expect(result.auth?.wasAutoPromoted).toBe(true);
        expect(result.auth?.fallback).toEqual({
          apiKey: 'sk-or-user-key',
          provider: AIProvider.OpenRouter,
          model: 'z-ai/glm-5.1', // original namespaced form preserved
          isGuestMode: false,
        });
      });
    });

    describe('ProviderRouter injection', () => {
      it('should use the injected ProviderRouter instead of auto-constructing one', async () => {
        // Constructor seam test: when a ProviderRouter is passed explicitly,
        // AuthStep must use it. Future tests can leverage this to isolate
        // AuthStep behavior from real ProviderRouter logic. We prove the seam
        // works by injecting a stub that returns a fixture only this stub
        // would produce (a sentinel apiKey + provider) and asserting AuthStep
        // surfaces those values — if AuthStep had auto-constructed its own
        // router, the result would reflect the apiKeyResolver mock instead.
        const injectedRouter = {
          resolveRoute: vi.fn().mockResolvedValue({
            effectiveProvider: AIProvider.OpenRouter,
            effectiveModel: 'injected/model',
            apiKey: 'injected-router-sentinel-key',
            isGuestMode: false,
            fallthroughTriggered: false,
          }),
        } as unknown as import('../../../../services/ProviderRouter.js').ProviderRouter;

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver, injectedRouter);
        const result = await step.process({
          job: createMockJob(),
          startTime: Date.now(),
          config: { effectivePersonality: TEST_PERSONALITY, configSource: 'personality' },
        });

        expect(injectedRouter.resolveRoute).toHaveBeenCalledTimes(1);
        expect(result.auth?.apiKey).toBe('injected-router-sentinel-key');
        // apiKeyResolver.resolveApiKey was NOT called for the LLM path because
        // the injected router short-circuited the resolution.
        const orCalls = vi
          .mocked(mockApiKeyResolver.resolveApiKey)
          .mock.calls.filter(c => c[1] === AIProvider.OpenRouter);
        expect(orCalls).toHaveLength(0);
      });
    });

    it('should not override model if already free in guest mode', async () => {
      const freePersonality: LoadedPersonality = {
        ...TEST_PERSONALITY,
        model: 'google/gemma-2-free', // Free model
      };

      const keyResult: ApiKeyResolutionResult = {
        apiKey: 'system-key',
        provider: AIProvider.OpenRouter,
        source: 'system',
        isGuestMode: true,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(keyResult);

      step = new AuthStep(mockApiKeyResolver, mockConfigResolver);

      const config: ResolvedConfig = {
        effectivePersonality: freePersonality,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.auth?.isGuestMode).toBe(true);
      // Should keep free model
      expect(result.config?.effectivePersonality.model).toBe('google/gemma-2-free');
    });

    it('should use database free default when available in guest mode', async () => {
      const keyResult: ApiKeyResolutionResult = {
        apiKey: 'system-key',
        provider: AIProvider.OpenRouter,
        source: 'system',
        isGuestMode: true,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(keyResult);
      vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue({
        model: 'custom/free-model',
      });

      step = new AuthStep(mockApiKeyResolver, mockConfigResolver);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.config?.effectivePersonality.model).toBe('custom/free-model');
    });

    it('should resolve ElevenLabs API key when available', async () => {
      const openRouterResult: ApiKeyResolutionResult = {
        apiKey: 'sk-or-test',
        provider: AIProvider.OpenRouter,
        source: 'user',
        isGuestMode: false,
      };

      const elevenLabsResult: ApiKeyResolutionResult = {
        apiKey: 'sk_el_test',
        provider: AIProvider.ElevenLabs,
        source: 'user',
        isGuestMode: false,
      };

      // After PR 1 audioProviderKeys dual-write: AuthStep ALSO probes Mistral
      // alongside ElevenLabs. Mock returns guest-mode (system fallback, isGuestMode=true)
      // — AuthStep skips populating the map entry for guest-mode resolutions.
      const mistralNotConfigured: ApiKeyResolutionResult = {
        apiKey: '',
        provider: AIProvider.Mistral,
        source: 'system',
        isGuestMode: true,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey)
        .mockResolvedValueOnce(openRouterResult)
        .mockResolvedValueOnce(elevenLabsResult)
        .mockResolvedValueOnce(mistralNotConfigured);

      step = new AuthStep(mockApiKeyResolver);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.auth?.apiKey).toBe('sk-or-test');
      expect(result.auth?.audioProviderKeys?.get('elevenlabs')).toBe('sk_el_test');
      expect(result.auth?.audioProviderKeys?.has('mistral')).toBe(false); // not configured
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledTimes(3);
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledWith(
        'user-456',
        AIProvider.ElevenLabs
      );
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledWith('user-456', AIProvider.Mistral);
    });

    it('should skip ElevenLabs resolution in guest mode', async () => {
      const keyResult: ApiKeyResolutionResult = {
        apiKey: 'system-key',
        provider: AIProvider.OpenRouter,
        source: 'system',
        isGuestMode: true,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(keyResult);
      vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue(null);

      step = new AuthStep(mockApiKeyResolver, mockConfigResolver);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.auth?.audioProviderKeys?.has('elevenlabs')).toBe(false);
      // Only called once (OpenRouter), not twice
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledTimes(1);
    });

    it('should silently handle ElevenLabs resolution failure', async () => {
      const openRouterResult: ApiKeyResolutionResult = {
        apiKey: 'sk-or-test',
        provider: AIProvider.OpenRouter,
        source: 'user',
        isGuestMode: false,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey)
        .mockResolvedValueOnce(openRouterResult)
        .mockRejectedValueOnce(new Error('No ElevenLabs key'));

      step = new AuthStep(mockApiKeyResolver);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.auth?.apiKey).toBe('sk-or-test');
      expect(result.auth?.audioProviderKeys?.has('elevenlabs')).toBe(false);
      expect(result.auth?.isGuestMode).toBe(false);
    });

    describe('sttDispatch', () => {
      function setupResolvers(): {
        openRouter: ApiKeyResolutionResult;
        elevenLabs: ApiKeyResolutionResult;
        mistralUnconfigured: ApiKeyResolutionResult;
      } {
        return {
          openRouter: {
            apiKey: 'sk-or-test',
            provider: AIProvider.OpenRouter,
            source: 'user',
            isGuestMode: false,
          },
          elevenLabs: {
            apiKey: 'sk_el_test',
            provider: AIProvider.ElevenLabs,
            source: 'user',
            isGuestMode: false,
          },
          mistralUnconfigured: {
            apiKey: '',
            provider: AIProvider.Mistral,
            source: 'system',
            isGuestMode: true,
          },
        };
      }

      function buildContext(): GenerationContext {
        return {
          job: createMockJob(),
          startTime: Date.now(),
          config: {
            effectivePersonality: TEST_PERSONALITY,
            configSource: 'personality',
          },
        };
      }

      it('should return undefined sttDispatch when no SttResolver is wired', async () => {
        const { openRouter, elevenLabs, mistralUnconfigured } = setupResolvers();
        vi.mocked(mockApiKeyResolver.resolveApiKey)
          .mockResolvedValueOnce(openRouter)
          .mockResolvedValueOnce(elevenLabs)
          .mockResolvedValueOnce(mistralUnconfigured);

        step = new AuthStep(mockApiKeyResolver);
        const result = await step.process(buildContext());

        expect(result.auth?.sttDispatch).toBeUndefined();
      });

      it('should set apiKey to undefined when resolver picks voice-engine', async () => {
        const { openRouter, elevenLabs, mistralUnconfigured } = setupResolvers();
        vi.mocked(mockApiKeyResolver.resolveApiKey)
          .mockResolvedValueOnce(openRouter)
          .mockResolvedValueOnce(elevenLabs)
          .mockResolvedValueOnce(mistralUnconfigured);

        const sttResolver = createMockSttResolver('voice-engine');
        step = new AuthStep(mockApiKeyResolver, undefined, undefined, sttResolver);
        const result = await step.process(buildContext());

        expect(result.auth?.sttDispatch).toEqual({ provider: 'voice-engine', apiKey: undefined });
        expect(sttResolver.resolveProvider).toHaveBeenCalledWith('user-456');
      });

      it('should attach matching BYOK key when resolver picks elevenlabs', async () => {
        const { openRouter, elevenLabs, mistralUnconfigured } = setupResolvers();
        vi.mocked(mockApiKeyResolver.resolveApiKey)
          .mockResolvedValueOnce(openRouter)
          .mockResolvedValueOnce(elevenLabs)
          .mockResolvedValueOnce(mistralUnconfigured);

        const sttResolver = createMockSttResolver('elevenlabs');
        step = new AuthStep(mockApiKeyResolver, undefined, undefined, sttResolver);
        const result = await step.process(buildContext());

        expect(result.auth?.sttDispatch).toEqual({
          provider: 'elevenlabs',
          apiKey: 'sk_el_test',
        });
      });

      it('should leave apiKey undefined when resolver picks BYOK provider with no key', async () => {
        // Mistral resolver picks mistral, but user has no Mistral key — apiKey stays
        // undefined. AudioProcessor's tryBYOKTranscription returns null in that case
        // and the dispatch falls through to voice-engine.
        const { openRouter, elevenLabs, mistralUnconfigured } = setupResolvers();
        vi.mocked(mockApiKeyResolver.resolveApiKey)
          .mockResolvedValueOnce(openRouter)
          .mockResolvedValueOnce(elevenLabs)
          .mockResolvedValueOnce(mistralUnconfigured);

        const sttResolver = createMockSttResolver('mistral');
        step = new AuthStep(mockApiKeyResolver, undefined, undefined, sttResolver);
        const result = await step.process(buildContext());

        expect(result.auth?.sttDispatch).toEqual({
          provider: 'mistral',
          apiKey: undefined,
        });
      });

      it('should degrade to voice-engine when STT resolver throws', async () => {
        // Resolver failures (DB/network blip) shouldn't fail a non-audio turn.
        // The catch path returns the self-hosted fallback so AudioProcessor
        // can take over only if there's actually an attachment.
        const { openRouter, elevenLabs, mistralUnconfigured } = setupResolvers();
        vi.mocked(mockApiKeyResolver.resolveApiKey)
          .mockResolvedValueOnce(openRouter)
          .mockResolvedValueOnce(elevenLabs)
          .mockResolvedValueOnce(mistralUnconfigured);

        const sttResolver = createMockSttResolver('mistral');
        vi.mocked(sttResolver.resolveProvider).mockRejectedValueOnce(
          new Error('DB connection refused')
        );
        step = new AuthStep(mockApiKeyResolver, undefined, undefined, sttResolver);
        const result = await step.process(buildContext());

        expect(result.auth?.sttDispatch).toEqual({ provider: 'voice-engine' });
      });
    });

    it('should clear non-free vision model in guest mode', async () => {
      const personalityWithVision: LoadedPersonality = {
        ...TEST_PERSONALITY,
        visionModel: 'openai/gpt-4o-vision', // Paid vision model
      };

      const keyResult: ApiKeyResolutionResult = {
        apiKey: 'system-key',
        provider: AIProvider.OpenRouter,
        source: 'system',
        isGuestMode: true,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(keyResult);
      vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue(null);

      step = new AuthStep(mockApiKeyResolver, mockConfigResolver);

      const config: ResolvedConfig = {
        effectivePersonality: personalityWithVision,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      // Should clear non-free vision model
      expect(result.config?.effectivePersonality.visionModel).toBeUndefined();
    });
  });
});
