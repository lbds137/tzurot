/**
 * ContextStep Unit Tests
 *
 * After the thin-envelope cutover every job is `kind: 'envelope'` (thin) and ALL
 * prompt surfaces — conversation history, references, participants, guild info,
 * the rewritten message — come from the worker-side ContextAssembler, applied onto
 * jobContext by the step. Non-envelope jobs fail loud. Tests therefore drive
 * behaviour by configuring `assembleCore`'s output, not the job's legacy fields
 * (which the bot no longer ships).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { ContextStep, reTranscribeExtendedContextVoice } from './ContextStep.js';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import type { GenerationContext, ResolvedConfig } from '../types.js';

// Use vi.hoisted to create mock functions before they're used in vi.mock
const { mockExtractParticipants, mockConvertConversationHistory, mockTranscribeAudio, mockLogger } =
  vi.hoisted(() => ({
    mockExtractParticipants: vi.fn(),
    mockConvertConversationHistory: vi.fn(),
    mockTranscribeAudio: vi.fn(),
    // Module-level mock logger so tests can assert call shape on warn/info
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));

// Mock common-types logger — use the hoisted mockLogger so tests can inspect
// log calls for race-window telemetry assertions.
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

vi.mock('../../../utils/conversationUtils.js', () => ({
  extractParticipants: mockExtractParticipants,
  convertConversationHistory: mockConvertConversationHistory,
}));

vi.mock('../../../../services/multimodal/AudioProcessor.js', () => ({
  transcribeAudio: mockTranscribeAudio,
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

const config: ResolvedConfig = {
  effectivePersonality: TEST_PERSONALITY,
  configSource: 'personality',
};

/**
 * The shape `ContextAssembler.assembleCore` returns. Overridable per test; the
 * step applies all of these onto jobContext, so this — not the job's context —
 * is what downstream timestamp/participant logic sees.
 */
function makeAssembled(overrides: Record<string, unknown> = {}) {
  return {
    userInternalId: 'uid-internal',
    activePersonaId: 'persona-asm',
    activePersonaName: 'AsmPersona',
    userTimezone: 'America/New_York',
    history: [] as unknown[],
    referencedMessages: undefined,
    messageContent: 'assembled message content',
    mentionedPersonas: undefined,
    referencedChannels: undefined,
    crossChannelHistory: undefined,
    participantGuildInfo: undefined,
    activePersonaGuildInfo: undefined,
    ...overrides,
  };
}

/** A ContextStep whose assembler returns `makeAssembled(overrides)`. */
function envelopeStep(overrides: Record<string, unknown> = {}) {
  const assembled = makeAssembled(overrides);
  const assembleCore = vi.fn().mockResolvedValue(assembled);
  return { step: new ContextStep({ assembleCore } as never), assembleCore, assembled };
}

/** A `kind: 'envelope'` job; contextOverrides merge into the context. */
function envelopeJob(contextOverrides: Record<string, unknown> = {}): Job<LLMGenerationJobData> {
  return createMockJob({
    context: {
      kind: 'envelope',
      userId: 'user-456',
      rawAssemblyInputs: { rawMessageContent: 'raw' },
      ...contextOverrides,
    } as never,
  });
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

  describe('envelope contract', () => {
    it("throws on a job that is not kind:'envelope' (legacy shapes unsupported)", async () => {
      const { step: envStep } = envelopeStep();
      // No kind on the context → legacy shape.
      const job = createMockJob({ context: { userId: 'u' } as never });

      await expect(envStep.process({ job, startTime: Date.now(), config })).rejects.toThrow(
        "context.kind 'envelope'"
      );
    });

    it("throws on an explicit kind:'legacy' job", async () => {
      const { step: envStep } = envelopeStep();
      const job = createMockJob({ context: { kind: 'legacy', userId: 'u' } as never });

      await expect(envStep.process({ job, startTime: Date.now(), config })).rejects.toThrow(
        "context.kind 'envelope'"
      );
    });

    it("throws on a kind:'envelope' job when no assembler is wired", async () => {
      const noAssemblerStep = new ContextStep();
      const job = envelopeJob();

      await expect(noAssemblerStep.process({ job, startTime: Date.now(), config })).rejects.toThrow(
        'requires a wired ContextAssembler'
      );
    });
  });

  describe('envelope context assembly', () => {
    it('builds context from the assembler', async () => {
      const {
        step: envStep,
        assembleCore,
        assembled,
      } = envelopeStep({
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
        mentionedPersonas: [{ personaId: 'mp-1', personaName: 'Mentioned' }],
      });
      const job = envelopeJob();

      const result = await envStep.process({ job, startTime: Date.now(), config });

      expect(assembleCore).toHaveBeenCalled();
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
      const assembledGuildMap = { 'persona-555': { roles: ['Admin'] } };
      const assembledActive = { roles: ['Mod'] };
      const { step: envStep } = envelopeStep({
        participantGuildInfo: assembledGuildMap,
        activePersonaGuildInfo: assembledActive,
      });
      const job = envelopeJob({
        rawAssemblyInputs: {
          rawMessageContent: 'raw',
          rawParticipantGuildInfo: { 'discord:555': { roles: ['Admin'] } },
          rawActiveGuildMemberInfo: { roles: ['Mod'] },
        },
        // Payload copies (ignored — the envelope omits them, here only to prove
        // the assembled values win when the raw sources are present).
        participantGuildInfo: { 'persona-555': { roles: ['Admin'] } },
        activePersonaGuildInfo: { roles: ['Mod'] },
      });

      await envStep.process({ job, startTime: Date.now(), config });

      expect(job.data.context.participantGuildInfo).toBe(assembledGuildMap);
      expect(job.data.context.activePersonaGuildInfo).toBe(assembledActive);
    });

    it('preserves the payload guild surfaces when the envelope lacks the raw sources (DM case)', async () => {
      // No raw guild fields (e.g. a DM) → assembler derives undefined; the guard
      // must NOT clobber the payload copies with that undefined.
      const { step: envStep } = envelopeStep({
        participantGuildInfo: undefined,
        activePersonaGuildInfo: undefined,
      });
      const payloadGuild = { 'persona-9': { roles: ['Keeper'] } };
      const payloadActive = { roles: ['Elder'] };
      const job = envelopeJob({
        participantGuildInfo: payloadGuild,
        activePersonaGuildInfo: payloadActive,
      });

      await envStep.process({ job, startTime: Date.now(), config });

      expect(job.data.context.participantGuildInfo).toBe(payloadGuild);
      expect(job.data.context.activePersonaGuildInfo).toBe(payloadActive);
    });

    it('nulls activePersonaId in jobContext when the assembler returns null (weigh-in)', async () => {
      const { step: envStep } = envelopeStep({ activePersonaId: null, activePersonaName: null });
      const job = envelopeJob({ isWeighIn: true });

      await envStep.process({ job, startTime: Date.now(), config });

      expect(job.data.context.activePersonaId).toBeUndefined();
      expect(job.data.context.activePersonaName).toBeUndefined();
    });

    it('propagates assembleCore errors as job failures', async () => {
      const assembleCore = vi.fn().mockRejectedValue(new Error('assembler boom'));
      const envStep = new ContextStep({ assembleCore } as never);
      const job = envelopeJob();

      await expect(envStep.process({ job, startTime: Date.now(), config })).rejects.toThrow(
        'assembler boom'
      );
    });

    it('flows a non-undefined assembler crossChannelHistory through to preparedContext', async () => {
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
      const { step: envStep } = envelopeStep({ crossChannelHistory });
      const job = envelopeJob();

      const result = await envStep.process({ job, startTime: Date.now(), config });

      expect(job.data.context.crossChannelHistory).toBe(crossChannelHistory);
      expect(result.preparedContext?.crossChannelHistory).toHaveLength(1);
    });

    it('logs the assembly with counts only (no content)', async () => {
      const { step: envStep } = envelopeStep({
        history: [{ role: MessageRole.User, content: 'h', createdAt: new Date() }],
        referencedMessages: [{ referenceNumber: 1, content: 'ref', authorName: 'A' }],
        mentionedPersonas: [{ personaId: 'mp-1', personaName: 'Mentioned' }],
      });
      const job = envelopeJob();

      await envStep.process({ job, startTime: Date.now(), config });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'envelope',
          historyLength: 1,
          referencedCount: 1,
          mentionedCount: 1,
          crossChannelGroups: 0,
        }),
        'Context assembled'
      );
    });

    it('logs zero counts when the assembler returns undefined ref/mention/cross-channel surfaces', async () => {
      const { step: envStep } = envelopeStep({
        referencedMessages: undefined,
        mentionedPersonas: undefined,
        crossChannelHistory: undefined,
      });
      const job = envelopeJob();

      await envStep.process({ job, startTime: Date.now(), config });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ referencedCount: 0, mentionedCount: 0, crossChannelGroups: 0 }),
        'Context assembled'
      );
    });
  });

  describe('process', () => {
    it('should throw error if config is missing', async () => {
      const context: GenerationContext = {
        job: envelopeJob(),
        startTime: Date.now(),
        // No config
      };

      await expect(step.process(context)).rejects.toThrow('ConfigStep must run before ContextStep');
    });

    it('should prepare empty context when the assembler returns no history', async () => {
      const { step: envStep } = envelopeStep({ history: [] });

      const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      expect(result.preparedContext).toBeDefined();
      expect(result.preparedContext?.conversationHistory).toEqual([]);
      expect(result.preparedContext?.rawConversationHistory).toEqual([]);
      expect(result.preparedContext?.participants).toEqual([]);
      expect(result.preparedContext?.oldestHistoryTimestamp).toBeUndefined();
    });

    it('wires reTranscribeVoiceViaStt through to the STT helper (extended-context voice)', async () => {
      const attachment = {
        url: 'https://cdn.discord/voice.ogg',
        contentType: 'audio/ogg',
      } as unknown as AttachmentMetadata;
      mockTranscribeAudio.mockResolvedValue({ text: 'recovered transcript' });

      // The assembler invokes the callback the step wired in, exercising
      // sourceHistory's reTranscribeVoiceViaStt → reTranscribeExtendedContextVoice
      // path (otherwise dead under a mocked assembler that never calls back).
      let calledText: string | null = 'unset';
      const assembleCore = vi.fn().mockImplementation(async (_ctx, _pers, _ovr, opts) => {
        calledText = await opts.reTranscribeVoiceViaStt(attachment);
        return makeAssembled();
      });
      const envStep = new ContextStep({ assembleCore } as never);

      await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      expect(calledText).toBe('recovered transcript');
      // No sttDispatch on the test context → the helper defaults to voice-engine.
      expect(mockTranscribeAudio).toHaveBeenCalledWith(attachment, { provider: 'voice-engine' });
    });

    it('should call extractParticipants with the assembled history + active persona', async () => {
      const history = [
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
      const { step: envStep } = envelopeStep({
        history,
        activePersonaId: 'bot-1',
        activePersonaName: 'TestBot',
      });

      await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      // History entries are normalized (createdAt Date → ISO; absent stays undefined).
      expect(mockExtractParticipants).toHaveBeenCalledWith(
        history.map(h => ({ ...h, createdAt: undefined })),
        'bot-1',
        'TestBot'
      );
    });

    it('should call convertConversationHistory with the personality name', async () => {
      const history = [{ role: MessageRole.User, content: 'Hello' }];
      const { step: envStep } = envelopeStep({ history });

      await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      expect(mockConvertConversationHistory).toHaveBeenCalledWith(
        history.map(h => ({ ...h, createdAt: undefined })),
        TEST_PERSONALITY.name
      );
    });

    it('should calculate oldest timestamp from the assembled history', async () => {
      const { step: envStep } = envelopeStep({
        history: [
          { role: MessageRole.User, content: 'First', createdAt: '2024-01-01T12:00:00Z' },
          { role: MessageRole.Assistant, content: 'Second', createdAt: '2024-01-01T12:05:00Z' },
          { role: MessageRole.User, content: 'Third', createdAt: '2024-01-01T12:10:00Z' },
        ],
      });

      const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
        new Date('2024-01-01T12:00:00Z').getTime()
      );
    });

    it('should handle messages without timestamps', async () => {
      const { step: envStep } = envelopeStep({
        history: [
          { role: MessageRole.User, content: 'First' }, // No createdAt
          { role: MessageRole.Assistant, content: 'Second', createdAt: '2024-01-01T12:05:00Z' },
        ],
      });

      const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      // Should only use the message with timestamp
      expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
        new Date('2024-01-01T12:05:00Z').getTime()
      );
    });

    it('includes cross-channel message timestamps in oldestHistoryTimestamp', async () => {
      // The current-channel history is newer; the older cross-channel message
      // must win the oldest-timestamp calculation (the assembled crossChannelHistory
      // is folded into the timestamp set alongside current + referenced messages).
      const { step: envStep } = envelopeStep({
        history: [
          { role: MessageRole.User, content: 'Current', createdAt: '2024-01-15T12:00:00Z' },
        ],
        crossChannelHistory: [
          {
            channelEnvironment: {
              type: 'dm' as const,
              channel: { id: 'dm-1', name: 'DM', type: 'dm' },
            },
            messages: [
              {
                id: 'msg-cross-old',
                role: MessageRole.User,
                content: 'Older cross-channel message',
                createdAt: '2024-01-01T08:00:00Z',
                personaName: 'Alice',
                tokenCount: 5,
              },
            ],
          },
        ],
      });

      const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
        new Date('2024-01-01T08:00:00Z').getTime()
      );
    });

    it('uses cross-channel timestamps for oldestHistoryTimestamp when there is no current history', async () => {
      // Cross-channel as the SOLE timestamp source — current-channel history empty.
      const { step: envStep } = envelopeStep({
        history: [],
        crossChannelHistory: [
          {
            channelEnvironment: {
              type: 'dm' as const,
              channel: { id: 'dm-1', name: 'DM', type: 'dm' },
            },
            messages: [
              {
                id: 'm-cross-only',
                role: MessageRole.User,
                content: 'Cross-channel only',
                createdAt: '2024-01-03T09:00:00Z',
                personaName: 'Bob',
                tokenCount: 4,
              },
            ],
          },
        ],
      });

      const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
        new Date('2024-01-03T09:00:00Z').getTime()
      );
    });

    it('handles cross-channel messages with missing createdAt without throwing', async () => {
      // No valid timestamp anywhere — the cross-channel message omits createdAt and
      // there is no current history — so oldestHistoryTimestamp stays undefined and
      // the cross-channel passthrough still works.
      const { step: envStep } = envelopeStep({
        history: [],
        crossChannelHistory: [
          {
            channelEnvironment: {
              type: 'dm' as const,
              channel: { id: 'dm-1', name: 'DM', type: 'dm' },
            },
            messages: [
              {
                id: 'm-cross-no-ts',
                role: MessageRole.User,
                content: 'No timestamp',
                personaName: 'Bob',
                tokenCount: 4,
              },
            ],
          },
        ],
      });

      const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      expect(result.preparedContext?.oldestHistoryTimestamp).toBeUndefined();
      expect(result.preparedContext?.crossChannelHistory).toHaveLength(1);
    });

    it('handles an explicit empty referencedMessages array gracefully', async () => {
      // An explicit `[]` hits a different guard branch than the default `undefined`;
      // neither contributes timestamps nor throws.
      const { step: envStep } = envelopeStep({
        history: [{ role: MessageRole.User, content: 'Hi', createdAt: '2024-01-01T12:00:00Z' }],
        referencedMessages: [],
      });
      const job = envelopeJob();

      const result = await envStep.process({ job, startTime: Date.now(), config });

      expect(job.data.context.referencedMessages).toEqual([]);
      // Only the history timestamp contributes; the empty array adds nothing.
      expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
        new Date('2024-01-01T12:00:00Z').getTime()
      );
    });

    it('should merge mentioned personas into participants', async () => {
      mockExtractParticipants.mockReturnValue([
        { personaId: 'user-1', personaName: 'Alice', isActive: false },
      ]);
      const { step: envStep } = envelopeStep({
        mentionedPersonas: [{ personaId: 'bot-2', personaName: 'OtherBot' }],
      });

      const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

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
      const { step: envStep } = envelopeStep({
        mentionedPersonas: [{ personaId: 'bot-2', personaName: 'OtherBot' }],
      });

      const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      expect(result.preparedContext?.participants).toHaveLength(2);
    });

    it('should preserve raw conversation history', async () => {
      const history = [
        { role: MessageRole.User, content: 'Hello', tokenCount: 5 },
        { role: MessageRole.Assistant, content: 'Hi there', tokenCount: 10 },
      ];
      mockConvertConversationHistory.mockReturnValue([
        new HumanMessage('Hello'),
        new AIMessage('Hi there'),
      ]);
      const { step: envStep } = envelopeStep({ history });

      const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

      expect(result.preparedContext?.rawConversationHistory).toEqual(
        history.map(h => ({ ...h, createdAt: undefined }))
      );
      expect(result.preparedContext?.conversationHistory).toHaveLength(2);
    });

    describe('referenced message timestamps in deduplication', () => {
      function refMsg(timestamp: string) {
        return {
          referenceNumber: 1,
          discordMessageId: 'ref-msg-1',
          discordUserId: 'user-123',
          authorUsername: 'alice',
          authorDisplayName: 'Alice',
          content: 'A referenced message',
          embeds: '',
          timestamp,
          locationContext: 'Server/Channel',
        };
      }

      it('should include referenced message timestamps in oldestHistoryTimestamp', async () => {
        const { step: envStep } = envelopeStep({
          history: [
            { role: MessageRole.User, content: 'Recent', createdAt: '2024-01-01T14:00:00Z' },
          ],
          // Referenced message older than the history.
          referencedMessages: [refMsg('2024-01-01T10:00:00Z')],
        });

        const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T10:00:00Z').getTime()
        );
      });

      it('should use history timestamp if older than referenced messages', async () => {
        const { step: envStep } = envelopeStep({
          history: [
            { role: MessageRole.User, content: 'Old', createdAt: '2024-01-01T08:00:00Z' },
            { role: MessageRole.Assistant, content: 'Reply', createdAt: '2024-01-01T08:05:00Z' },
          ],
          referencedMessages: [refMsg('2024-01-01T12:00:00Z')], // newer than history
        });

        const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T08:00:00Z').getTime()
        );
      });

      it('should handle referenced messages without timestamps', async () => {
        const { step: envStep } = envelopeStep({
          history: [
            { role: MessageRole.User, content: 'Message', createdAt: '2024-01-01T12:00:00Z' },
          ],
          referencedMessages: [refMsg('')], // empty timestamp
        });

        const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T12:00:00Z').getTime()
        );
      });

      it('should handle only referenced messages (no history)', async () => {
        const { step: envStep } = envelopeStep({
          history: [],
          referencedMessages: [refMsg('2024-01-01T15:00:00Z')],
        });

        const result = await envStep.process({ job: envelopeJob(), startTime: Date.now(), config });

        expect(result.preparedContext?.oldestHistoryTimestamp).toBe(
          new Date('2024-01-01T15:00:00Z').getTime()
        );
      });
    });
  });

  describe('race-window telemetry', () => {
    // A kind:'envelope' job that also carries a BullMQ `timestamp` — the telemetry
    // compares it against the newest assistant message in the assembled history.
    // History is sourced from the assembler (envelopeStep), not the job's context.
    function jobWithTimestamp(timestamp: number): Job<LLMGenerationJobData> {
      return {
        id: 'race-job',
        timestamp,
        data: envelopeJob().data,
      } as unknown as Job<LLMGenerationJobData>;
    }

    it('warns with clock-skew framing when deltaMs is negative', async () => {
      // Job timestamp BEFORE the persisted assistant-message timestamp — shouldn't
      // happen with colocated BullMQ + Postgres, but if it ever does, it's a
      // clock/data anomaly, NOT a race. Message must be distinct from the
      // race-signal message so triage doesn't conflate them.
      const jobTs = 1_700_000_000_000;
      const { step: envStep } = envelopeStep({
        history: [
          {
            role: MessageRole.Assistant,
            content: 'future-looking message',
            createdAt: new Date(jobTs + 1_000).toISOString(),
          },
        ],
      });

      await envStep.process({ job: jobWithTimestamp(jobTs), startTime: jobTs, config });

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
      const { step: envStep } = envelopeStep({
        history: [
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
        ],
      });

      await envStep.process({ job: jobWithTimestamp(jobTs), startTime: jobTs, config });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ suggestsRace: true, deltaMs: 200 }),
        expect.stringContaining('Race-window signal')
      );
    });

    it('emits info (not warn) when delta is comfortably positive', async () => {
      const jobTs = 1_700_000_000_000;
      const { step: envStep } = envelopeStep({
        history: [
          {
            role: MessageRole.Assistant,
            content: 'older bot response',
            createdAt: new Date(jobTs - 60_000).toISOString(),
          },
        ],
      });

      await envStep.process({ job: jobWithTimestamp(jobTs), startTime: jobTs, config });

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
      const { step: envStep } = envelopeStep({
        history: [
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
        ],
      });

      await envStep.process({ job: jobWithTimestamp(jobTs), startTime: jobTs, config });

      // 100ms delta → race-suspect; uses newest, not oldest
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ deltaMs: 100 }),
        expect.stringContaining('Race-window signal')
      );
    });

    it('emits nothing when history has no assistant messages', async () => {
      const jobTs = 1_700_000_000_000;
      const { step: envStep } = envelopeStep({
        history: [
          {
            role: MessageRole.User,
            content: 'hi',
            createdAt: new Date(jobTs - 100).toISOString(),
          },
        ],
      });

      await envStep.process({ job: jobWithTimestamp(jobTs), startTime: jobTs, config });

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
      const { step: envStep } = envelopeStep({
        history: [
          { role: MessageRole.Assistant, content: 'no timestamp' },
          { role: MessageRole.Assistant, content: 'invalid ts', createdAt: 'not-a-date' },
        ],
      });

      await envStep.process({ job: jobWithTimestamp(jobTs), startTime: jobTs, config });

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

describe('reTranscribeExtendedContextVoice', () => {
  const attachment = {
    url: 'https://cdn/v.ogg',
    originalUrl: 'https://cdn/v.ogg',
    contentType: 'audio/ogg',
    isVoiceMessage: true,
  } as AttachmentMetadata;

  beforeEach(() => vi.clearAllMocks());

  it('returns the transcribed text on success', async () => {
    mockTranscribeAudio.mockResolvedValue({ text: 'a transcript' });
    expect(await reTranscribeExtendedContextVoice(attachment, { provider: 'mistral' })).toBe(
      'a transcript'
    );
  });

  it('defaults to the voice-engine dispatch when no STT was resolved', async () => {
    mockTranscribeAudio.mockResolvedValue({ text: 'voice-engine transcript' });
    await reTranscribeExtendedContextVoice(attachment, undefined);
    expect(mockTranscribeAudio).toHaveBeenCalledWith(attachment, { provider: 'voice-engine' });
  });

  it('returns null on empty text', async () => {
    mockTranscribeAudio.mockResolvedValue({ text: '' });
    expect(await reTranscribeExtendedContextVoice(attachment, undefined)).toBeNull();
  });

  it('returns null (graceful) when transcription throws', async () => {
    mockTranscribeAudio.mockRejectedValue(new Error('expired CDN url'));
    expect(await reTranscribeExtendedContextVoice(attachment, undefined)).toBeNull();
  });
});
