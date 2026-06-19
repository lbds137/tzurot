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

// Use vi.hoisted to create mock functions before they're used in vi.mock
const { mockExtractParticipants, mockConvertConversationHistory, mockLogger } = vi.hoisted(() => ({
  mockExtractParticipants: vi.fn(),
  mockConvertConversationHistory: vi.fn(),
  // Module-level mock logger so tests can assert call shape on warn/info
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock common-types logger — use the hoisted mockLogger so tests can inspect
// log calls for race-window telemetry assertions.
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

vi.mock('../../../utils/conversationUtils.js', () => ({
  extractParticipants: mockExtractParticipants,
  convertConversationHistory: mockConvertConversationHistory,
}));

const { mockIsAssemblyPromoteEnabled } = vi.hoisted(() => ({
  mockIsAssemblyPromoteEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('../../../../services/context/contextFlags.js', () => ({
  isAssemblyPromoteEnabled: mockIsAssemblyPromoteEnabled,
}));

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

  describe('assembler promotion (iii-b cutover)', () => {
    const config: ResolvedConfig = {
      effectivePersonality: TEST_PERSONALITY,
      configSource: 'personality',
    };
    function makeAssembled(overrides: Record<string, unknown> = {}) {
      return {
        userInternalId: 'uid-internal',
        activePersonaId: 'persona-asm',
        activePersonaName: 'AsmPersona',
        userTimezone: 'America/New_York',
        contextEpoch: undefined,
        history: [
          {
            role: MessageRole.User,
            content: 'assembled history',
            createdAt: new Date('2026-01-02T00:00:00Z'),
            personaId: 'persona-asm',
            discordMessageId: ['m1'],
          },
        ],
        referencedMessages: [{ referenceNumber: 1, content: 'ref', authorName: 'A' }],
        messageContent: 'assembled message content',
        mentionedPersonas: [{ personaId: 'mp-1', personaName: 'Mentioned' }],
        referencedChannels: undefined,
        crossChannelHistory: undefined,
        ...overrides,
      };
    }

    it('builds context from the assembler when flag + envelope + assembler are all present', async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(true);
      const assembled = makeAssembled();
      const fakeAssembler = { assembleCore: vi.fn().mockResolvedValue(assembled) };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const job = createMockJob({
        context: {
          userId: 'u',
          rawAssemblyInputs: { rawMessageContent: 'raw' },
          referencedMessages: [],
        } as never,
      });

      const result = await promoteStep.process({ job, startTime: Date.now(), config });

      expect(fakeAssembler.assembleCore).toHaveBeenCalled();
      // History is sourced from the assembler, createdAt normalized Date → ISO.
      expect(mockConvertConversationHistory).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content: 'assembled history',
            createdAt: '2026-01-02T00:00:00.000Z',
          }),
        ]),
        TEST_PERSONALITY.name
      );
      // jobContext re-sourced in place for the downstream conversationContextBuilder.
      expect(job.data.context.referencedMessages).toBe(assembled.referencedMessages);
      expect(job.data.context.mentionedPersonas).toBe(assembled.mentionedPersonas);
      expect(job.data.context.activePersonaId).toBe('persona-asm');
      expect(job.data.context.userTimezone).toBe('America/New_York');
      // The worker-rewritten content drives generation.
      expect(job.data.message).toBe('assembled message content');
      expect(result.preparedContext).toBeDefined();
    });

    it('adopts the assembled guild surfaces when the envelope carries the raw sources', async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(true);
      const assembledGuildMap = { 'persona-555': { roles: ['Admin'] } };
      const assembledActive = { roles: ['Mod'] };
      const assembled = makeAssembled({
        participantGuildInfo: assembledGuildMap,
        activePersonaGuildInfo: assembledActive,
      });
      const fakeAssembler = { assembleCore: vi.fn().mockResolvedValue(assembled) };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const job = createMockJob({
        context: {
          userId: 'u',
          rawAssemblyInputs: {
            rawMessageContent: 'raw',
            rawParticipantGuildInfo: { 'discord:555': { roles: ['Admin'] } },
            rawActiveGuildMemberInfo: { roles: ['Mod'] },
          },
          // Payload copies the bot still ships during burn-in.
          participantGuildInfo: { 'persona-555': { roles: ['Admin'] } },
          activePersonaGuildInfo: { roles: ['Mod'] },
        } as never,
      });

      await promoteStep.process({ job, startTime: Date.now(), config });

      expect(job.data.context.participantGuildInfo).toBe(assembledGuildMap);
      expect(job.data.context.activePersonaGuildInfo).toBe(assembledActive);
    });

    it('preserves the payload guild surfaces when the envelope predates the raw sources', async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(true);
      // Old envelope: no raw guild fields → assembler derives undefined.
      const assembled = makeAssembled({
        participantGuildInfo: undefined,
        activePersonaGuildInfo: undefined,
      });
      const fakeAssembler = { assembleCore: vi.fn().mockResolvedValue(assembled) };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const payloadGuild = { 'persona-9': { roles: ['Keeper'] } };
      const payloadActive = { roles: ['Elder'] };
      const job = createMockJob({
        context: {
          userId: 'u',
          rawAssemblyInputs: { rawMessageContent: 'raw' },
          participantGuildInfo: payloadGuild,
          activePersonaGuildInfo: payloadActive,
        } as never,
      });

      await promoteStep.process({ job, startTime: Date.now(), config });

      // No raw source → the overwrite must NOT clobber the valid payload copies.
      expect(job.data.context.participantGuildInfo).toBe(payloadGuild);
      expect(job.data.context.activePersonaGuildInfo).toBe(payloadActive);
    });

    it('nulls activePersonaId in jobContext when the assembler returns null (weigh-in)', async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(true);
      const assembled = makeAssembled({ activePersonaId: null, activePersonaName: null });
      const fakeAssembler = { assembleCore: vi.fn().mockResolvedValue(assembled) };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const job = createMockJob({
        context: {
          userId: 'u',
          isWeighIn: true,
          rawAssemblyInputs: { rawMessageContent: 'raw' },
        } as never,
      });

      await promoteStep.process({ job, startTime: Date.now(), config });

      expect(job.data.context.activePersonaId).toBeUndefined();
      expect(job.data.context.activePersonaName).toBeUndefined();
    });

    it('falls back to legacy when the flag is on but the envelope is absent', async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(true);
      const fakeAssembler = { assembleCore: vi.fn() };
      const promoteStep = new ContextStep(fakeAssembler as never);

      await promoteStep.process({ job: createMockJob(), startTime: Date.now(), config });

      expect(fakeAssembler.assembleCore).not.toHaveBeenCalled();
    });

    it('propagates assembleCore errors as job failures (not swallowed like the shadow)', async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(true);
      const fakeAssembler = {
        assembleCore: vi.fn().mockRejectedValue(new Error('assembler boom')),
      };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const job = createMockJob({
        context: { userId: 'u', rawAssemblyInputs: { rawMessageContent: 'raw' } } as never,
      });

      await expect(promoteStep.process({ job, startTime: Date.now(), config })).rejects.toThrow(
        'assembler boom'
      );
    });

    it('flows a non-undefined assembler crossChannelHistory through to preparedContext', async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(true);
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
      const assembled = makeAssembled({ crossChannelHistory });
      const fakeAssembler = { assembleCore: vi.fn().mockResolvedValue(assembled) };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const job = createMockJob({
        context: { userId: 'u', rawAssemblyInputs: { rawMessageContent: 'raw' } } as never,
      });

      const result = await promoteStep.process({ job, startTime: Date.now(), config });

      expect(job.data.context.crossChannelHistory).toBe(crossChannelHistory);
      expect(result.preparedContext?.crossChannelHistory).toHaveLength(1);
    });

    it("assembles a kind:'envelope' job even when the promote flag is OFF", async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(false);
      const fakeAssembler = { assembleCore: vi.fn().mockResolvedValue(makeAssembled()) };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const job = createMockJob({
        context: {
          kind: 'envelope',
          userId: 'u',
          rawAssemblyInputs: { rawMessageContent: 'raw' },
        } as never,
      });

      await promoteStep.process({ job, startTime: Date.now(), config });

      expect(fakeAssembler.assembleCore).toHaveBeenCalled();
    });

    it("throws on a kind:'envelope' job when no assembler is wired (no legacy fallback)", async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(false);
      const noAssemblerStep = new ContextStep();
      const job = createMockJob({
        context: {
          kind: 'envelope',
          userId: 'u',
          rawAssemblyInputs: { rawMessageContent: 'raw' },
        } as never,
      });

      await expect(noAssemblerStep.process({ job, startTime: Date.now(), config })).rejects.toThrow(
        'requires a wired ContextAssembler'
      );
    });

    it('logs the promoted path with counts only (no content)', async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(true);
      const fakeAssembler = { assembleCore: vi.fn().mockResolvedValue(makeAssembled()) };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const job = createMockJob({
        context: { userId: 'u', rawAssemblyInputs: { rawMessageContent: 'raw' } } as never,
      });

      await promoteStep.process({ job, startTime: Date.now(), config });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          historyLength: 1,
          referencedCount: 1,
          mentionedCount: 1,
          crossChannelGroups: 0,
        }),
        'Context assembled via promoted path'
      );
    });

    it("logs kind:'envelope' when the job carries that discriminant", async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(false); // mustAssemble path, promote off
      const fakeAssembler = { assembleCore: vi.fn().mockResolvedValue(makeAssembled()) };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const job = createMockJob({
        context: {
          kind: 'envelope',
          userId: 'u',
          rawAssemblyInputs: { rawMessageContent: 'raw' },
        } as never,
      });

      await promoteStep.process({ job, startTime: Date.now(), config });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'envelope' }),
        'Context assembled via promoted path'
      );
    });

    it('logs zero counts when the assembler returns undefined ref/mention/cross-channel surfaces', async () => {
      mockIsAssemblyPromoteEnabled.mockReturnValue(true);
      const assembled = makeAssembled({
        referencedMessages: undefined,
        mentionedPersonas: undefined,
        crossChannelHistory: undefined,
      });
      const fakeAssembler = { assembleCore: vi.fn().mockResolvedValue(assembled) };
      const promoteStep = new ContextStep(fakeAssembler as never);
      const job = createMockJob({
        context: { userId: 'u', rawAssemblyInputs: { rawMessageContent: 'raw' } } as never,
      });

      await promoteStep.process({ job, startTime: Date.now(), config });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ referencedCount: 0, mentionedCount: 0, crossChannelGroups: 0 }),
        'Context assembled via promoted path'
      );
    });
  });

  describe('process', () => {
    it('should throw error if config is missing', async () => {
      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        // No config
      };

      await expect(step.process(context)).rejects.toThrow('ConfigStep must run before ContextStep');
    });

    it('should prepare empty context when no conversation history', async () => {
      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const context: GenerationContext = {
        job: createMockJob({ context: { userId: 'user-456', conversationHistory: [] } }),
        startTime: Date.now(),
        config,
      };

      const result = await step.process(context);

      expect(result.preparedContext).toBeDefined();
      expect(result.preparedContext?.conversationHistory).toEqual([]);
      expect(result.preparedContext?.rawConversationHistory).toEqual([]);
      expect(result.preparedContext?.participants).toEqual([]);
      expect(result.preparedContext?.oldestHistoryTimestamp).toBeUndefined();
    });

    it('should call extractParticipants with conversation history', async () => {
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

      await step.process(context);

      expect(mockExtractParticipants).toHaveBeenCalledWith(conversationHistory, 'bot-1', 'TestBot');
    });

    it('should call convertConversationHistory with personality name', async () => {
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

      await step.process(context);

      expect(mockConvertConversationHistory).toHaveBeenCalledWith(
        conversationHistory,
        TEST_PERSONALITY.name
      );
    });

    it('should calculate oldest timestamp from conversation history', async () => {
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

      const result = await step.process(context);

      expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
        new Date('2024-01-01T12:00:00Z').getTime()
      );
    });

    it('should handle messages without timestamps', async () => {
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

      const result = await step.process(context);

      // Should only use the message with timestamp
      expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
        new Date('2024-01-01T12:05:00Z').getTime()
      );
    });

    it('should merge mentioned personas into participants', async () => {
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

      const result = await step.process(context);

      expect(result.preparedContext?.participants).toHaveLength(2);
      expect(result.preparedContext?.participants).toContainEqual({
        personaId: 'bot-2',
        personaName: 'OtherBot',
        isActive: false,
      });
    });

    it('should not duplicate mentioned personas already in participants', async () => {
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

      const result = await step.process(context);

      // Should not duplicate
      expect(result.preparedContext?.participants).toHaveLength(2);
    });

    it('should preserve raw conversation history', async () => {
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

      const result = await step.process(context);

      expect(result.preparedContext?.rawConversationHistory).toEqual(conversationHistory);
      expect(result.preparedContext?.conversationHistory).toHaveLength(2);
    });

    describe('referenced message timestamps in deduplication', () => {
      it('should include referenced message timestamps in oldestHistoryTimestamp', async () => {
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

        const result = await step.process(context);

        // Oldest timestamp should be from the referenced message, not conversation history
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T10:00:00Z').getTime()
        );
      });

      it('should use conversation history timestamp if older than referenced messages', async () => {
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

        const result = await step.process(context);

        // Oldest timestamp should be from conversation history
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T08:00:00Z').getTime()
        );
      });

      it('should handle referenced messages without timestamps', async () => {
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

        const result = await step.process(context);

        // Should use conversation history timestamp when referenced message has no timestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T12:00:00Z').getTime()
        );
      });

      it('should handle only referenced messages (no conversation history)', async () => {
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

        const result = await step.process(context);

        // Should use referenced message timestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T15:00:00Z').getTime()
        );
      });

      it('should handle empty referenced messages array gracefully', async () => {
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

        const result = await step.process(context);

        // Should use conversation history timestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T12:00:00Z').getTime()
        );
      });

      it('should include cross-channel timestamps in oldest calculation', async () => {
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

        const result = await step.process(context);

        // Should use the older cross-channel timestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T08:00:00Z').getTime()
        );
      });

      it('should set oldestHistoryTimestamp from cross-channel alone when no current history', async () => {
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

        const result = await step.process(context);

        // Cross-channel timestamps should be the sole source for oldestHistoryTimestamp
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-05T08:00:00Z').getTime()
        );
      });

      it('should handle cross-channel messages with undefined createdAt', async () => {
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

        const result = await step.process(context);

        // Should use the valid timestamp, ignoring the undefined one
        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-10T12:00:00Z').getTime()
        );
      });

      it('should map cross-channel history to pipeline format', async () => {
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

        const result = await step.process(context);

        expect(result.preparedContext?.crossChannelHistory).toHaveLength(1);
        expect(result.preparedContext?.crossChannelHistory?.[0].channelEnvironment.type).toBe('dm');
        expect(result.preparedContext?.crossChannelHistory?.[0].messages[0].content).toBe(
          'DM message'
        );
      });
    });

    describe('race-window telemetry', () => {
      const config: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      function jobWithTimestamp(
        timestamp: number,
        overrides: Partial<LLMGenerationJobData> = {}
      ): Job<LLMGenerationJobData> {
        return {
          id: 'race-job',
          timestamp,
          data: createValidJobData(overrides),
        } as unknown as Job<LLMGenerationJobData>;
      }

      it('warns with clock-skew framing when deltaMs is negative', async () => {
        // Job timestamp BEFORE the persisted assistant-message timestamp — shouldn't
        // happen with colocated BullMQ + Postgres, but if it ever does, it's a
        // clock/data anomaly, NOT a race. Message must be distinct from the
        // race-signal message so triage doesn't conflate them.
        const jobTs = 1_700_000_000_000;
        const conversationHistory = [
          {
            role: MessageRole.Assistant,
            content: 'future-looking message',
            createdAt: new Date(jobTs + 1_000).toISOString(),
          },
        ];

        const context: GenerationContext = {
          job: jobWithTimestamp(jobTs, { context: { userId: 'u', conversationHistory } }),
          startTime: jobTs,
          config,
        };

        await step.process(context);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ suggestsClockSkew: true, deltaMs: -1_000 }),
          expect.stringContaining('Clock-skew signal')
        );
        // And does NOT fire the race-window warning (separate failure class)
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining('Race-window signal')
        );
      });

      it('warns when job created within 500ms of newest assistant message persistence', async () => {
        const jobTs = 1_700_000_000_000;
        const conversationHistory = [
          {
            role: MessageRole.User,
            content: 'hi',
            createdAt: new Date(jobTs - 1000).toISOString(),
          },
          {
            role: MessageRole.Assistant,
            content: 'previous bot response',
            createdAt: new Date(jobTs - 200).toISOString(),
          },
        ];

        const context: GenerationContext = {
          job: jobWithTimestamp(jobTs, { context: { userId: 'u', conversationHistory } }),
          startTime: jobTs,
          config,
        };

        await step.process(context);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ suggestsRace: true, deltaMs: 200 }),
          expect.stringContaining('Race-window signal')
        );
      });

      it('emits info (not warn) when delta is comfortably positive', async () => {
        const jobTs = 1_700_000_000_000;
        const conversationHistory = [
          {
            role: MessageRole.Assistant,
            content: 'older bot response',
            createdAt: new Date(jobTs - 60_000).toISOString(),
          },
        ];

        const context: GenerationContext = {
          job: jobWithTimestamp(jobTs, { context: { userId: 'u', conversationHistory } }),
          startTime: jobTs,
          config,
        };

        await step.process(context);

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({ suggestsRace: false, deltaMs: 60_000 }),
          expect.stringContaining('Race-window telemetry')
        );
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining('Race-window signal')
        );
      });

      it('picks the newest assistant message when multiple are present', async () => {
        const jobTs = 1_700_000_000_000;
        const conversationHistory = [
          {
            role: MessageRole.Assistant,
            content: 'oldest',
            createdAt: new Date(jobTs - 10_000).toISOString(),
          },
          {
            role: MessageRole.Assistant,
            content: 'middle',
            createdAt: new Date(jobTs - 5_000).toISOString(),
          },
          {
            role: MessageRole.Assistant,
            content: 'newest',
            createdAt: new Date(jobTs - 100).toISOString(),
          },
        ];

        const context: GenerationContext = {
          job: jobWithTimestamp(jobTs, { context: { userId: 'u', conversationHistory } }),
          startTime: jobTs,
          config,
        };

        await step.process(context);

        // 100ms delta → race-suspect; uses newest, not oldest
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ deltaMs: 100 }),
          expect.stringContaining('Race-window signal')
        );
      });

      it('emits nothing when history has no assistant messages', async () => {
        const jobTs = 1_700_000_000_000;
        const conversationHistory = [
          { role: MessageRole.User, content: 'hi', createdAt: new Date(jobTs - 100).toISOString() },
        ];

        const context: GenerationContext = {
          job: jobWithTimestamp(jobTs, { context: { userId: 'u', conversationHistory } }),
          startTime: jobTs,
          config,
        };

        await step.process(context);

        // Race-window messages never emit — no newest assistant to compare against
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining('Race-window signal')
        );
        expect(mockLogger.info).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining('Race-window telemetry')
        );
      });

      it('emits nothing when assistant messages lack valid createdAt', async () => {
        const jobTs = 1_700_000_000_000;
        const conversationHistory = [
          { role: MessageRole.Assistant, content: 'no timestamp' },
          { role: MessageRole.Assistant, content: 'invalid ts', createdAt: 'not-a-date' },
        ];

        const context: GenerationContext = {
          job: jobWithTimestamp(jobTs, { context: { userId: 'u', conversationHistory } }),
          startTime: jobTs,
          config,
        };

        await step.process(context);

        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining('Race-window signal')
        );
        expect(mockLogger.info).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining('Race-window telemetry')
        );
      });
    });
  });
});
