import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

// Hoisted (not fresh per call) so assertions can reach them: several branches
// in this module have NO observable except their log line — the swallowed
// failure and the locked-retention warning both return undefined either way, so
// a test that only checks the return value cannot tell them from silence.
const { mockInfo, mockWarn, mockError } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockWarn: vi.fn(),
  mockError: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: mockInfo, warn: mockWarn, error: mockError }),
  };
});

import {
  propagateDeletionToFacts,
  propagateDeletionToMemories,
} from './memoryDeletionPropagation.js';

function makePrisma(
  overrides: {
    updateCount?: number;
    lockedCount?: number;
    factsRetired?: number;
    curationRetained?: number;
  } = {}
) {
  const updateMany = vi.fn().mockResolvedValue({ count: overrides.updateCount ?? 1 });
  const count = vi.fn().mockResolvedValue(overrides.lockedCount ?? 0);
  const $executeRaw = vi.fn().mockResolvedValue(overrides.factsRetired ?? 0);
  const $queryRaw = vi.fn().mockResolvedValue([{ count: overrides.curationRetained ?? 0 }]);
  return {
    prisma: { memory: { updateMany, count }, $executeRaw, $queryRaw } as unknown as PrismaClient,
    updateMany,
    count,
    $executeRaw,
    $queryRaw,
  };
}

describe('propagateDeletionToMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('soft-deletes the memories linked to the deleted turns', async () => {
    const { prisma, updateMany } = makePrisma();

    await propagateDeletionToMemories(prisma, ['m1', 'm2']);

    expect(updateMany).toHaveBeenCalledWith({
      where: { messageIds: { hasSome: ['m1', 'm2'] }, visibility: 'normal', isLocked: false },
      // 'deleted' is the visibility the RAG retrieval filter excludes — a HARD
      // delete here would break the memory's own undo/browse surfaces.
      data: { visibility: 'deleted' },
    });
  });

  it('never touches locked memories — a user pin outranks source deletion', async () => {
    const { prisma, updateMany } = makePrisma();

    await propagateDeletionToMemories(prisma, ['m1']);

    expect(updateMany.mock.calls[0][0].where.isLocked).toBe(false);
  });

  it('does nothing when there are no ids to propagate', async () => {
    const { prisma, updateMany, count } = makePrisma();

    await propagateDeletionToMemories(prisma, []);
    await propagateDeletionToMemories(prisma, ['']);

    expect(updateMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  describe('the locked-retention warning', () => {
    it('counts exactly the locked, still-normal memories for those turns', async () => {
      const { prisma, count } = makePrisma({ lockedCount: 2 });

      await propagateDeletionToMemories(prisma, ['m1']);

      // The mirror image of the update's filter. If this query drifted — wrong
      // isLocked, wrong visibility, missing id scope — the warning would report
      // a number that means something else, and the pin-vs-deletion tension it
      // exists to surface would go quiet or cry wolf.
      expect(count).toHaveBeenCalledWith({
        where: { messageIds: { hasSome: ['m1'] }, visibility: 'normal', isLocked: true },
      });
    });

    it('warns, with the count, when pinned memories survive a source deletion', async () => {
      const { prisma } = makePrisma({ lockedCount: 3 });

      await propagateDeletionToMemories(prisma, ['m1']);

      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(mockWarn.mock.calls[0][0]).toMatchObject({ lockedRetained: 3 });
    });

    it('stays quiet when nothing was pinned — the warning must mean something', async () => {
      const { prisma } = makePrisma({ lockedCount: 0 });

      await propagateDeletionToMemories(prisma, ['m1']);

      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe('the propagation log', () => {
    it('reports how many memories were retired', async () => {
      const { prisma } = makePrisma({ updateCount: 4 });

      await propagateDeletionToMemories(prisma, ['m1']);

      expect(mockInfo).toHaveBeenCalledTimes(1);
      expect(mockInfo.mock.calls[0][0]).toMatchObject({ memoriesDeleted: 4 });
    });

    it('stays quiet when the deletion touched no memories', async () => {
      // The common case by far — most turns produce no memory at all. Logging
      // a zero on every purged batch would bury the lines that matter.
      const { prisma } = makePrisma({ updateCount: 0 });

      await propagateDeletionToMemories(prisma, ['m1']);

      expect(mockInfo).not.toHaveBeenCalled();
    });
  });

  it('swallows a failure — but LOGS it, so the miss is not silent', async () => {
    // Non-fatal by design: failing the caller's whole deletion because the
    // derived-memory cleanup stumbled is a worse outcome than a logged miss.
    // The log is the entire difference between "handled" and "swallowed" —
    // without asserting it, an empty catch block would pass this test.
    const { prisma } = makePrisma();
    (prisma.memory.updateMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));

    await expect(propagateDeletionToMemories(prisma, ['m1'])).resolves.toBeUndefined();

    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockError.mock.calls[0][0]).toMatchObject({ err: expect.any(Error) });
  });

  describe('the fact-layer cascade', () => {
    it('runs the fact cascade when memories were retired', async () => {
      const { prisma, $executeRaw } = makePrisma({ updateCount: 2 });

      await propagateDeletionToMemories(prisma, ['m1']);

      expect($executeRaw).toHaveBeenCalledTimes(1);
    });

    it('skips the fact cascade when the deletion touched no memories', async () => {
      // Most turns produce no memory; a fact sweep per no-op deletion would be
      // pure overhead on the message-delete sync path.
      const { prisma, $executeRaw } = makePrisma({ updateCount: 0 });

      await propagateDeletionToMemories(prisma, ['m1']);

      expect($executeRaw).not.toHaveBeenCalled();
    });
  });
});

describe('propagateDeletionToFacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports retired and curation-retained counts when the cascade fired', async () => {
    const { prisma } = makePrisma({ factsRetired: 3, curationRetained: 2 });

    await propagateDeletionToFacts(prisma);

    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo.mock.calls[0][0]).toMatchObject({ factsRetired: 3, curationRetained: 2 });
  });

  it('stays quiet — and skips the retained count — when nothing was retired', async () => {
    // Curation-retained rows persist across invocations; counting and logging
    // them on every no-op sweep would repeat the same warning forever.
    const { prisma, $queryRaw } = makePrisma({ factsRetired: 0 });

    await propagateDeletionToFacts(prisma);

    expect(mockInfo).not.toHaveBeenCalled();
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('swallows a failure — but LOGS it, so the miss is not silent', async () => {
    const { prisma, $executeRaw } = makePrisma();
    $executeRaw.mockRejectedValue(new Error('db down'));

    await expect(propagateDeletionToFacts(prisma)).resolves.toBeUndefined();

    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockError.mock.calls[0][0]).toMatchObject({ err: expect.any(Error) });
  });

  describe('SQL shape', () => {
    it("the fact cascade's predicate honors the curation carve-outs", async () => {
      // These carve-outs are the documented contract — user curation outranks
      // the cascade — and they are invisible in the return value.
      const { prisma, $executeRaw } = makePrisma();

      await propagateDeletionToFacts(prisma);

      const [sql] = $executeRaw.mock.calls[0] as unknown[];
      const sqlText = Array.isArray(sql) ? sql.join('?') : String(sql);

      expect(sqlText).toContain('memory_facts');
      expect(sqlText).toContain('is_locked = false');
      expect(sqlText).toContain("tier <> 'corrected'");
      expect(sqlText).toContain('source_memory_ids');
    });

    it('the curation-retained count uses the locked-or-corrected predicate', async () => {
      const { prisma, $queryRaw } = makePrisma({ factsRetired: 3 });

      await propagateDeletionToFacts(prisma);

      const [sql] = $queryRaw.mock.calls[0] as unknown[];
      const sqlText = Array.isArray(sql) ? sql.join('?') : String(sql);

      expect(sqlText).toContain('COUNT(*)');
      expect(sqlText).toContain("is_locked = true OR tier = 'corrected'");
    });
  });
});
