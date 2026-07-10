import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { JobType } from '@tzurot/common-types/constants/queue';
import type { FactExtractionJobData } from '@tzurot/common-types/types/jobs';
import { FactExtractionService, hasEntityOverlap } from './FactExtractionService.js';
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
