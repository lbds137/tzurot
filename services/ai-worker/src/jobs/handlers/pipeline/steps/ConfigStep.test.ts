/**
 * ConfigStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType, type LLMGenerationJobData, type LoadedPersonality } from '@tzurot/common-types';
import { ConfigStep } from './ConfigStep.js';
import type { GenerationContext } from '../types.js';
import type { LlmConfigResolver, ConfigCascadeResolver } from '@tzurot/common-types';

// Mock common-types logger
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
  };
});

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-123',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  systemPrompt: 'You are a helpful assistant.',
  model: 'anthropic/claude-sonnet-4',
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

function createMockConfigResolver(): LlmConfigResolver {
  return {
    resolveConfig: vi.fn(),
    getUserPersonalityConfig: vi.fn(),
    getUserDefaultConfig: vi.fn(),
    getFreeDefaultConfig: vi.fn(),
    invalidateUserCache: vi.fn(),
    clearCache: vi.fn(),
  } as unknown as LlmConfigResolver;
}

describe('ConfigStep', () => {
  let step: ConfigStep;
  let mockConfigResolver: LlmConfigResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigResolver = createMockConfigResolver();
  });

  it('should have correct name', () => {
    step = new ConfigStep();
    expect(step.name).toBe('ConfigResolution');
  });

  describe('process', () => {
    it('should use personality defaults when no config resolver', async () => {
      step = new ConfigStep(); // No resolver

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config).toBeDefined();
      expect(result.config?.configSource).toBe('personality');
      expect(result.config?.effectivePersonality).toEqual(TEST_PERSONALITY);
    });

    it('should use personality defaults when resolver returns personality source', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockResolvedValue({
        source: 'personality',
        config: { model: TEST_PERSONALITY.model },
      });

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.configSource).toBe('personality');
      expect(result.config?.effectivePersonality.model).toBe(TEST_PERSONALITY.model);
    });

    it('should apply user-personality config overrides', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockResolvedValue({
        source: 'user-personality',
        configName: 'My Config',
        config: {
          model: 'openai/gpt-4o',
          temperature: 0.9,
          maxTokens: 4000,
        },
      });

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.configSource).toBe('user-personality');
      expect(result.config?.effectivePersonality.model).toBe('openai/gpt-4o');
      expect(result.config?.effectivePersonality.temperature).toBe(0.9);
      expect(result.config?.effectivePersonality.maxTokens).toBe(4000);
      // Other fields should remain from personality
      expect(result.config?.effectivePersonality.systemPrompt).toBe(TEST_PERSONALITY.systemPrompt);
    });

    it('should apply user-default config overrides', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockResolvedValue({
        source: 'user-default',
        configName: 'Default Config',
        config: {
          model: 'google/gemini-2.0-flash',
          topP: 0.95,
        },
      });

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.configSource).toBe('user-default');
      expect(result.config?.effectivePersonality.model).toBe('google/gemini-2.0-flash');
      expect(result.config?.effectivePersonality.topP).toBe(0.95);
    });

    it('should handle config resolver error gracefully', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockRejectedValue(
        new Error('Database connection failed')
      );

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Should fall back to personality defaults
      expect(result.config?.configSource).toBe('personality');
      expect(result.config?.effectivePersonality).toEqual(TEST_PERSONALITY);
    });

    it('should preserve personality fields not overridden by config', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockResolvedValue({
        source: 'user-personality',
        config: {
          model: 'openai/gpt-4o',
          // Only overriding model, not temperature
        },
      });

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.effectivePersonality.model).toBe('openai/gpt-4o');
      // Temperature should be from personality since not in config
      expect(result.config?.effectivePersonality.temperature).toBe(TEST_PERSONALITY.temperature);
    });

    it('should apply visionModel override', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockResolvedValue({
        source: 'user-personality',
        config: {
          model: 'openai/gpt-4o',
          visionModel: 'openai/gpt-4o-vision',
        },
      });

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.effectivePersonality.visionModel).toBe('openai/gpt-4o-vision');
    });

    it('should apply reasoning config for thinking models', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockResolvedValue({
        source: 'user-personality',
        configName: 'R1 Config',
        config: {
          model: 'deepseek/deepseek-r1',
          reasoning: {
            effort: 'high',
            enabled: true,
          },
          showThinking: true,
        },
      });

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.effectivePersonality.model).toBe('deepseek/deepseek-r1');
      expect(result.config?.effectivePersonality.reasoning).toEqual({
        effort: 'high',
        enabled: true,
      });
      expect(result.config?.effectivePersonality.showThinking).toBe(true);
    });

    it('should apply advanced sampling params', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockResolvedValue({
        source: 'user-personality',
        configName: 'Advanced Config',
        config: {
          model: 'openai/gpt-4o',
          minP: 0.1,
          topA: 0.5,
          seed: 42,
        },
      });

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.effectivePersonality.minP).toBe(0.1);
      expect(result.config?.effectivePersonality.topA).toBe(0.5);
      expect(result.config?.effectivePersonality.seed).toBe(42);
    });

    it('should apply OpenRouter-specific params', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockResolvedValue({
        source: 'user-personality',
        configName: 'OpenRouter Config',
        config: {
          model: 'openai/gpt-4o',
          transforms: ['middle-out'],
          route: 'fallback',
          verbosity: 'high',
        },
      });

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.effectivePersonality.transforms).toEqual(['middle-out']);
      expect(result.config?.effectivePersonality.route).toBe('fallback');
      expect(result.config?.effectivePersonality.verbosity).toBe('high');
    });

    it('should apply output control params', async () => {
      vi.mocked(mockConfigResolver.resolveConfig).mockResolvedValue({
        source: 'user-personality',
        configName: 'Output Config',
        config: {
          model: 'openai/gpt-4o',
          stop: ['###', '---'],
          logitBias: { '123': -100 },
          responseFormat: { type: 'json_object' },
        },
      });

      step = new ConfigStep(mockConfigResolver);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.effectivePersonality.stop).toEqual(['###', '---']);
      expect(result.config?.effectivePersonality.logitBias).toEqual({ '123': -100 });
      expect(result.config?.effectivePersonality.responseFormat).toEqual({ type: 'json_object' });
    });

    describe('cascadeResolver', () => {
      function createMockCascadeResolver(): ConfigCascadeResolver {
        return {
          resolveOverrides: vi.fn(),
          invalidateUserCache: vi.fn(),
          invalidatePersonalityCache: vi.fn(),
          clearCache: vi.fn(),
          stopCleanup: vi.fn(),
        } as unknown as ConfigCascadeResolver;
      }

      it('should set configOverrides when cascadeResolver is present', async () => {
        const mockCascade = createMockCascadeResolver();
        const mockOverrides = {
          maxMessages: 50,
          maxAge: null,
          maxImages: 10,
          memoryScoreThreshold: 0.5,
          memoryLimit: 20,
          focusModeEnabled: false,
          sources: {
            maxMessages: 'hardcoded' as const,
            maxAge: 'hardcoded' as const,
            maxImages: 'hardcoded' as const,
            memoryScoreThreshold: 'hardcoded' as const,
            memoryLimit: 'hardcoded' as const,
            focusModeEnabled: 'hardcoded' as const,
          },
        };
        vi.mocked(mockCascade.resolveOverrides).mockResolvedValue(mockOverrides);

        step = new ConfigStep(undefined, mockCascade);

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
        };

        const result = await step.process(context);

        expect(result.configOverrides).toEqual(mockOverrides);
        expect(mockCascade.resolveOverrides).toHaveBeenCalledWith('user-456', 'personality-123');
      });

      it('should not set configOverrides when cascadeResolver is absent', async () => {
        step = new ConfigStep();

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
        };

        const result = await step.process(context);

        expect(result.configOverrides).toBeUndefined();
      });

      it('should handle cascadeResolver error gracefully', async () => {
        const mockCascade = createMockCascadeResolver();
        vi.mocked(mockCascade.resolveOverrides).mockRejectedValue(new Error('DB error'));

        step = new ConfigStep(undefined, mockCascade);

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
        };

        const result = await step.process(context);

        // Should continue without configOverrides
        expect(result.configOverrides).toBeUndefined();
        // Config should still be set
        expect(result.config).toBeDefined();
      });
    });
  });
});
