/**
 * ContextStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  JobType,
  MessageRole,
  type LLMGenerationJobData,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { ContextStep } from './ContextStep.js';
import type { GenerationContext, ResolvedConfig } from '../types.js';

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

// Use vi.hoisted to create mock functions before they're used in vi.mock
const { mockExtractParticipants, mockConvertConversationHistory } = vi.hoisted(() => ({
  mockExtractParticipants: vi.fn(),
  mockConvertConversationHistory: vi.fn(),
}));

vi.mock('../../../utils/conversationUtils.js', () => ({
  extractParticipants: mockExtractParticipants,
  convertConversationHistory: mockConvertConversationHistory,
}));

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

function createValidJobData(overrides: Partial<LLMGenerationJobData> = {}): LLMGenerationJobData {
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
    ...overrides,
  };
}

function createMockJob(data: Partial<LLMGenerationJobData> = {}): Job<LLMGenerationJobData> {
  return {
    id: 'job-123',
    data: createValidJobData(data),
  } as Job<LLMGenerationJobData>;
}

describe('ContextStep', () => {
  let step: ContextStep;

  beforeEach(() => {
    vi.clearAllMocks();
    step = new ContextStep();

    // Default mock implementations
    mockExtractParticipants.mockReturnValue([]);
    mockConvertConversationHistory.mockReturnValue([]);
  });

  it('should have correct name', () => {
    expect(step.name).toBe('ContextPreparation');
  });

  describe('process', () => {
    it('should throw error if config is missing', () => {
      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        // No config
      };

      expect(() => step.process(context)).toThrow('ConfigStep must run before ContextStep');
    });

    it('should prepare empty context when no conversation history', () => {
      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob({ context: { userId: 'user-456', conversationHistory: [] } }),
        startTime: Date.now(),
        config,
      };

      const result = step.process(context);

      expect(result.preparedContext).toBeDefined();
      expect(result.preparedContext?.conversationHistory).toEqual([]);
      expect(result.preparedContext?.rawConversationHistory).toEqual([]);
      expect(result.preparedContext?.participants).toEqual([]);
      expect(result.preparedContext?.oldestHistoryTimestamp).toBeUndefined();
    });

    it('should call extractParticipants with conversation history', () => {
      const conversationHistory = [
        { role: MessageRole.User, content: 'Hello', personaId: 'user-1', personaName: 'Alice' },
        {
          role: MessageRole.Assistant,
          content: 'Hi there',
          personaId: 'bot-1',
          personaName: 'TestBot',
        },
      ];

      mockExtractParticipants.mockReturnValue([
        { personaId: 'user-1', personaName: 'Alice', isActive: false },
        { personaId: 'bot-1', personaName: 'TestBot', isActive: true },
      ]);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            conversationHistory,
            activePersonaId: 'bot-1',
            activePersonaName: 'TestBot',
          },
        }),
        startTime: Date.now(),
        config,
      };

      step.process(context);

      expect(mockExtractParticipants).toHaveBeenCalledWith(conversationHistory, 'bot-1', 'TestBot');
    });

    it('should call convertConversationHistory with personality name', () => {
      const conversationHistory = [{ role: MessageRole.User, content: 'Hello' }];

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob({
          context: { userId: 'user-456', conversationHistory },
        }),
        startTime: Date.now(),
        config,
      };

      step.process(context);

      expect(mockConvertConversationHistory).toHaveBeenCalledWith(
        conversationHistory,
        TEST_PERSONALITY.name
      );
    });

    it('should calculate oldest timestamp from conversation history', () => {
      const conversationHistory = [
        { role: MessageRole.User, content: 'First', createdAt: '2024-01-01T12:00:00Z' },
        { role: MessageRole.Assistant, content: 'Second', createdAt: '2024-01-01T12:05:00Z' },
        { role: MessageRole.User, content: 'Third', createdAt: '2024-01-01T12:10:00Z' },
      ];

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob({
          context: { userId: 'user-456', conversationHistory },
        }),
        startTime: Date.now(),
        config,
      };

      const result = step.process(context);

      expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
        new Date('2024-01-01T12:00:00Z').getTime()
      );
    });

    it('should handle messages without timestamps', () => {
      const conversationHistory = [
        { role: MessageRole.User, content: 'First' }, // No createdAt
        { role: MessageRole.Assistant, content: 'Second', createdAt: '2024-01-01T12:05:00Z' },
      ];

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob({
          context: { userId: 'user-456', conversationHistory },
        }),
        startTime: Date.now(),
        config,
      };

      const result = step.process(context);

      // Should only use the message with timestamp
      expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
        new Date('2024-01-01T12:05:00Z').getTime()
      );
    });

    it('should merge mentioned personas into participants', () => {
      mockExtractParticipants.mockReturnValue([
        { personaId: 'user-1', personaName: 'Alice', isActive: false },
      ]);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            mentionedPersonas: [{ personaId: 'bot-2', personaName: 'OtherBot' }],
          },
        }),
        startTime: Date.now(),
        config,
      };

      const result = step.process(context);

      expect(result.preparedContext?.participants).toHaveLength(2);
      expect(result.preparedContext?.participants).toContainEqual({
        personaId: 'bot-2',
        personaName: 'OtherBot',
        isActive: false,
      });
    });

    it('should not duplicate mentioned personas already in participants', () => {
      mockExtractParticipants.mockReturnValue([
        { personaId: 'user-1', personaName: 'Alice', isActive: false },
        { personaId: 'bot-2', personaName: 'OtherBot', isActive: false },
      ]);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob({
          context: {
            userId: 'user-456',
            mentionedPersonas: [
              { personaId: 'bot-2', personaName: 'OtherBot' }, // Already in participants
            ],
          },
        }),
        startTime: Date.now(),
        config,
      };

      const result = step.process(context);

      // Should not duplicate
      expect(result.preparedContext?.participants).toHaveLength(2);
    });

    it('should preserve raw conversation history', () => {
      const conversationHistory = [
        { role: MessageRole.User, content: 'Hello', tokenCount: 5 },
        { role: MessageRole.Assistant, content: 'Hi there', tokenCount: 10 },
      ];

      mockConvertConversationHistory.mockReturnValue([
        new HumanMessage('Hello'),
        new AIMessage('Hi there'),
      ]);

      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob({
          context: { userId: 'user-456', conversationHistory },
        }),
        startTime: Date.now(),
        config,
      };

      const result = step.process(context);

      expect(result.preparedContext?.rawConversationHistory).toEqual(conversationHistory);
      expect(result.preparedContext?.conversationHistory).toHaveLength(2);
    });

    describe('referenced message timestamps in deduplication', () => {
      it('should include referenced message timestamps in oldestHistoryTimestamp', () => {
        // Conversation history with recent messages
        const conversationHistory = [
          { role: MessageRole.User, content: 'Recent message', createdAt: '2024-01-01T14:00:00Z' },
        ];

        // Referenced message is older than conversation history
        const referencedMessages = [
          {
            referenceNumber: 1,
            discordMessageId: 'ref-msg-1',
            discordUserId: 'user-123',
            authorUsername: 'alice',
            authorDisplayName: 'Alice',
            content: 'An old message being referenced',
            embeds: '',
            timestamp: '2024-01-01T10:00:00Z', // Older than conversation history
            locationContext: 'Server/Channel',
          },
        ];

        const config: ResolvedConfig = {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        };

        const context: GenerationContext = {
          job: createMockJob({
            context: { userId: 'user-456', conversationHistory, referencedMessages },
          }),
          startTime: Date.now(),
          config,
        };

        const result = step.process(context);

        // Oldest timestamp should be from the referenced message, not conversation history
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T10:00:00Z').getTime()
        );
      });

      it('should use conversation history timestamp if older than referenced messages', () => {
        const conversationHistory = [
          { role: MessageRole.User, content: 'Old message', createdAt: '2024-01-01T08:00:00Z' },
          { role: MessageRole.Assistant, content: 'Reply', createdAt: '2024-01-01T08:05:00Z' },
        ];

        const referencedMessages = [
          {
            referenceNumber: 1,
            discordMessageId: 'ref-msg-1',
            discordUserId: 'user-123',
            authorUsername: 'bob',
            authorDisplayName: 'Bob',
            content: 'A newer referenced message',
            embeds: '',
            timestamp: '2024-01-01T12:00:00Z', // Newer than conversation history
            locationContext: 'Server/Channel',
          },
        ];

        const config: ResolvedConfig = {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        };

        const context: GenerationContext = {
          job: createMockJob({
            context: { userId: 'user-456', conversationHistory, referencedMessages },
          }),
          startTime: Date.now(),
          config,
        };

        const result = step.process(context);

        // Oldest timestamp should be from conversation history
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T08:00:00Z').getTime()
        );
      });

      it('should handle referenced messages without timestamps', () => {
        const conversationHistory = [
          { role: MessageRole.User, content: 'Message', createdAt: '2024-01-01T12:00:00Z' },
        ];

        const referencedMessages = [
          {
            referenceNumber: 1,
            discordMessageId: 'ref-msg-1',
            discordUserId: 'user-123',
            authorUsername: 'charlie',
            authorDisplayName: 'Charlie',
            content: 'Referenced without timestamp',
            embeds: '',
            timestamp: '', // Empty timestamp
            locationContext: 'Server/Channel',
          },
        ];

        const config: ResolvedConfig = {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        };

        const context: GenerationContext = {
          job: createMockJob({
            context: { userId: 'user-456', conversationHistory, referencedMessages },
          }),
          startTime: Date.now(),
          config,
        };

        const result = step.process(context);

        // Should use conversation history timestamp when referenced message has no timestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T12:00:00Z').getTime()
        );
      });

      it('should handle only referenced messages (no conversation history)', () => {
        const referencedMessages = [
          {
            referenceNumber: 1,
            discordMessageId: 'ref-msg-1',
            discordUserId: 'user-123',
            authorUsername: 'dave',
            authorDisplayName: 'Dave',
            content: 'Only a referenced message',
            embeds: '',
            timestamp: '2024-01-01T15:00:00Z',
            locationContext: 'Server/Channel',
          },
        ];

        const config: ResolvedConfig = {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        };

        const context: GenerationContext = {
          job: createMockJob({
            context: { userId: 'user-456', conversationHistory: [], referencedMessages },
          }),
          startTime: Date.now(),
          config,
        };

        const result = step.process(context);

        // Should use referenced message timestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T15:00:00Z').getTime()
        );
      });

      it('should handle empty referenced messages array gracefully', () => {
        const conversationHistory = [
          { role: MessageRole.User, content: 'Message', createdAt: '2024-01-01T12:00:00Z' },
        ];

        const config: ResolvedConfig = {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        };

        const context: GenerationContext = {
          job: createMockJob({
            context: { userId: 'user-456', conversationHistory, referencedMessages: [] },
          }),
          startTime: Date.now(),
          config,
        };

        const result = step.process(context);

        // Should use conversation history timestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T12:00:00Z').getTime()
        );
      });

      it('should include cross-channel timestamps in oldest calculation', () => {
        const conversationHistory = [
          { role: MessageRole.User, content: 'Current channel', createdAt: '2024-01-15T12:00:00Z' },
        ];

        const crossChannelHistory = [
          {
            channelEnvironment: {
              type: 'guild' as const,
              guild: { id: 'g-1', name: 'Server' },
              channel: { id: 'ch-other', name: 'general', type: 'text' },
            },
            messages: [
              {
                id: 'msg-1',
                role: MessageRole.User,
                content: 'Older cross-channel msg',
                createdAt: '2024-01-01T08:00:00Z',
              },
            ],
          },
        ];

        const config: ResolvedConfig = {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        };

        const context: GenerationContext = {
          job: createMockJob({
            context: { userId: 'user-456', conversationHistory, crossChannelHistory },
          }),
          startTime: Date.now(),
          config,
        };

        const result = step.process(context);

        // Should use the older cross-channel timestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T08:00:00Z').getTime()
        );
      });

      it('should set oldestHistoryTimestamp from cross-channel alone when no current history', () => {
        const crossChannelHistory = [
          {
            channelEnvironment: {
              type: 'guild' as const,
              guild: { id: 'g-1', name: 'Server' },
              channel: { id: 'ch-other', name: 'general', type: 'text' },
            },
            messages: [
              {
                id: 'msg-cross-1',
                role: MessageRole.User,
                content: 'Old cross-channel message',
                createdAt: '2024-01-05T08:00:00Z',
              },
              {
                id: 'msg-cross-2',
                role: MessageRole.Assistant,
                content: 'Response',
                createdAt: '2024-01-10T12:00:00Z',
              },
            ],
          },
        ];

        const config: ResolvedConfig = {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        };

        const context: GenerationContext = {
          job: createMockJob({
            context: { userId: 'user-456', crossChannelHistory },
          }),
          startTime: Date.now(),
          config,
        };

        const result = step.process(context);

        // Cross-channel timestamps should be the sole source for oldestHistoryTimestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-05T08:00:00Z').getTime()
        );
      });

      it('should handle cross-channel messages with undefined createdAt', () => {
        const crossChannelHistory = [
          {
            channelEnvironment: {
              type: 'guild' as const,
              guild: { id: 'g-1', name: 'Server' },
              channel: { id: 'ch-other', name: 'general', type: 'text' },
            },
            messages: [
              {
                id: 'msg-cross-1',
                role: MessageRole.User,
                content: 'No timestamp',
                // createdAt intentionally omitted
              },
              {
                id: 'msg-cross-2',
                role: MessageRole.Assistant,
                content: 'Has timestamp',
                createdAt: '2024-01-10T12:00:00Z',
              },
            ],
          },
        ];

        const config: ResolvedConfig = {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        };

        const context: GenerationContext = {
          job: createMockJob({
            context: { userId: 'user-456', crossChannelHistory },
          }),
          startTime: Date.now(),
          config,
        };

        const result = step.process(context);

        // Should use the valid timestamp, ignoring the undefined one
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-10T12:00:00Z').getTime()
        );
      });

      it('should map cross-channel history to pipeline format', () => {
        const crossChannelHistory = [
          {
            channelEnvironment: {
              type: 'dm' as const,
              channel: { id: 'dm-1', name: 'DM', type: 'dm' },
            },
            messages: [
              {
                id: 'msg-cross-1',
                role: MessageRole.User,
                content: 'DM message',
                createdAt: '2024-01-01T08:00:00Z',
                personaName: 'Alice',
                tokenCount: 5,
              },
            ],
          },
        ];

        const config: ResolvedConfig = {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'personality',
        };

        const context: GenerationContext = {
          job: createMockJob({
            context: { userId: 'user-456', crossChannelHistory },
          }),
          startTime: Date.now(),
          config,
        };

        const result = step.process(context);

        expect(result.preparedContext?.crossChannelHistory).toHaveLength(1);
        expect(result.preparedContext?.crossChannelHistory?.[0].channelEnvironment.type).toBe('dm');
        expect(result.preparedContext?.crossChannelHistory?.[0].messages[0].content).toBe(
          'DM message'
        );
      });
    });
  });
});
