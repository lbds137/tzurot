/**
 * ConfigStep Unit Tests
 *
 * ConfigStep no longer runs the LLM model cascade — the gateway resolves and
 * stamps the effective model/visionModel onto the personality at job-chain build
 * (see jobChainOrchestrator). ConfigStep now passes that stamped personality
 * through unchanged, reads the stamped `configSource` diagnostic, and owns only
 * the config-OVERRIDES cascade (ConfigCascadeResolver).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { ConfigStep } from './ConfigStep.js';
import type { GenerationContext } from '../types.js';
import type { ConfigCascadeResolver } from '@tzurot/config-resolver';

// Mock common-types logger
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
  model: 'anthropic/claude-sonnet-4',
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

describe('ConfigStep', () => {
  let step: ConfigStep;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct name', () => {
    step = new ConfigStep();
    expect(step.name).toBe('ConfigResolution');
  });

  describe('process (model resolution moved to gateway)', () => {
    it('passes the stamped personality through unchanged', async () => {
      step = new ConfigStep();

      const context: GenerationContext = {
        job: createMockJob({ personality: { ...TEST_PERSONALITY, model: 'z-ai/glm-5.2' } }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // ConfigStep does NOT re-resolve — it uses whatever model the gateway stamped.
      expect(result.config?.effectivePersonality.model).toBe('z-ai/glm-5.2');
    });

    it('reads the stamped configSource from the job payload', async () => {
      step = new ConfigStep();

      const context: GenerationContext = {
        job: createMockJob({ configSource: 'user-default' }),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.configSource).toBe('user-default');
      expect(result.config?.effectivePersonality).toEqual(TEST_PERSONALITY);
    });

    it('defaults configSource to personality when the job carries none', async () => {
      step = new ConfigStep();

      const context: GenerationContext = {
        job: createMockJob(), // no configSource
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.config?.configSource).toBe('personality');
      expect(result.config?.effectivePersonality).toEqual(TEST_PERSONALITY);
    });
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
        crossChannelHistoryEnabled: false,
        shareLtmAcrossPersonalities: false,
        showModelFooter: true,
        voiceResponseMode: 'always' as const,
        voiceTranscriptionEnabled: true,
        sources: {
          maxMessages: 'hardcoded' as const,
          maxAge: 'hardcoded' as const,
          maxImages: 'hardcoded' as const,
          memoryScoreThreshold: 'hardcoded' as const,
          memoryLimit: 'hardcoded' as const,
          focusModeEnabled: 'hardcoded' as const,
          crossChannelHistoryEnabled: 'hardcoded' as const,
          shareLtmAcrossPersonalities: 'hardcoded' as const,
          showModelFooter: 'hardcoded' as const,
          voiceResponseMode: 'hardcoded' as const,
          voiceTranscriptionEnabled: 'hardcoded' as const,
        },
      };
      vi.mocked(mockCascade.resolveOverrides).mockResolvedValue(mockOverrides);

      step = new ConfigStep(mockCascade);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      expect(result.configOverrides).toEqual(mockOverrides);
      expect(mockCascade.resolveOverrides).toHaveBeenCalledWith(
        'user-456',
        'personality-123',
        'channel-789'
      );
    });

    it('should fall back to hardcoded defaults when cascadeResolver is absent', async () => {
      step = new ConfigStep();

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Should have hardcoded defaults, not undefined
      expect(result.configOverrides).toBeDefined();
      expect(result.configOverrides?.maxMessages).toBe(50);
      expect(result.configOverrides?.sources.maxMessages).toBe('hardcoded');
    });

    it('should fall back to hardcoded defaults when cascadeResolver throws', async () => {
      const mockCascade = createMockCascadeResolver();
      vi.mocked(mockCascade.resolveOverrides).mockRejectedValue(new Error('DB error'));

      step = new ConfigStep(mockCascade);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = await step.process(context);

      // Should have hardcoded defaults, not undefined
      expect(result.configOverrides).toBeDefined();
      expect(result.configOverrides?.maxMessages).toBe(50);
      expect(result.configOverrides?.sources.maxMessages).toBe('hardcoded');
      // Config should still be set
      expect(result.config).toBeDefined();
    });
  });
});
