import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { pruneEmptyPersonalityConfig } from './pruneEmptyPersonalityConfig.js';

const deleteMany = vi.fn();
const prisma = {
  userPersonalityConfig: { deleteMany },
} as unknown as PrismaClient;

describe('pruneEmptyPersonalityConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues one atomic delete whose WHERE carries every all-null slice', async () => {
    deleteMany.mockResolvedValue({ count: 1 });

    const pruned = await pruneEmptyPersonalityConfig(prisma, 'row-1');

    expect(pruned).toBe(true);
    // The WHERE is the whole safety story: the id AND all five slices must be
    // in the predicate (atomicity), and the JSONB slice must use AnyNull so
    // both never-set (SQL NULL) and cleared (Prisma.JsonNull) rows match.
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'row-1',
        personaId: null,
        llmConfigId: null,
        visionConfigId: null,
        ttsConfigId: null,
        configOverrides: { equals: Prisma.AnyNull },
      },
    });
  });

  it('reports false when zero rows matched (non-empty row or already gone)', async () => {
    deleteMany.mockResolvedValue({ count: 0 });

    const pruned = await pruneEmptyPersonalityConfig(prisma, 'row-1');

    expect(pruned).toBe(false);
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });
});
