/**
 * AuthStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  AIProvider,
  FREE_ROUTER_MODEL,
  ZAI_FREE_TIER_MODEL,
} from '@tzurot/common-types/constants/ai';
import type { ZaiFreeTierAdmission } from '../../../../services/ZaiFreeTierAdmission.js';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { AuthStep } from './AuthStep.js';
import type { GenerationContext, ResolvedConfig } from '../types.js';
import {
  NoApiKeyAvailableError,
  type ApiKeyResolver,
  type ApiKeyResolutionResult,
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

// One stable logger instance (createLogger runs once at AuthStep module load),
// so tests can assert on the LEVEL a given path logs at — the no-key audio
// fallbacks are expected control flow and must stay off the warn stream.
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => loggerMock,
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
      kind: 'envelope',
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
      expect(result.config?.effectivePersonality.model).toBe(FREE_ROUTER_MODEL);
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

    describe('guest-mode substitution reaches the footer', () => {
      const GUEST_ANNOUNCE = {
        fromModel: 'anthropic/claude-sonnet-4',
        toModel: FREE_ROUTER_MODEL,
        category: 'guest_mode',
        mode: 'proactive',
      };

      function guestContext(): GenerationContext {
        return {
          job: createMockJob(),
          startTime: Date.now(),
          config: { effectivePersonality: TEST_PERSONALITY, configSource: 'personality' },
        };
      }

      it('threads the announce carrier through the NORMAL guest arm', async () => {
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue({
          apiKey: 'system-key',
          provider: AIProvider.OpenRouter,
          source: 'system',
          isGuestMode: true,
        });
        vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue(null);

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver);
        const result = await step.process(guestContext());

        expect(result.auth?.quotaFallback).toEqual(GUEST_ANNOUNCE);
      });

      it('threads the announce carrier through the ERROR-RECOVERY guest arm', async () => {
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockRejectedValue(
          new Error('Database connection failed')
        );
        vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue(null);

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver);
        const result = await step.process(guestContext());

        expect(result.auth?.quotaFallback).toEqual(GUEST_ANNOUNCE);
      });

      it('carries nothing when the guest was already on a free model', async () => {
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue({
          apiKey: 'system-key',
          provider: AIProvider.OpenRouter,
          source: 'system',
          isGuestMode: true,
        });

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver);
        const context = guestContext();
        const result = await step.process({
          ...context,
          config: {
            effectivePersonality: { ...TEST_PERSONALITY, model: 'some/free-model' },
            configSource: 'personality',
          },
        });

        expect(result.auth?.quotaFallback).toBeUndefined();
      });
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

      // Bucket-aware doom-cache mock: marks are (cacheKeyId[, model])-scoped in
      // Redis, and a mock that ignores the bucket cannot catch a wrong-identity
      // read. `exhausted: true` / a bare model string mark every bucket.
      function buildCaches(overrides?: {
        exhausted?: boolean | string[];
        rateLimitedModels?: (string | { cacheKeyId: string; model: string })[];
      }): {
        creditExhaustion: { isCreditExhausted: ReturnType<typeof vi.fn> };
        rateLimit: { isRateLimited: ReturnType<typeof vi.fn> };
      } {
        const exhausted = overrides?.exhausted ?? false;
        const rateLimitedModels = overrides?.rateLimitedModels ?? [];
        return {
          creditExhaustion: {
            isCreditExhausted: vi
              .fn()
              .mockImplementation(({ cacheKeyId }: { cacheKeyId: string }) =>
                Promise.resolve(
                  exhausted === true || (Array.isArray(exhausted) && exhausted.includes(cacheKeyId))
                    ? { exhausted: true, exhaustedAtMs: 0, ttlSeconds: 60 }
                    : { exhausted: false }
                )
              ),
          },
          rateLimit: {
            isRateLimited: vi
              .fn()
              .mockImplementation(({ cacheKeyId, model }: { cacheKeyId: string; model: string }) =>
                Promise.resolve(
                  rateLimitedModels.some(entry =>
                    typeof entry === 'string'
                      ? entry === model
                      : entry.model === model && entry.cacheKeyId === cacheKeyId
                  )
                    ? { rateLimited: true }
                    : { rateLimited: false }
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

        step = new AuthStep(mockApiKeyResolver, resolverWithGlobal, undefined, undefined, {
          quotaFallbackCaches: caches as never,
        });
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
        // Only the USER's account is exhausted — the system bucket is healthy,
        // so the forced-swap target must survive its own viability check.
        const caches = buildCaches({ exhausted: ['user:user-456'] });

        step = new AuthStep(mockApiKeyResolver, resolverWithFree, undefined, undefined, {
          quotaFallbackCaches: caches as never,
        });
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

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver, undefined, undefined, {
          quotaFallbackCaches: caches as never,
        });
        const result = await step.process(buildContext());

        expect(result.config?.effectivePersonality.model).toBe(TEST_PERSONALITY.model);
        expect(result.auth?.quotaFallback).toBeUndefined();
      });

      it("a guest route's viability check reads the system bucket — the user's own doom marks are irrelevant", async () => {
        // A guest resolves the SYSTEM key as a plain string; identity must
        // follow that provenance. The user's `user:<id>` bucket carrying a
        // mark for the guest's model (their BYOK history) must not veto or
        // retarget a route that bills the shared pool.
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(SYSTEM_RESULT);
        vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue(null);
        const caches = buildCaches({
          rateLimitedModels: [{ cacheKeyId: 'user:user-456', model: FREE_ROUTER_MODEL }],
        });

        step = new AuthStep(mockApiKeyResolver, mockConfigResolver, undefined, undefined, {
          quotaFallbackCaches: caches as never,
        });
        const result = await step.process(buildContext());

        // Guest override lands on the free router; the stale user-bucket mark
        // must not have retargeted it away. The announce carrier is the guest
        // substitution itself — a retarget would have stamped a FAILURE
        // category here instead.
        expect(result.config?.effectivePersonality.model).toBe(FREE_ROUTER_MODEL);
        expect(result.auth?.quotaFallback?.category).toBe('guest_mode');
        expect(caches.rateLimit.isRateLimited).toHaveBeenCalledWith(
          expect.objectContaining({ cacheKeyId: 'system' })
        );
        expect(caches.rateLimit.isRateLimited).not.toHaveBeenCalledWith(
          expect.objectContaining({ cacheKeyId: 'user:user-456' })
        );
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
        // router), then the doom-cache blocks BOTH pools — the promoted model
        // AND its OpenRouter passthrough — so the demotion tier passes and the
        // global-default retarget (this test's subject) fires. A doomed
        // promotion with a VIABLE passthrough now demotes instead (covered by
        // the demotion-tier describe block).
        const caches = buildCaches({ rateLimitedModels: ['glm-5.2', 'z-ai/glm-5.2'] });

        step = new AuthStep(mockApiKeyResolver, resolverWithGlobal, undefined, undefined, {
          quotaFallbackCaches: caches as never,
        });
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

    describe('promotion demotion tier (doomed z.ai promotion → OpenRouter passthrough)', () => {
      const PROMOTED_ROUTE = {
        effectiveProvider: AIProvider.ZaiCoding,
        effectiveModel: 'glm-5.2',
        apiKey: 'sk-zai-key',
        isGuestMode: false,
        fallthroughTriggered: false,
        wasAutoPromoted: true,
        fallback: {
          apiKey: 'sk-openrouter-key',
          provider: AIProvider.OpenRouter,
          model: 'z-ai/glm-5.2',
          isGuestMode: false,
        },
      };

      function buildDemotionCaches(rateLimitedModels: string[]): unknown {
        return {
          creditExhaustion: {
            isCreditExhausted: vi.fn().mockResolvedValue({ exhausted: false }),
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

      function makeStep(rateLimitedModels: string[], router?: unknown): AuthStep {
        const injectedRouter = (router ?? {
          resolveRoute: vi.fn().mockResolvedValue(PROMOTED_ROUTE),
        }) as import('../../../../services/ProviderRouter.js').ProviderRouter;
        return new AuthStep(mockApiKeyResolver, mockConfigResolver, injectedRouter, undefined, {
          quotaFallbackCaches: buildDemotionCaches(rateLimitedModels) as never,
        });
      }

      function makeContext(): GenerationContext {
        return {
          job: createMockJob(),
          startTime: Date.now(),
          config: { effectivePersonality: TEST_PERSONALITY, configSource: 'personality' },
        };
      }

      it('demotes a doomed promotion to the OpenRouter passthrough (same model, announced)', async () => {
        step = makeStep(['glm-5.2']); // z.ai pool doomed; OpenRouter pool clean

        const result = await step.process(makeContext());

        expect(result.config?.effectivePersonality.model).toBe('z-ai/glm-5.2');
        expect(result.config?.effectivePersonality.provider).toBe(AIProvider.OpenRouter);
        expect(result.auth?.apiKey).toBe('sk-openrouter-key');
        expect(result.auth?.quotaFallback).toEqual({
          fromModel: 'glm-5.2',
          toModel: 'z-ai/glm-5.2',
          category: 'quota_exceeded',
          mode: 'proactive',
        });
        // The passthrough is consumed — no stale rescue route survives.
        expect(result.auth?.fallback).toBeUndefined();
        expect(result.auth?.wasAutoPromoted).toBeUndefined();
        // The demotion's own classification must SURVIVE this hop. It is
        // optional on ResolvedAuth, so dropping it compiles cleanly and the
        // endpoint tests on either side still pass while the reactive retarget
        // silently dead-ends — which is exactly how it shipped once. This is
        // the only test that drives the real process() wiring.
        expect(result.auth?.inheritedQuotaCategory).toBe('quota_exceeded');
      });

      it('falls through to the global-default retarget when BOTH pools are doomed', async () => {
        const resolverWithGlobal = {
          ...mockConfigResolver,
          getGlobalDefaultConfig: vi
            .fn()
            .mockResolvedValue({ model: 'paid/default', temperature: 0.5 }),
        } as unknown as LlmConfigResolver;
        const injectedRouter = {
          resolveRoute: vi.fn().mockResolvedValue(PROMOTED_ROUTE),
        } as unknown as import('../../../../services/ProviderRouter.js').ProviderRouter;
        // The quota retarget (OpenRouter target) needs the user's own OR key.
        vi.mocked(mockApiKeyResolver.resolveUserOpenRouterKey).mockResolvedValue(
          'sk-openrouter-key'
        );
        step = new AuthStep(mockApiKeyResolver, resolverWithGlobal, injectedRouter, undefined, {
          quotaFallbackCaches: buildDemotionCaches(['glm-5.2', 'z-ai/glm-5.2']) as never,
        });

        const result = await step.process(makeContext());

        expect(result.config?.effectivePersonality.model).toBe('paid/default');
        expect(result.auth?.quotaFallback?.fromModel).toBe('glm-5.2');
        expect(result.auth?.quotaFallback?.toModel).toBe('paid/default');
        // The INVERSE of the demotion invariant, and the reason the two are
        // separate fields: this branch already spent the retarget tier, so
        // carrying a category forward would let the request retarget to the
        // admin default it is ALREADY on — a no-op retry loop. The branch
        // spreads `...llmAuth`, which happens not to carry the field today, so
        // without this assertion a future refactor could reintroduce the loop
        // silently.
        expect(result.auth?.inheritedQuotaCategory).toBeUndefined();
      });

      it('promotion WITHOUT a pre-computed fallback skips demotion (falls to quota retarget)', async () => {
        // Reachable production state: ProviderRouter promotes but the
        // OpenRouter fallback resolution failed (its catch block proceeds
        // sans-fallback). A doomed promotion must then take the retarget.
        const { fallback: _unused, ...promotedNoFallback } = PROMOTED_ROUTE;
        const resolverWithGlobal = {
          ...mockConfigResolver,
          getGlobalDefaultConfig: vi
            .fn()
            .mockResolvedValue({ model: 'paid/default', temperature: 0.5 }),
        } as unknown as LlmConfigResolver;
        const injectedRouter = {
          resolveRoute: vi.fn().mockResolvedValue(promotedNoFallback),
        } as unknown as import('../../../../services/ProviderRouter.js').ProviderRouter;
        vi.mocked(mockApiKeyResolver.resolveUserOpenRouterKey).mockResolvedValue(
          'sk-openrouter-key'
        );
        step = new AuthStep(mockApiKeyResolver, resolverWithGlobal, injectedRouter, undefined, {
          quotaFallbackCaches: buildDemotionCaches(['glm-5.2']) as never,
        });

        const result = await step.process(makeContext());

        expect(result.config?.effectivePersonality.model).toBe('paid/default');
        expect(result.auth?.quotaFallback?.toModel).toBe('paid/default');
      });

      it('z.ai-only user (no OpenRouter key): doomed promotion degrades to the FREE default on the system key', async () => {
        // Degraded-beats-failed: the paid retarget needs the user's own
        // OpenRouter key; without one the request must still work — free
        // default, system key, guest semantics, zero owner cost.
        const promotedGuestFallback = {
          ...PROMOTED_ROUTE,
          fallback: { ...PROMOTED_ROUTE.fallback, apiKey: 'sk-system', isGuestMode: true },
        };
        const resolverWithDefaults = {
          ...mockConfigResolver,
          getGlobalDefaultConfig: vi.fn().mockResolvedValue({ model: 'paid/default' }),
          getFreeDefaultConfig: vi.fn().mockResolvedValue({ model: 'free/default' }),
        } as unknown as LlmConfigResolver;
        const injectedRouter = {
          resolveRoute: vi.fn().mockResolvedValue(promotedGuestFallback),
        } as unknown as import('../../../../services/ProviderRouter.js').ProviderRouter;
        vi.mocked(mockApiKeyResolver.resolveUserOpenRouterKey).mockResolvedValue(undefined);
        vi.mocked(mockApiKeyResolver.resolveSystemOpenRouterKey).mockResolvedValue('sk-system');
        step = new AuthStep(mockApiKeyResolver, resolverWithDefaults, injectedRouter, undefined, {
          quotaFallbackCaches: buildDemotionCaches(['glm-5.2']) as never,
        });

        const result = await step.process(makeContext());

        expect(result.config?.effectivePersonality.model).toBe('free/default');
        expect(result.auth?.apiKey).toBe('sk-system');
        expect(result.auth?.isGuestMode).toBe(true);
        expect(result.auth?.quotaFallback?.toModel).toBe('free/default');
      });

      it('leaves a viable promotion untouched (no demotion, rescue route intact)', async () => {
        step = makeStep([]); // nothing doomed

        const result = await step.process(makeContext());

        expect(result.config?.effectivePersonality.model).toBe('glm-5.2');
        expect(result.auth?.wasAutoPromoted).toBe(true);
        expect(result.auth?.fallback).toEqual(PROMOTED_ROUTE.fallback);
        expect(result.auth?.quotaFallback).toBeUndefined();
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

    it('should still probe audio providers in chat guest mode, admitting none that resolve guest', async () => {
      // One guest-mode result per probed provider, each carrying its own
      // provider id — AuthStep never reads result.provider, but the fixtures
      // should still describe the calls they answer.
      const guestResultFor = (provider: AIProvider): ApiKeyResolutionResult => ({
        apiKey: 'system-key',
        provider,
        source: 'system',
        isGuestMode: true,
      });

      vi.mocked(mockApiKeyResolver.resolveApiKey)
        .mockResolvedValueOnce(guestResultFor(AIProvider.OpenRouter))
        .mockResolvedValueOnce(guestResultFor(AIProvider.ElevenLabs))
        .mockResolvedValueOnce(guestResultFor(AIProvider.Mistral));
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
      // Chat guest mode does not short-circuit the audio probe — every provider
      // is asked (OpenRouter + ElevenLabs + Mistral), and it is each provider's
      // OWN guest-mode result that keeps it out of the map.
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledTimes(3);
    });

    it('should resolve a BYOK audio key for a user who is a chat guest', async () => {
      // The decoupling pin: chat guest mode is an OpenRouter/LLM verdict. A user
      // whose only key is ElevenLabs is a chat guest AND a BYOK audio customer.
      const openRouterGuest: ApiKeyResolutionResult = {
        apiKey: 'system-key',
        provider: AIProvider.OpenRouter,
        source: 'system',
        isGuestMode: true,
      };

      const elevenLabsByok: ApiKeyResolutionResult = {
        apiKey: 'sk_el_guest_byok',
        provider: AIProvider.ElevenLabs,
        source: 'user',
        isGuestMode: false,
      };

      // A no-key Mistral lookup THROWS in the real resolver (no system
      // fallback exists for Mistral) — the fixture goes through that path
      // rather than a synthetic resolved result the resolver never produces.
      vi.mocked(mockApiKeyResolver.resolveApiKey)
        .mockResolvedValueOnce(openRouterGuest)
        .mockResolvedValueOnce(elevenLabsByok)
        .mockRejectedValueOnce(
          new NoApiKeyAvailableError('No API key available for provider mistral.')
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
      expect(result.auth?.audioProviderKeys?.get('elevenlabs')).toBe('sk_el_guest_byok');
      expect(result.auth?.audioProviderKeys?.has('mistral')).toBe(false);
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledWith(
        'user-456',
        AIProvider.ElevenLabs
      );
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

    it('should log no-key audio fallbacks at debug, without a stack', async () => {
      const openRouterResult: ApiKeyResolutionResult = {
        apiKey: 'sk-or-test',
        provider: AIProvider.OpenRouter,
        source: 'user',
        isGuestMode: false,
      };

      // A non-BYOK user hits this on EVERY job: both audio providers are
      // BYOK-only with no system key, so resolution throws by design and the
      // dispatcher falls back to voice-engine.
      vi.mocked(mockApiKeyResolver.resolveApiKey)
        .mockResolvedValueOnce(openRouterResult)
        .mockRejectedValueOnce(
          new NoApiKeyAvailableError('No API key available for provider elevenlabs.')
        )
        .mockRejectedValueOnce(
          new NoApiKeyAvailableError('No API key available for provider mistral.')
        );

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

      expect(result.auth?.audioProviderKeys?.size).toBe(0);
      expect(loggerMock.warn).not.toHaveBeenCalled();

      const debugFields = loggerMock.debug.mock.calls
        .filter(call => String(call[1]).includes('key resolution failed'))
        .map(call => call[0] as Record<string, unknown>);

      expect(debugFields).toHaveLength(2);
      expect(debugFields).toContainEqual({ userId: 'user-456', provider: 'elevenlabs' });
      expect(debugFields).toContainEqual({ userId: 'user-456', provider: 'mistral' });
      for (const fields of debugFields) {
        // The whole point of the compact form: no serialized stack trace.
        expect(fields).not.toHaveProperty('err');
      }
    });

    it('should keep the warn + stack for an unexpected audio-key failure', async () => {
      const openRouterResult: ApiKeyResolutionResult = {
        apiKey: 'sk-or-test',
        provider: AIProvider.OpenRouter,
        source: 'user',
        isGuestMode: false,
      };

      const mistralNotConfigured: ApiKeyResolutionResult = {
        apiKey: '',
        provider: AIProvider.Mistral,
        source: 'system',
        isGuestMode: true,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey)
        .mockResolvedValueOnce(openRouterResult)
        .mockRejectedValueOnce(new Error('db connection refused'))
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

      await step.process(context);

      const warnCalls = loggerMock.warn.mock.calls.filter(call =>
        String(call[1]).includes('ElevenLabs key resolution failed')
      );
      expect(warnCalls).toHaveLength(1);

      const fields = warnCalls[0]?.[0] as { userId?: string; err?: Error };
      expect(fields.userId).toBe('user-456');
      expect(fields.err).toBeInstanceOf(Error);
      expect(fields.err?.message).toBe('db connection refused');
    });

    it('should start both audio lookups before either resolves', async () => {
      // The concurrency pin proper: a revert to sequential awaiting would pass
      // every outcome-shaped test (same map, same logs), so this one observes
      // the call pattern instead — with the first audio lookup parked on an
      // unresolved promise, the second lookup must already have been issued.
      const openRouterResult: ApiKeyResolutionResult = {
        apiKey: 'sk-or-test',
        provider: AIProvider.OpenRouter,
        source: 'user',
        isGuestMode: false,
      };
      let releaseElevenLabs!: (value: ApiKeyResolutionResult) => void;
      const parkedElevenLabs = new Promise<ApiKeyResolutionResult>(resolve => {
        releaseElevenLabs = resolve;
      });
      const mistralByok: ApiKeyResolutionResult = {
        apiKey: 'sk-mistral-byok',
        provider: AIProvider.Mistral,
        source: 'user',
        isGuestMode: false,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey)
        .mockResolvedValueOnce(openRouterResult)
        .mockReturnValueOnce(parkedElevenLabs)
        .mockResolvedValueOnce(mistralByok);

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

      const processPromise = step.process(context);

      // Drain microtasks until process() has issued all three lookups (bounded
      // so a regression cannot hang the test). The ElevenLabs promise is still
      // parked, so under a sequential loop the Mistral call can never be issued
      // and the drain exhausts with only two calls recorded.
      for (
        let i = 0;
        i < 50 && vi.mocked(mockApiKeyResolver.resolveApiKey).mock.calls.length < 3;
        i++
      ) {
        await Promise.resolve();
      }
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledTimes(3);
      expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledWith('user-456', AIProvider.Mistral);

      releaseElevenLabs({
        apiKey: 'sk-el-byok',
        provider: AIProvider.ElevenLabs,
        source: 'user',
        isGuestMode: false,
      });

      const result = await processPromise;
      expect(result.auth?.audioProviderKeys?.get('elevenlabs')).toBe('sk-el-byok');
      expect(result.auth?.audioProviderKeys?.get('mistral')).toBe('sk-mistral-byok');
    });

    it('should isolate per-provider failures when both audio lookups reject', async () => {
      // The isolation pin: each concurrent lookup must own its rejection. A
      // naive Promise.all over bare lookups would let the first rejection
      // abort the whole resolution (and leave the second one unhandled) —
      // here each provider still gets its own log at its own level.
      const openRouterResult: ApiKeyResolutionResult = {
        apiKey: 'sk-or-test',
        provider: AIProvider.OpenRouter,
        source: 'user',
        isGuestMode: false,
      };

      vi.mocked(mockApiKeyResolver.resolveApiKey)
        .mockResolvedValueOnce(openRouterResult)
        .mockRejectedValueOnce(
          new NoApiKeyAvailableError('No API key available for provider elevenlabs.')
        )
        .mockRejectedValueOnce(new Error('db down'));

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

      expect(result.auth?.audioProviderKeys?.size).toBe(0);

      const debugCalls = loggerMock.debug.mock.calls.filter(call =>
        String(call[1]).includes('ElevenLabs key resolution failed')
      );
      expect(debugCalls).toHaveLength(1);
      expect(debugCalls[0]?.[0]).toEqual({ userId: 'user-456', provider: 'elevenlabs' });

      const warnCalls = loggerMock.warn.mock.calls.filter(call =>
        String(call[1]).includes('Mistral key resolution failed')
      );
      expect(warnCalls).toHaveLength(1);
      const warnFields = warnCalls[0]?.[0] as { userId?: string; err?: Error };
      expect(warnFields.userId).toBe('user-456');
      expect(warnFields.err).toBeInstanceOf(Error);
      expect(warnFields.err?.message).toBe('db down');
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

  describe('z.ai free-tier upgrade (guest piggyback)', () => {
    const GUEST_KEY_RESULT: ApiKeyResolutionResult = {
      apiKey: 'system-openrouter-key',
      provider: AIProvider.OpenRouter,
      source: 'system',
      isGuestMode: true,
    };

    function admissionStub(admitted: boolean): ZaiFreeTierAdmission {
      return {
        admit: vi.fn().mockResolvedValue({ admitted, reason: admitted ? 'ok' : 'quota' }),
        systemKey: vi.fn().mockReturnValue(admitted ? 'sk-coding-plan' : undefined),
        isEnabled: vi.fn().mockReturnValue(true),
      } as unknown as ZaiFreeTierAdmission;
    }

    function guestContext(): GenerationContext {
      return {
        job: createMockJob(),
        startTime: Date.now(),
        config: { effectivePersonality: TEST_PERSONALITY, configSource: 'personality' },
      };
    }

    beforeEach(() => {
      vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue(GUEST_KEY_RESULT);
      // The owner's free default IS the piggyback preset (z-ai/glm-4.7 on OpenRouter).
      vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue({
        model: 'z-ai/glm-4.7',
        provider: 'openrouter',
      } as never);
    });

    it('admitted guest crosses into ModelFactory as BARE glm-4.7 on zai-coding with the plan key', async () => {
      const admission = admissionStub(true);
      step = new AuthStep(mockApiKeyResolver, mockConfigResolver, undefined, undefined, {
        zaiFreeTierAdmission: admission,
      });

      const result = await step.process(guestContext());

      // The seam that matters: model/provider/key exactly as buildZaiCodingModel needs them.
      expect(result.config?.effectivePersonality.model).toBe(ZAI_FREE_TIER_MODEL);
      expect(result.config?.effectivePersonality.provider).toBe(AIProvider.ZaiCoding);
      expect(result.auth?.apiKey).toBe('sk-coding-plan');
      expect(result.auth?.provider).toBe(AIProvider.ZaiCoding);
      expect(result.auth?.isGuestMode).toBe(true);
      // requestId is the retry-stable idempotency member the allocator counts by.
      expect(vi.mocked(admission.admit)).toHaveBeenCalledWith('user-456', 'test-req-001');
    });

    it('denied guest degrades SILENTLY to the dynamic free router on the OpenRouter system key', async () => {
      step = new AuthStep(mockApiKeyResolver, mockConfigResolver, undefined, undefined, {
        zaiFreeTierAdmission: admissionStub(false),
      });

      const result = await step.process(guestContext());

      expect(result.config?.effectivePersonality.model).toBe(FREE_ROUTER_MODEL);
      expect(result.auth?.apiKey).toBe('system-openrouter-key');
      expect(result.auth?.provider).toBe(AIProvider.OpenRouter);
    });

    it('without an admission service the piggyback free-default degrades to the router (ships dark)', async () => {
      step = new AuthStep(mockApiKeyResolver, mockConfigResolver);

      const result = await step.process(guestContext());

      expect(result.config?.effectivePersonality.model).toBe(FREE_ROUTER_MODEL);
      expect(result.auth?.provider).toBe(AIProvider.OpenRouter);
    });

    it('a misconfigured PAID (non-eligible) free default never reaches the system OpenRouter key', async () => {
      vi.mocked(mockConfigResolver.getFreeDefaultConfig).mockResolvedValue({
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
      } as never);
      step = new AuthStep(mockApiKeyResolver, mockConfigResolver, undefined, undefined, {
        zaiFreeTierAdmission: admissionStub(true),
      });

      const result = await step.process(guestContext());

      expect(result.config?.effectivePersonality.model).toBe(FREE_ROUTER_MODEL);
    });
  });
});
