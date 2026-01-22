/**
 * NormalizationStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  JobType,
  MessageRole,
  type LLMGenerationJobData,
  type LoadedPersonality,
} from '@tzurot/common-types';
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

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

describe('NormalizationStep', () => {
  let step: NormalizationStep;

  beforeEach(() => {
    vi.clearAllMocks();
    step = new NormalizationStep();
  });

  it('should have correct name', () => {
    expect(step.name).toBe('Normalization');
  });

  describe('role normalization', () => {
    it('should normalize capitalized roles to lowercase', () => {
      const job = createMockJob({
        context: {
          userId: 'user-456',
          conversationHistory: [
            { role: 'User' as unknown as MessageRole, content: 'Hello' },
            { role: 'Assistant' as unknown as MessageRole, content: 'Hi!' },
            { role: 'System' as unknown as MessageRole, content: 'System message' },
          ],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };
      step.process(context);

      // Check that roles were normalized in place
      const history = job.data.context.conversationHistory!;
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
      expect(history[2].role).toBe('system');
    });

    it('should leave already-lowercase roles unchanged', () => {
      const job = createMockJob({
        context: {
          userId: 'user-456',
          conversationHistory: [
            { role: MessageRole.User, content: 'Hello' },
            { role: MessageRole.Assistant, content: 'Hi!' },
          ],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };
      step.process(context);

      const history = job.data.context.conversationHistory!;
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
    });

    it('should handle mixed case roles', () => {
      const job = createMockJob({
        context: {
          userId: 'user-456',
          conversationHistory: [
            { role: 'USER' as unknown as MessageRole, content: 'Loud user' },
            { role: 'AsSiStAnT' as unknown as MessageRole, content: 'Weird assistant' },
          ],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };
      step.process(context);

      const history = job.data.context.conversationHistory!;
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
    });

    it('should log warning for invalid roles but not throw', () => {
      const job = createMockJob({
        context: {
          userId: 'user-456',
          conversationHistory: [
            { role: 'invalid-role' as unknown as MessageRole, content: 'Bad message' },
          ],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };

      // Should not throw - logs warning and leaves role as-is
      expect(() => step.process(context)).not.toThrow();

      // Role should be unchanged (couldn't normalize it)
      const history = job.data.context.conversationHistory!;
      expect(history[0].role).toBe('invalid-role');
    });
  });

  describe('timestamp normalization', () => {
    it('should convert Date objects to ISO strings', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const job = createMockJob({
        context: {
          userId: 'user-456',
          conversationHistory: [
            {
              role: MessageRole.User,
              content: 'Hello',
              createdAt: date as unknown as string, // Simulating Date that bypassed serialization
            },
          ],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };
      step.process(context);

      const history = job.data.context.conversationHistory!;
      expect(history[0].createdAt).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should leave ISO string timestamps unchanged', () => {
      const isoString = '2024-01-15T10:30:00.000Z';
      const job = createMockJob({
        context: {
          userId: 'user-456',
          conversationHistory: [{ role: MessageRole.User, content: 'Hello', createdAt: isoString }],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };
      step.process(context);

      const history = job.data.context.conversationHistory!;
      expect(history[0].createdAt).toBe(isoString);
    });

    it('should handle undefined timestamps', () => {
      const job = createMockJob({
        context: {
          userId: 'user-456',
          conversationHistory: [
            { role: MessageRole.User, content: 'Hello' }, // No createdAt
          ],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };
      step.process(context);

      const history = job.data.context.conversationHistory!;
      expect(history[0].createdAt).toBeUndefined();
    });
  });

  describe('referenced messages normalization', () => {
    it('should normalize timestamps in referenced messages', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const job = createMockJob({
        context: {
          userId: 'user-456',
          referencedMessages: [
            {
              referenceNumber: 1,
              discordMessageId: 'msg-123',
              discordUserId: 'user-789',
              authorUsername: 'Alice',
              authorDisplayName: 'Alice Smith',
              content: 'Referenced content',
              embeds: '',
              timestamp: date as unknown as string, // Date bypassing serialization
              locationContext: '#general',
            },
          ],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };
      step.process(context);

      const refs = job.data.context.referencedMessages!;
      expect(refs[0].timestamp).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  describe('empty data handling', () => {
    it('should handle empty conversation history', () => {
      const job = createMockJob({
        context: {
          userId: 'user-456',
          conversationHistory: [],
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };

      // Should not throw
      expect(() => step.process(context)).not.toThrow();
    });

    it('should handle undefined conversation history', () => {
      const job = createMockJob({
        context: {
          userId: 'user-456',
          conversationHistory: undefined,
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };

      // Should not throw
      expect(() => step.process(context)).not.toThrow();
    });

    it('should handle undefined referenced messages', () => {
      const job = createMockJob({
        context: {
          userId: 'user-456',
          referencedMessages: undefined,
        },
      });

      const context: GenerationContext = { job, startTime: Date.now() };

      // Should not throw
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
