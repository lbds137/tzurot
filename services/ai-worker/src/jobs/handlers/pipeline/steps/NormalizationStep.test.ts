/**
 * NormalizationStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { NormalizationStep } from './NormalizationStep.js';
import type { GenerationContext } from '../types.js';

// Mock only the logger from common-types
// We need to use vi.hoisted to ensure the mock is defined before vi.mock
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
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

function createMockJob(overrides: Partial<LLMGenerationJobData> = {}): Job<LLMGenerationJobData> {
  const baseData = createValidJobData();
  return {
    id: 'job-123',
    data: {
      ...baseData,
      ...overrides,
      context: {
        ...baseData.context,
        ...(overrides.context ?? {}),
      },
    } as LLMGenerationJobData,
  } as Job<LLMGenerationJobData>;
}

function refMessage(overrides: Partial<ReferencedMessage> = {}): ReferencedMessage {
  return {
    referenceNumber: 1,
    discordMessageId: 'msg-123',
    discordUserId: 'user-789',
    authorUsername: 'Alice',
    authorDisplayName: 'Alice Smith',
    content: 'Referenced content',
    embeds: '',
    timestamp: '2024-01-15T10:30:00.000Z',
    locationContext: '#general',
    ...overrides,
  };
}

describe('NormalizationStep', () => {
  let step: NormalizationStep;

  beforeEach(() => {
    vi.clearAllMocks();
    step = new NormalizationStep();
  });

  it('should have correct name', () => {
    expect(step.name).toBe('Normalization');
  });

  describe('referenced message timestamp normalization', () => {
    it('converts a Date object that bypassed serialization to an ISO string', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const job = createMockJob({
        context: {
          userId: 'user-456',
          referencedMessages: [refMessage({ timestamp: date as unknown as string })],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };
      step.process(context);

      const refs = job.data.context.referencedMessages!;
      expect(refs[0].timestamp).toBe('2024-01-15T10:30:00.000Z');
    });

    it('leaves an ISO string timestamp unchanged', () => {
      const isoString = '2024-01-15T10:30:00.000Z';
      const job = createMockJob({
        context: {
          userId: 'user-456',
          referencedMessages: [refMessage({ timestamp: isoString })],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };
      step.process(context);

      const refs = job.data.context.referencedMessages!;
      expect(refs[0].timestamp).toBe(isoString);
    });
  });

  describe('empty data handling', () => {
    it('handles an empty referencedMessages array', () => {
      const job = createMockJob({
        context: { userId: 'user-456', referencedMessages: [] },
      });
      const context: GenerationContext = { job, startTime: Date.now() };

      expect(() => step.process(context)).not.toThrow();
    });

    it('handles undefined referencedMessages', () => {
      const job = createMockJob({
        context: { userId: 'user-456', referencedMessages: undefined },
      });
      const context: GenerationContext = { job, startTime: Date.now() };

      expect(() => step.process(context)).not.toThrow();
    });
  });

  describe('context return', () => {
    it('should return the same context reference', () => {
      const job = createMockJob();
      const context: GenerationContext = { job, startTime: Date.now() };

      const result = step.process(context);

      expect(result).toBe(context);
    });
  });
});
