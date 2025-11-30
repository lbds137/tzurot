/**
 * ValidationStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType, type LLMGenerationJobData, type LoadedPersonality } from '@tzurot/common-types';
import { ValidationStep } from './ValidationStep.js';
import type { GenerationContext } from '../types.js';

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

// Create mock job with raw data (no merging with valid defaults)
function createMockJobRaw(data: unknown): Job<LLMGenerationJobData> {
  return {
    id: 'job-123',
    data: data as LLMGenerationJobData,
  } as Job<LLMGenerationJobData>;
}

describe('ValidationStep', () => {
  let step: ValidationStep;

  beforeEach(() => {
    vi.clearAllMocks();
    step = new ValidationStep();
  });

  it('should have correct name', () => {
    expect(step.name).toBe('Validation');
  });

  describe('process', () => {
    it('should pass validation with valid job data', () => {
      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = step.process(context);

      expect(result).toBe(context);
    });

    it('should throw error when requestId is missing', () => {
      const jobData = createValidJobData();
      const { requestId: _removed, ...dataWithoutRequestId } = jobData;

      const context: GenerationContext = {
        job: createMockJobRaw(dataWithoutRequestId),
        startTime: Date.now(),
      };

      expect(() => step.process(context)).toThrow(/validation failed/);
    });

    it('should throw error when personality is missing', () => {
      const jobData = createValidJobData();
      const { personality: _removed, ...dataWithoutPersonality } = jobData;

      const context: GenerationContext = {
        job: createMockJobRaw(dataWithoutPersonality),
        startTime: Date.now(),
      };

      expect(() => step.process(context)).toThrow(/validation failed/);
    });

    it('should throw error when personality.name is missing', () => {
      const jobData = createValidJobData();
      const { name: _removed, ...personalityWithoutName } = jobData.personality;
      const invalidJobData = { ...jobData, personality: personalityWithoutName };

      const context: GenerationContext = {
        job: createMockJobRaw(invalidJobData),
        startTime: Date.now(),
      };

      expect(() => step.process(context)).toThrow(/validation failed/);
    });

    it('should throw error when message is missing', () => {
      const jobData = createValidJobData();
      const { message: _removed, ...dataWithoutMessage } = jobData;

      const context: GenerationContext = {
        job: createMockJobRaw(dataWithoutMessage),
        startTime: Date.now(),
      };

      expect(() => step.process(context)).toThrow(/validation failed/);
    });

    it('should throw error when context.userId is missing', () => {
      const jobData = createValidJobData();
      const { userId: _removed, ...contextWithoutUserId } = jobData.context;
      const invalidJobData = { ...jobData, context: contextWithoutUserId };

      const context: GenerationContext = {
        job: createMockJobRaw(invalidJobData),
        startTime: Date.now(),
      };

      expect(() => step.process(context)).toThrow(/validation failed/);
    });

    it('should throw error when responseDestination is missing', () => {
      const jobData = createValidJobData();
      const { responseDestination: _removed, ...dataWithoutResponseDestination } = jobData;

      const context: GenerationContext = {
        job: createMockJobRaw(dataWithoutResponseDestination),
        startTime: Date.now(),
      };

      expect(() => step.process(context)).toThrow(/validation failed/);
    });

    it('should return same context reference on success', () => {
      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
      };

      const result = step.process(context);

      expect(result).toBe(context);
    });
  });
});
