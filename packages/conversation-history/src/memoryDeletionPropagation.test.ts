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

import { propagateDeletionToMemories } from './memoryDeletionPropagation.js';

function makePrisma(overrides: { updateCount?: number; lockedCount?: number } = {}) {
  const updateMany = vi.fn().mockResolvedValue({ count: overrides.updateCount ?? 1 });
  const count = vi.fn().mockResolvedValue(overrides.lockedCount ?? 0);
  return {
    prisma: { memory: { updateMany, count } } as unknown as PrismaClient,
    updateMany,
    count,
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
});
