import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LocalEmbeddingService } from '@tzurot/embeddings';
import { FactStore, type NewFact } from './FactStore.js';
import { generateMemoryFactUuid } from '@tzurot/common-types/utils/deterministicUuid';

const PERSONALITY = '4f9b0f66-0000-4000-8000-0000000000aa';
const PERSONA = '4f9b0f66-0000-4000-8000-0000000000bb';

function makeEmbeddingService(ready = true, dims = 384): LocalEmbeddingService {
  return {
    isServiceReady: vi.fn().mockReturnValue(ready),
    getEmbedding: vi.fn().mockResolvedValue(new Float32Array(dims).fill(0.1)),
  } as unknown as LocalEmbeddingService;
}

interface PrismaMocks {
  prisma: PrismaClient;
  findManyMock: ReturnType<typeof vi.fn>;
  updateManyMock: ReturnType<typeof vi.fn>;
  transactionMock: ReturnType<typeof vi.fn>;
  executeRawMock: ReturnType<typeof vi.fn>;
}

function makePrisma(findManyRows: unknown[] = []): PrismaMocks {
  const findManyMock = vi.fn().mockResolvedValue(findManyRows);
  const updateManyMock = vi.fn().mockReturnValue({ __op: 'updateMany' });
  const executeRawMock = vi.fn().mockReturnValue({ __op: 'executeRaw' });
  const transactionMock = vi.fn().mockResolvedValue([1, { count: 1 }]);
  return {
    prisma: {
      memoryFact: { findMany: findManyMock, updateMany: updateManyMock },
      $executeRaw: executeRawMock,
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: transactionMock,
    } as unknown as PrismaClient,
    findManyMock,
    updateManyMock,
    transactionMock,
    executeRawMock,
  };
}

const baseFact: NewFact = {
  personalityId: PERSONALITY,
  personaId: PERSONA,
  statement: "Alice's cat is named Miso",
  entityTags: ['user:alice', 'pet:miso'],
  salience: 0.7,
  isFiction: false,
  sourceMemoryIds: ['4f9b0f66-0000-4000-8000-000000000001'],
  extractionJobId: 'job-1',
  validFrom: new Date('2026-05-20T00:00:00.000Z'),
};

describe('FactStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('getRecentActiveFacts', () => {
    it('queries only active, visible, non-forgotten facts in scope', async () => {
      const m = makePrisma([]);
      const store = new FactStore(m.prisma, makeEmbeddingService());

      await store.getRecentActiveFacts(PERSONALITY, PERSONA, 1500);

      expect(m.findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personalityId: PERSONALITY,
            personaId: PERSONA,
            supersededAt: null,
            forgotten: false,
            visibility: 'normal',
          },
          orderBy: { validFrom: 'desc' },
          take: 100,
        })
      );
    });

    it('trims the list to the token budget', async () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({
        id: `fact-${i}`,
        statement: 'a fairly ordinary statement about someone with several words in it',
        entityTags: [],
      }));
      const m = makePrisma(rows);
      const store = new FactStore(m.prisma, makeEmbeddingService());

      const result = await store.getRecentActiveFacts(PERSONALITY, PERSONA, 100);

      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(50);
    });
  });

  describe('writeFactWithSupersessions', () => {
    it('writes the fact and marks supersessions in ONE transaction', async () => {
      const m = makePrisma();
      const store = new FactStore(m.prisma, makeEmbeddingService());
      const supersededIds = ['4f9b0f66-0000-4000-8000-000000000002'];

      const embedding = await store.embedStatement(baseFact.statement);
      const id = await store.writeFactWithSupersessions(baseFact, supersededIds, embedding);

      // Both operations passed to a single $transaction call.
      expect(m.transactionMock).toHaveBeenCalledTimes(1);
      const ops = m.transactionMock.mock.calls[0][0] as unknown[];
      expect(ops).toHaveLength(2);

      // The supersession arm: only still-active, UNLOCKED, non-forgotten rows,
      // stamped with the new id. The lock/forgotten predicates are the
      // defense-in-depth guard — extraction must never auto-supersede a
      // user-locked or forgotten fact even if caller pre-filtering regresses.
      expect(m.updateManyMock).toHaveBeenCalledWith({
        where: {
          id: { in: supersededIds },
          supersededAt: null,
          isLocked: false,
          forgotten: false,
          tier: { not: 'corrected' },
        },
        data: { supersededAt: new Date('2026-07-06T12:00:00.000Z'), supersededById: id },
      });

      // Deterministic id: same scope + statement → same UUID.
      expect(id).toBe(generateMemoryFactUuid(PERSONALITY, PERSONA, baseFact.statement));
    });

    it('embedStatement enforces the 384-dim invariant', async () => {
      const m = makePrisma();
      const store = new FactStore(m.prisma, makeEmbeddingService(true, 128));

      await expect(store.embedStatement('x')).rejects.toThrow(/Invalid embedding dimensions/);
      expect(m.transactionMock).not.toHaveBeenCalled();
    });

    it('embedStatement refuses when the embedding service is not ready', async () => {
      const m = makePrisma();
      const store = new FactStore(m.prisma, makeEmbeddingService(false));

      await expect(store.embedStatement('x')).rejects.toThrow(/not ready/);
    });
  });
});
