/**
 * AuthStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  JobType,
  AIProvider,
  GUEST_MODE,
  type LLMGenerationJobData,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { AuthStep } from './AuthStep.js';
import type { GenerationContext, ResolvedConfig } from '../types.js';
import type {
  ApiKeyResolver,
  ApiKeyResolutionResult,
} from '../../../../services/ApiKeyResolver.js';
import type { LlmConfigResolver } from '@tzurot/common-types';

// Mock common-types logger and isFreeModel
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    isFreeModel: vi.fn((model: string) => model.includes('free') || model.includes('gemma')),
  };
});

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-123',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  systemPrompt: 'You are a helpful assistant.',
  model: 'anthropic/claude-sonnet-4', // Paid model
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'A helpful test personality',
  personalityTraits: 'Helpful, friendly',
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
    invalidateUserCache: vi.fn(),
    clearCache: vi.fn(),
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
