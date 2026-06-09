import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return { ...actual, createLogger: () => mockLogger };
});

import { MessageRole, type JobContext, type LoadedPersonality } from '@tzurot/common-types';
import { shadowAssembleAndDiff } from './shadowAssembly.js';
import type { ContextAssembler, AssembledCore } from './ContextAssembler.js';

const PERSONALITY = { id: 'pers-1' } as LoadedPersonality;

function makeAssembler(core: Partial<AssembledCore>): ContextAssembler {
  return {
    assembleCore: vi.fn().mockResolvedValue({
      userInternalId: 'internal-1',
      activePersonaId: 'persona-1',
      activePersonaName: 'Vee',
      userTimezone: 'UTC',
      contextEpoch: undefined,
      history: [],
      referencedMessages: undefined,
      messageContent: 'hello',
      mentionedPersonas: undefined,
      referencedChannels: undefined,
      crossChannelHistory: undefined,
      ...core,
    }),
  } as unknown as ContextAssembler;
}

function makeJobContext(partial: Partial<JobContext> = {}): JobContext {
  return {
    userId: '123',
    userInternalId: 'internal-1',
    activePersonaId: 'persona-1',
    activePersonaName: 'Vee',
    channelId: 'chan-1',
    rawAssemblyInputs: { rawMessageContent: 'hello' },
    conversationHistory: [],
    ...partial,
  } as JobContext;
}

const msg = (id: string, content: string, personaId = 'persona-1') => ({
  id,
  role: MessageRole.User,
  content,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  personaId,
  discordMessageId: [id],
});

const env = (channelId: string, name = 'chan') => ({
  type: 'guild' as const,
  guild: { id: 'g1', name: 'Guild' },
  channel: { id: channelId, name, type: 'text' },
});

const ref = () => ({
  referenceNumber: 1,
  discordMessageId: 'r1',
  discordUserId: 'u1',
  authorUsername: 'a',
  authorDisplayName: 'A',
  content: 'ref content',
  embeds: '',
  timestamp: '2026-06-01T00:00:00.000Z',
  locationContext: '',
});

describe('shadowAssembleAndDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops without rawAssemblyInputs', async () => {
    const assembler = makeAssembler({});
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ rawAssemblyInputs: undefined }),
      personality: PERSONALITY,
      configOverrides: undefined,
      assembler,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
    });
    expect(assembler.assembleCore).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('logs allMatched when every surface agrees', async () => {
    const history = [msg('m1', 'hi')];
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ conversationHistory: history as never }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ history: history as never }),
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ allMatched: true }),
      expect.stringContaining('matched')
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('weigh-in: null assembled persona vs omitted payload persona matches; summary carries triggerMessageId', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j-weigh',
      jobContext: makeJobContext({
        isWeighIn: true,
        triggerMessageId: 'trig-99',
        // Weigh-in payload omits the persona (bot cleared it).
        activePersonaId: undefined,
        activePersonaName: undefined,
      }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      // The assembler nulls the output persona for weigh-in.
      assembler: makeAssembler({ activePersonaId: null, activePersonaName: null }),
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        allMatched: true,
        triggerMessageId: 'trig-99',
        matches: expect.objectContaining({ activePersonaId: true, activePersonaName: true }),
      }),
      expect.stringContaining('matched')
    );
  });

  it('warns with per-surface booleans when the persona diverges', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext(),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ activePersonaId: 'OTHER' }),
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        allMatched: false,
        matches: expect.objectContaining({ activePersonaId: false, userInternalId: true }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('tolerates extra assembled rows (timing drift) but flags missing + content mismatches', async () => {
    const payloadHistory = [msg('m1', 'original'), msg('m2', 'second')];
    const assembledHistory = [msg('m1', 'CHANGED'), msg('m3', 'newer-row')]; // m2 missing, m1 differs

    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ conversationHistory: payloadHistory as never }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ history: assembledHistory as never }),
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        matches: expect.objectContaining({ historyIds: false, historyContent: false }),
        historyDiff: expect.objectContaining({
          missingFromAssembled: 1,
          extraInAssembled: 1,
          contentMismatches: 1,
        }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('flags persona-id mismatches on the history id-intersection', async () => {
    const payloadHistory = [msg('m1', 'hi', 'persona-1')];
    const assembledHistory = [msg('m1', 'hi', 'persona-OTHER')];

    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ conversationHistory: payloadHistory as never }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ history: assembledHistory as never }),
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        matches: expect.objectContaining({ historyPersonaIds: false, historyContent: true }),
        historyDiff: expect.objectContaining({ personaIdMismatches: 1 }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('treats extra-only assembled rows as a match (post-fetch persistence drift)', async () => {
    const payloadHistory = [msg('m1', 'hi')];
    const assembledHistory = [msg('m1', 'hi'), msg('m2', 'persisted-after-fetch')];

    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ conversationHistory: payloadHistory as never }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ history: assembledHistory as never }),
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        allMatched: true,
        historyDiff: expect.objectContaining({ extraInAssembled: 1 }),
      }),
      expect.stringContaining('matched')
    );
  });

  it('normalizes timezone (payload omits UTC) and persona-name (null vs undefined)', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ userTimezone: undefined, activePersonaName: undefined }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ userTimezone: 'UTC', activePersonaName: null }),
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ allMatched: true }),
      expect.anything()
    );
  });

  it('threads the job timestamp into the assembler as the dedup anchor', async () => {
    const assembler = makeAssembler({});
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext(),
      personality: PERSONALITY,
      configOverrides: undefined,
      assembler,
      jobTimestampMs: 1_717_243_200_000,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
    });
    expect(assembler.assembleCore).toHaveBeenCalledWith(expect.anything(), PERSONALITY, undefined, {
      referenceDedupNowMs: 1_717_243_200_000,
    });
  });

  it('treats the reference surface as skipped when assembly produced none', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ referencedMessages: [ref()] as never }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ referencedMessages: undefined }),
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        allMatched: true,
        referenceDiff: expect.objectContaining({ compared: false, payloadCount: 1 }),
      }),
      expect.stringContaining('matched')
    );
  });

  it('matches when assembled references agree with the payload', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ referencedMessages: [ref()] as never }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ referencedMessages: [ref()] as never }),
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        allMatched: true,
        referenceDiff: expect.objectContaining({ compared: true, matched: true }),
      }),
      expect.anything()
    );
  });

  it('flags payload reference numbers absent from the assembled set', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ referencedMessages: [ref()] as never }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({
        // Same count, disjoint number — should-be-impossible drift shape.
        referencedMessages: [{ ...ref(), referenceNumber: 99 }] as never,
      }),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        matches: expect.objectContaining({ referencedMessages: false }),
        referenceDiff: expect.objectContaining({ missingFromAssembled: 1, extraInAssembled: 1 }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('labels worker-produced surplus references as extraInAssembled', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ referencedMessages: undefined }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ referencedMessages: [ref()] as never }),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        matches: expect.objectContaining({ referencedMessages: false }),
        referenceDiff: expect.objectContaining({ extraInAssembled: 1, payloadCount: 0 }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('flags content and stub-decision mismatches on the reference surface', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ referencedMessages: [ref()] as never }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({
        referencedMessages: [{ ...ref(), content: 'STUBBED', isDeduplicated: true }] as never,
      }),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        allMatched: false,
        matches: expect.objectContaining({ referencedMessages: false }),
        referenceDiff: expect.objectContaining({ contentMismatches: 1, dedupMismatches: 1 }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('flags id-set size mismatches on referencedChannels', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ referencedChannels: undefined }),
      personality: PERSONALITY,
      configOverrides: undefined,
      assembler: makeAssembler({
        referencedChannels: [{ channelId: 'c-1', channelName: 'general' }],
      }),
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        matches: expect.objectContaining({ referencedChannels: false }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('flags messageContent divergence between worker rewrite and payload', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext(),
      personality: PERSONALITY,
      configOverrides: undefined,
      assembler: makeAssembler({ messageContent: 'WORKER VERSION' }),
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        matches: expect.objectContaining({ messageContent: false }),
        contentDiff: expect.objectContaining({ compared: true, matched: false }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('compares messageContent for voice jobs (ground-truth envelopes are empty)', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({
        isVoiceMessage: true,
        rawAssemblyInputs: { rawMessageContent: '', rawRoutingTranscript: 'spoken words' },
      }),
      personality: PERSONALITY,
      configOverrides: undefined,
      assembler: makeAssembler({ messageContent: '' }),
      jobTimestampMs: undefined,
      payloadMessage: '',
      workerTranscriptions: ['worker words'],
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        allMatched: true,
        contentDiff: expect.objectContaining({ compared: true, matched: true }),
      }),
      expect.stringContaining('matched')
    );
  });

  it('emits STT divergence telemetry without affecting allMatched', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({
        rawAssemblyInputs: { rawMessageContent: '', rawRoutingTranscript: 'bot transcript' },
      }),
      personality: PERSONALITY,
      configOverrides: undefined,
      assembler: makeAssembler({ messageContent: '' }),
      jobTimestampMs: undefined,
      payloadMessage: '',
      // Deliberately different from the bot transcript — expected divergence.
      workerTranscriptions: ['worker transcript, slightly different'],
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        allMatched: true,
        sttDivergence: expect.objectContaining({
          compared: true,
          equal: false,
          botLength: 'bot transcript'.length,
        }),
      }),
      expect.stringContaining('matched')
    );
  });

  it('marks STT divergence uncompared when either side lacks a transcript', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext(),
      personality: PERSONALITY,
      configOverrides: undefined,
      assembler: makeAssembler({}),
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        sttDivergence: expect.objectContaining({ compared: false }),
      }),
      expect.anything()
    );
  });

  it('leaves equal undefined (not false) on an asymmetric run — bot transcript, no worker side', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({
        rawAssemblyInputs: { rawMessageContent: '', rawRoutingTranscript: 'bot transcript' },
      }),
      personality: PERSONALITY,
      configOverrides: undefined,
      assembler: makeAssembler({ messageContent: '' }),
      jobTimestampMs: undefined,
      payloadMessage: '',
      workerTranscriptions: undefined,
    });
    // equal must mirror compared: a one-sided run is "not compared", never
    // "compared and diverged" — equal: false here would mislead the burn-in
    // divergence analysis.
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        sttDivergence: expect.objectContaining({
          compared: false,
          equal: undefined,
          botLength: 'bot transcript'.length,
          workerLength: undefined,
        }),
      }),
      expect.anything()
    );
  });

  it('compares mentionedPersonas and referencedChannels as id sets', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({
        mentionedPersonas: [{ personaId: 'p-1', personaName: 'A' }] as never,
        referencedChannels: [{ channelId: 'c-1', channelName: 'general' }] as never,
      }),
      personality: PERSONALITY,
      configOverrides: undefined,
      assembler: makeAssembler({
        // Same channel set, different persona set.
        mentionedPersonas: [{ personaId: 'p-OTHER', personaName: 'A' }],
        referencedChannels: [{ channelId: 'c-1', channelName: 'general' }],
      }),
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        matches: expect.objectContaining({
          mentionedPersonas: false,
          referencedChannels: true,
        }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('flags cross-channel presence disagreement (gate divergence)', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ crossChannelHistory: undefined }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({
        crossChannelHistory: [{ channelEnvironment: env('other-1'), messages: [] }] as never,
      }),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        matches: expect.objectContaining({ crossChannelHistory: false }),
        crossChannelDiff: expect.objectContaining({ presenceMismatch: true }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('tolerates env-name drift but flags missing cross-channel messages', async () => {
    const payloadGroup = {
      channelEnvironment: env('other-1', 'real-name'),
      messages: [
        { id: 'x1', role: MessageRole.User, content: 'cross msg' },
        { id: 'x2', role: MessageRole.User, content: 'second' },
      ],
    };
    const assembledGroup = {
      // Same channel id, fallback name (cache miss) — tolerated but counted.
      channelEnvironment: env('other-1', 'unknown-channel'),
      messages: [{ id: 'x1', role: MessageRole.User, content: 'cross msg' }],
    };
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({ crossChannelHistory: [payloadGroup] as never }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({ crossChannelHistory: [assembledGroup] as never }),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        crossChannelDiff: expect.objectContaining({
          envNameMismatches: 1,
          missingMessages: 1,
          matched: false,
        }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('matches cross-channel groups by key with identical messages despite name drift', async () => {
    const messages = [{ id: 'x1', role: MessageRole.User, content: 'cross msg' }];
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext({
        crossChannelHistory: [
          { channelEnvironment: env('other-1', 'live-name'), messages },
        ] as never,
      }),
      personality: PERSONALITY,
      configOverrides: undefined,
      jobTimestampMs: undefined,
      payloadMessage: 'hello',
      workerTranscriptions: undefined,
      assembler: makeAssembler({
        crossChannelHistory: [
          { channelEnvironment: env('other-1', 'cached-name'), messages: [...messages] },
        ] as never,
      }),
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        allMatched: true,
        crossChannelDiff: expect.objectContaining({ envNameMismatches: 1, matched: true }),
      }),
      expect.stringContaining('matched')
    );
  });

  it('swallows assembler errors into a debug log (never throws)', async () => {
    const assembler = {
      assembleCore: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as ContextAssembler;

    await expect(
      shadowAssembleAndDiff({
        jobId: 'j1',
        jobContext: makeJobContext(),
        personality: PERSONALITY,
        configOverrides: undefined,
        assembler,
        jobTimestampMs: undefined,
        payloadMessage: 'hello',
        workerTranscriptions: undefined,
      })
    ).resolves.toBeUndefined();

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'j1' }),
      expect.stringContaining('ignored')
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
