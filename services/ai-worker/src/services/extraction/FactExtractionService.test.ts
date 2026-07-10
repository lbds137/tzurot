import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { JobType } from '@tzurot/common-types/constants/queue';
import type { FactExtractionJobData } from '@tzurot/common-types/types/jobs';
import {
  FactExtractionService,
  hasEntityOverlap,
  ExtractionProviderBusyError,
  resolveExtractionProvider,
} from './FactExtractionService.js';
import { generateFactExtractionJobUuid } from '@tzurot/common-types/utils/deterministicUuid';
import type { FactStore, SimilarFact } from './FactStore.js';
import type { ExtractionBudget } from './ExtractionBudget.js';

const PERSONALITY = '4f9b0f66-0000-4000-8000-0000000000aa';
const PERSONA_A = '4f9b0f66-0000-4000-8000-0000000000bb';
const PERSONA_B = '4f9b0f66-0000-4000-8000-0000000000cc';
const MEM = (n: number): string =>
  `4f9b0f66-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const job: FactExtractionJobData = {
  requestId: 'req-1',
  jobType: JobType.FactExtraction,
  responseDestination: { type: 'api' },
  version: 1,
  channelId: 'chan-1',
  personalityId: PERSONALITY,
  sourceMemoryIds: [MEM(1), MEM(2)],
  windowStart: MEM(1),
};

interface Setup {
  service: FactExtractionService;
  factStore: FactStore;
  budget: ExtractionBudget;
  invokeModel: ReturnType<typeof vi.fn>;
  writeMock: ReturnType<typeof vi.fn>;
  usageCreateMock: ReturnType<typeof vi.fn>;
  prisma: PrismaClient;
}

function makeSetup(options: {
  episodes?: unknown[];
  modelResponse?: string | Error;
  budgetAllowed?: boolean;
  /** tier defaults to 'observed' — set 'corrected' to exercise the tier shield. */
  similarFacts?: (Omit<SimilarFact, 'tier'> & { tier?: string })[];
  knownFacts?: {
    id: string;
    statement: string;
    entityTags: string[];
    isLocked: boolean;
    tier?: string;
  }[];
}): Setup {
  const episodes = options.episodes ?? [
    { id: MEM(1), content: '{user}: my cat is Miso', personaId: PERSONA_A, isFiction: false },
    { id: MEM(2), content: '{user}: I love tea', personaId: PERSONA_A, isFiction: false },
  ];
  const usageCreateMock = vi.fn().mockResolvedValue({});
  const prisma = {
    memory: { findMany: vi.fn().mockResolvedValue(episodes) },
    persona: { findUnique: vi.fn().mockResolvedValue({ ownerId: 'user-uuid-1' }) },
    usageLog: { create: usageCreateMock },
  } as unknown as PrismaClient;

  const writeMock = vi.fn().mockResolvedValue('new-fact-id');
  const withTier = <T extends { tier?: string }>(facts: T[]): (T & { tier: string })[] =>
    facts.map(f => ({ ...f, tier: f.tier ?? 'observed' }));
  const factStore = {
    getRecentActiveFacts: vi.fn().mockResolvedValue(withTier(options.knownFacts ?? [])),
    findSimilarActiveFacts: vi.fn().mockResolvedValue(withTier(options.similarFacts ?? [])),
    embedStatement: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
    writeFactWithSupersessions: writeMock,
  } as unknown as FactStore;

  const budget = {
    tryConsume: vi.fn().mockResolvedValue(options.budgetAllowed ?? true),
    refund: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExtractionBudget;

  const invokeModel =
    options.modelResponse instanceof Error
      ? vi.fn().mockRejectedValue(options.modelResponse)
      : vi.fn().mockResolvedValue({
          content:
            options.modelResponse ??
            JSON.stringify({
              facts: [
                {
                  statement: "Alice's cat is named Miso",
                  entityTags: ['user:alice', 'pet:miso'],
                  salience: 0.7,
                  supersedesIndex: null,
                },
              ],
            }),
          tokensIn: 120,
          tokensOut: 40,
          provider: 'openrouter',
        });

  const service = new FactExtractionService(prisma, factStore, budget, invokeModel);
  return { service, factStore, budget, invokeModel, writeMock, usageCreateMock, prisma };
}

describe('FactExtractionService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('extracts and writes a fact from a clean batch', async () => {
    const s = makeSetup({});

    const written = await s.service.processBatch(job);

    expect(written).toBe(1);
    // Assert the seam: scope + statement + provenance cross to the store.
    expect(s.writeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        personalityId: PERSONALITY,
        personaId: PERSONA_A,
        statement: "Alice's cat is named Miso",
        sourceMemoryIds: [MEM(1), MEM(2)],
        extractionJobId: generateFactExtractionJobUuid('chan-1', PERSONALITY, MEM(1)),
      }),
      [],
      expect.any(Array)
    );
  });

  it('budget denial skips the group BEFORE any model call (tripwire order)', async () => {
    const s = makeSetup({ budgetAllowed: false });

    const written = await s.service.processBatch(job);

    expect(written).toBe(0);
    expect(s.invokeModel).not.toHaveBeenCalled();
    expect(s.writeMock).not.toHaveBeenCalled();
  });

  it('fail-to-skip: malformed JSON writes nothing', async () => {
    const s = makeSetup({ modelResponse: 'sorry, I cannot do that' });

    const written = await s.service.processBatch(job);

    expect(written).toBe(0);
    expect(s.writeMock).not.toHaveBeenCalled();
  });

  it('fail-to-skip: schema-invalid response writes nothing', async () => {
    const s = makeSetup({
      modelResponse: JSON.stringify({ facts: [{ statement: '', salience: 5 }] }),
    });

    const written = await s.service.processBatch(job);

    expect(written).toBe(0);
    expect(s.writeMock).not.toHaveBeenCalled();
  });

  it('fail-to-skip: model error writes nothing and does not throw', async () => {
    const s = makeSetup({ modelResponse: new Error('provider 500') });

    await expect(s.service.processBatch(job)).resolves.toBe(0);
  });

  it('resolves an LLM-named supersession index to the known fact id', async () => {
    const known = [
      {
        id: 'fact-old-1',
        statement: 'Alice has no pets',
        entityTags: ['user:alice'],
        isLocked: false,
      },
    ];
    const s = makeSetup({
      knownFacts: known,
      modelResponse: JSON.stringify({
        facts: [
          {
            statement: "Alice's cat is named Miso",
            entityTags: ['user:alice'],
            salience: 0.7,
            supersedesIndex: 0,
          },
        ],
      }),
    });

    await s.service.processBatch(job);

    expect(s.writeMock).toHaveBeenCalledWith(expect.anything(), ['fact-old-1'], expect.any(Array));
  });

  it('ignores an out-of-range supersession index (model noise, not a crash)', async () => {
    const s = makeSetup({
      knownFacts: [{ id: 'fact-old-1', statement: 'x', entityTags: [], isLocked: false }],
      modelResponse: JSON.stringify({
        facts: [
          {
            statement: 'New fact',
            entityTags: ['user:alice'],
            salience: 0.5,
            supersedesIndex: 7,
          },
        ],
      }),
    });

    await s.service.processBatch(job);

    expect(s.writeMock).toHaveBeenCalledWith(expect.anything(), [], expect.any(Array));
  });

  it('never auto-supersedes a LOCKED fact — by index or by similarity', async () => {
    const s = makeSetup({
      knownFacts: [
        {
          id: 'locked-fact',
          statement: 'Protected fact',
          entityTags: ['user:alice'],
          isLocked: true,
        },
      ],
      similarFacts: [
        {
          id: 'locked-similar',
          statement: 'Alice has a cat',
          entityTags: ['user:alice'],
          similarity: 0.95,
          isLocked: true,
        },
      ],
      modelResponse: JSON.stringify({
        facts: [
          {
            statement: "Alice's cat is named Miso",
            entityTags: ['user:alice'],
            salience: 0.7,
            supersedesIndex: 0, // names the locked fact — must be ignored
          },
        ],
      }),
    });

    await s.service.processBatch(job);

    expect(s.writeMock).toHaveBeenCalledWith(expect.anything(), [], expect.any(Array));
  });

  it('never auto-supersedes a user-authored CORRECTED fact — by index or by similarity', async () => {
    // Corrections are unlocked (no unlock ceremony to re-correct), so the TIER
    // is the shield that must hold at target-resolution time.
    const s = makeSetup({
      knownFacts: [
        {
          id: 'corrected-fact',
          statement: 'User-corrected fact',
          entityTags: ['user:alice'],
          isLocked: false,
          tier: 'corrected',
        },
      ],
      similarFacts: [
        {
          id: 'corrected-similar',
          statement: 'Alice has a cat',
          entityTags: ['user:alice'],
          similarity: 0.95,
          isLocked: false,
          tier: 'corrected',
        },
      ],
      modelResponse: JSON.stringify({
        facts: [
          {
            statement: "Alice's cat is named Miso",
            entityTags: ['user:alice'],
            salience: 0.7,
            supersedesIndex: 0, // names the corrected fact — must be ignored
          },
        ],
      }),
    });

    await s.service.processBatch(job);

    expect(s.writeMock).toHaveBeenCalledWith(expect.anything(), [], expect.any(Array));
  });

  it('similarity fallback supersedes only above-threshold candidates WITH entity overlap', async () => {
    const s = makeSetup({
      similarFacts: [
        {
          id: 'similar-overlap',
          statement: 'Alice has a cat',
          entityTags: ['user:alice'],
          similarity: 0.93,
          isLocked: false,
        },
        {
          id: 'similar-wrong-entity',
          statement: 'Bob has a cat',
          entityTags: ['user:bob'],
          similarity: 0.92,
          isLocked: false,
        },
        {
          id: 'similar-below-threshold',
          statement: 'Alice enjoys gardening',
          entityTags: ['user:alice'],
          similarity: 0.5,
          isLocked: false,
        },
      ],
    });

    await s.service.processBatch(job);

    expect(s.writeMock).toHaveBeenCalledWith(
      expect.anything(),
      ['similar-overlap'],
      expect.any(Array)
    );
  });

  it('groups a multi-persona batch and extracts per scope', async () => {
    const s = makeSetup({
      episodes: [
        { id: MEM(1), content: 'a', personaId: PERSONA_A, isFiction: false },
        { id: MEM(2), content: 'b', personaId: PERSONA_B, isFiction: false },
      ],
    });

    await s.service.processBatch(job);

    expect(s.invokeModel).toHaveBeenCalledTimes(2);
    const scopes = vi.mocked(s.factStore.getRecentActiveFacts).mock.calls.map(c => c[1] as string);
    expect(scopes).toEqual(expect.arrayContaining([PERSONA_A, PERSONA_B]));

    // Provenance is GROUP-scoped: persona A's fact must not carry persona B's
    // episode ids (they merely share the batch window).
    const provenanceByPersona = s.writeMock.mock.calls.map(c => ({
      personaId: (c[0] as { personaId: string }).personaId,
      sourceMemoryIds: (c[0] as { sourceMemoryIds: string[] }).sourceMemoryIds,
    }));
    expect(provenanceByPersona).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ personaId: PERSONA_A, sourceMemoryIds: [MEM(1)] }),
        expect.objectContaining({ personaId: PERSONA_B, sourceMemoryIds: [MEM(2)] }),
      ])
    );
  });

  it('one bad fact write does not abort the rest of the group', async () => {
    const s = makeSetup({
      modelResponse: JSON.stringify({
        facts: [
          { statement: 'Fact one', entityTags: ['user:a'], salience: 0.5, supersedesIndex: null },
          { statement: 'Fact two', entityTags: ['user:a'], salience: 0.5, supersedesIndex: null },
        ],
      }),
    });
    s.writeMock.mockRejectedValueOnce(new Error('unique violation')).mockResolvedValue('id-2');

    const written = await s.service.processBatch(job);

    expect(written).toBe(1);
    expect(s.writeMock).toHaveBeenCalledTimes(2);
  });
});

describe('hasEntityOverlap', () => {
  it('matches case-insensitively and requires both sides non-empty', () => {
    expect(hasEntityOverlap(['user:Alice'], ['user:alice'])).toBe(true);
    expect(hasEntityOverlap(['user:alice'], ['user:bob'])).toBe(false);
    expect(hasEntityOverlap([], ['user:alice'])).toBe(false);
    expect(hasEntityOverlap(['user:alice'], [])).toBe(false);
  });
});

describe('extraction usage rows (cost visibility)', () => {
  it("writes one usage_logs row per model call, attributed to the persona's owner", async () => {
    const s = makeSetup({});

    await s.service.processBatch(job);

    expect(s.usageCreateMock).toHaveBeenCalledTimes(1);
    expect(s.usageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-uuid-1',
          provider: 'openrouter',
          requestType: 'fact_extraction',
          tokensIn: 120,
          tokensOut: 40,
        }),
      })
    );
  });

  it("carries the invoker's ACTUAL provider into the row (no independent re-resolution)", async () => {
    const s = makeSetup({});
    // An injected invoker (eval harness, future routing) may bill a different
    // provider than a fresh config resolution would claim — the row must
    // reflect what was billed, not what config says now.
    s.invokeModel.mockResolvedValue({
      content: JSON.stringify({ facts: [] }),
      tokensIn: 10,
      tokensOut: 2,
      provider: 'zai-coding',
    });

    await s.service.processBatch(job);

    expect(s.usageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: 'zai-coding' }) })
    );
  });

  it('a usage-row failure never costs the extraction batch (fail-soft)', async () => {
    const s = makeSetup({});
    s.usageCreateMock.mockRejectedValue(new Error('db hiccup'));

    const written = await s.service.processBatch(job);

    expect(written).toBeGreaterThan(0); // facts still written
  });

  it('skips the usage row (without failing) when the persona has no owner row', async () => {
    const s = makeSetup({});
    (
      s.prisma as unknown as { persona: { findUnique: ReturnType<typeof vi.fn> } }
    ).persona.findUnique.mockResolvedValue(null);

    const written = await s.service.processBatch(job);

    expect(s.usageCreateMock).not.toHaveBeenCalled();
    expect(written).toBeGreaterThan(0);
  });

  it('writes NO usage row when the model call itself failed', async () => {
    const s = makeSetup({ modelResponse: new Error('model down') });

    await s.service.processBatch(job);

    expect(s.usageCreateMock).not.toHaveBeenCalled();
  });
});

describe('delay-not-downgrade (provider busy)', () => {
  function rejectingSetup(status: number, message: string) {
    return makeSetup({
      modelResponse: Object.assign(new Error(message), { status }),
    });
  }

  it('a 429 (rate limit) THROWS ExtractionProviderBusyError instead of skipping', async () => {
    const s = rejectingSetup(429, 'Too many requests');
    await expect(s.service.processBatch(job)).rejects.toThrow(ExtractionProviderBusyError);
    expect(s.writeMock).not.toHaveBeenCalled();
    expect(s.usageCreateMock).not.toHaveBeenCalled(); // busy batches never count usage
  });

  it('multi-persona batch: only UNFINISHED groups ride the requeue — completed groups are never re-billed', async () => {
    // Group A (mem 1-2) succeeds; group B (mem 3) hits the busy provider. The
    // rethrown error must carry ONLY group B's ids — this is the guarantee
    // that a sustained busy window can't re-bill already-extracted groups on
    // every 30-min retry.
    const s = makeSetup({
      episodes: [
        { id: MEM(1), content: '{user}: my cat is Miso', personaId: PERSONA_A, isFiction: false },
        { id: MEM(2), content: '{user}: I love tea', personaId: PERSONA_A, isFiction: false },
        {
          id: MEM(3),
          content: '{user}: I moved to Berlin',
          personaId: PERSONA_B,
          isFiction: false,
        },
      ],
    });
    s.invokeModel
      .mockResolvedValueOnce({
        content: JSON.stringify({ facts: [] }),
        tokensIn: 50,
        tokensOut: 5,
        provider: 'openrouter',
      })
      .mockRejectedValueOnce(Object.assign(new Error('Too many requests'), { status: 429 }));

    const multiJob = { ...job, sourceMemoryIds: [MEM(1), MEM(2), MEM(3)] };
    await expect(s.service.processBatch(multiJob)).rejects.toMatchObject({
      name: 'ExtractionProviderBusyError',
      remainingMemoryIds: [MEM(3)],
    });

    // Group A's completed call billed usage once; group B's busy call did not.
    expect(s.usageCreateMock).toHaveBeenCalledTimes(1);
    // Only the busy group's consume is refunded — group A's spend stands.
    expect(s.budget.tryConsume).toHaveBeenCalledTimes(2);
    expect(s.budget.refund).toHaveBeenCalledTimes(1);
  });

  it('busy REFUNDS the consumed budget unit — retries of a sustained window are budget-neutral', async () => {
    const s = rejectingSetup(429, 'Too many requests');
    await expect(s.service.processBatch(job)).rejects.toThrow(ExtractionProviderBusyError);
    // Without the refund, each 30-min requeue burns a unit for zero facts and
    // the tripwire eventually skips REAL batches after the provider recovers.
    expect(s.budget.tryConsume).toHaveBeenCalledTimes(1);
    expect(s.budget.refund).toHaveBeenCalledTimes(1);
    expect(s.budget.refund).toHaveBeenCalledWith(PERSONALITY);
  });

  it('a 5xx THROWS busy (transient — the batch delays rather than losing facts)', async () => {
    const s = rejectingSetup(503, 'Service overloaded');
    await expect(s.service.processBatch(job)).rejects.toThrow(ExtractionProviderBusyError);
    expect(s.budget.refund).toHaveBeenCalledTimes(1);
  });

  it('a 402 (quota) THROWS busy — deliberate divergence from the completions fail-fast', async () => {
    // Completions fail fast on QUOTA_EXCEEDED (a user is waiting); extraction
    // delays instead, because fail-to-skip would LOSE the batch's facts on a
    // state a human fixes by topping up.
    const s = rejectingSetup(402, 'Payment required');
    await expect(s.service.processBatch(job)).rejects.toThrow(ExtractionProviderBusyError);
    expect(s.budget.refund).toHaveBeenCalledTimes(1);
  });

  it('account-level credit exhaustion (402 sub-classified) also delays — the drained-key shape', async () => {
    const s = rejectingSetup(402, 'Insufficient credits. Add more using https://openrouter.ai');
    await expect(s.service.processBatch(job)).rejects.toThrow(ExtractionProviderBusyError);
    expect(s.usageCreateMock).not.toHaveBeenCalled();
  });

  it('a permanent 400 keeps fail-to-skip (writes nothing, does not throw)', async () => {
    const s = rejectingSetup(400, 'Invalid API parameter');
    const written = await s.service.processBatch(job);
    expect(written).toBe(0);
    // Permanent failures spent the attempt legitimately — no refund.
    expect(s.budget.refund).not.toHaveBeenCalled();
  });
});

describe('resolveExtractionProvider', () => {
  it('defaults to OpenRouter with no key attached', () => {
    const route = resolveExtractionProvider();
    expect(route).toEqual({ provider: 'openrouter' });
  });
});
