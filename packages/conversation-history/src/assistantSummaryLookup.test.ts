import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { findUsableAssistantSummariesByTriggerIds } from './assistantSummaryLookup.js';

function makePrisma(
  rows: { messageIds: string[]; assistantSummary: string | null; createdAt: Date }[]
) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return {
    prisma: { memory: { findMany } } as unknown as PrismaClient,
    findMany,
  };
}

describe('findUsableAssistantSummariesByTriggerIds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty Map without querying when the id list is empty', async () => {
    const { prisma, findMany } = makePrisma([]);

    const result = await findUsableAssistantSummariesByTriggerIds(prisma, 'p1', [], 10);

    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns an empty Map without querying when every id is blank', async () => {
    const { prisma, findMany } = makePrisma([]);

    const result = await findUsableAssistantSummariesByTriggerIds(prisma, 'p1', [''], 10);

    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('asserts the exact where clause — visibility normal, chunkGroupId null, and no summaryStatus filter (C4 canary home)', async () => {
    const { prisma, findMany } = makePrisma([]);

    await findUsableAssistantSummariesByTriggerIds(prisma, 'p1', ['m1', 'm2'], 10);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          personalityId: 'p1',
          messageIds: { hasSome: ['m1', 'm2'] },
          visibility: 'normal',
          chunkGroupId: null,
          AND: [{ assistantSummary: { not: null } }, { assistantSummary: { not: '' } }],
        },
      })
    );
    const callArg = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(callArg.where).not.toHaveProperty('summaryStatus');
  });

  it('returns the stored summary for a failed row and excludes non-normal visibility or empty summary', async () => {
    const findMany = vi
      .fn()
      .mockImplementation(
        ({ where }: { where: { visibility?: string; summaryStatus?: string } }) => {
          if (where.summaryStatus !== undefined || where.visibility !== 'normal') {
            return Promise.resolve([]);
          }
          return Promise.resolve([
            {
              messageIds: ['m-failed'],
              assistantSummary: 'stored summary from prior done run',
              createdAt: new Date('2026-01-02'),
            },
            {
              messageIds: ['m-empty'],
              assistantSummary: '',
              createdAt: new Date('2026-01-01'),
            },
          ]);
        }
      );
    const prisma = { memory: { findMany } } as unknown as PrismaClient;

    const result = await findUsableAssistantSummariesByTriggerIds(
      prisma,
      'p1',
      ['m-failed', 'm-empty'],
      10
    );

    expect(result.get('m-failed')).toBe('stored summary from prior done run');
    expect(result.has('m-empty')).toBe(false);
  });

  it('forwards the take limit', async () => {
    const { prisma, findMany } = makePrisma([]);

    await findUsableAssistantSummariesByTriggerIds(prisma, 'p1', ['m1'], 42);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 42 }));
  });

  it('excludes a row whose assistantSummary is null', async () => {
    const { prisma } = makePrisma([
      { messageIds: ['m1'], assistantSummary: null, createdAt: new Date('2026-01-01') },
    ]);

    const result = await findUsableAssistantSummariesByTriggerIds(prisma, 'p1', ['m1'], 10);

    expect(result.size).toBe(0);
  });

  it('excludes a row whose assistantSummary is an empty string', async () => {
    const { prisma } = makePrisma([
      { messageIds: ['m1'], assistantSummary: '', createdAt: new Date('2026-01-01') },
    ]);

    const result = await findUsableAssistantSummariesByTriggerIds(prisma, 'p1', ['m1'], 10);

    expect(result.size).toBe(0);
  });

  it('maps only the REQUESTED ids from a row with several messageIds', async () => {
    const { prisma } = makePrisma([
      {
        messageIds: ['m1', 'm2', 'm3'],
        assistantSummary: 'summary text',
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const result = await findUsableAssistantSummariesByTriggerIds(prisma, 'p1', ['m1', 'm3'], 10);

    expect(result.size).toBe(2);
    expect(result.get('m1')).toBe('summary text');
    expect(result.get('m3')).toBe('summary text');
    expect(result.has('m2')).toBe(false);
  });

  it('the newest row wins for the same id, and the query orders newest-first', async () => {
    // Rows arrive newest-first, which is what `orderBy createdAt desc` yields.
    // The mock ignores `orderBy`, so the explicit orderBy assertion is the only
    // thing at this tier that can see the ordering flip.
    const { prisma, findMany } = makePrisma([
      { messageIds: ['m1'], assistantSummary: 'newer summary', createdAt: new Date('2026-01-02') },
      { messageIds: ['m1'], assistantSummary: 'older summary', createdAt: new Date('2026-01-01') },
    ]);

    const result = await findUsableAssistantSummariesByTriggerIds(prisma, 'p1', ['m1'], 10);

    expect(result.get('m1')).toBe('newer summary');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    );
  });
});
