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
      assembler: makeAssembler({ history: history as never }),
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ allMatched: true }),
      expect.stringContaining('matched')
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('warns with per-surface booleans when the persona diverges', async () => {
    await shadowAssembleAndDiff({
      jobId: 'j1',
      jobContext: makeJobContext(),
      personality: PERSONALITY,
      configOverrides: undefined,
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
      assembler: makeAssembler({ userTimezone: 'UTC', activePersonaName: null }),
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ allMatched: true }),
      expect.anything()
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
      })
    ).resolves.toBeUndefined();

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'j1' }),
      expect.stringContaining('ignored')
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
