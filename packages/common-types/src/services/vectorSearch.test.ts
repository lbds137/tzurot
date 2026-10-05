import { describe, it, expect, vi } from 'vitest';
import { Prisma, type PrismaClient } from './prisma.js';
import { PGVECTOR_SEARCH } from '../constants/pgvector.js';
import { queryRawWithExactVectorSearch } from './vectorSearch.js';

describe('queryRawWithExactVectorSearch', () => {
  it('runs set_config and the query in ONE transaction, in that order, and returns the rows', async () => {
    const SET_SENTINEL = { op: 'set' };
    const QUERY_SENTINEL = { op: 'query' };
    const rows = [{ id: 'a' }, { id: 'b' }];
    const prisma = {
      $executeRaw: vi.fn().mockReturnValue(SET_SENTINEL),
      $queryRaw: vi.fn().mockReturnValue(QUERY_SENTINEL),
      $transaction: vi.fn().mockResolvedValue([1, rows]),
    } as unknown as PrismaClient;
    const query = Prisma.sql`SELECT id FROM memories WHERE embedding <=> ${'[1,2]'}::vector`;

    const result = await queryRawWithExactVectorSearch<{ id: string }[]>(prisma, query);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith([SET_SENTINEL, QUERY_SENTINEL]);

    const [strings, ...values] = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown as [
      string[],
      ...unknown[],
    ];
    const joined = strings.join('?');
    expect(joined).toContain("set_config('ivfflat.probes'");
    expect(joined).toContain(', true)');
    expect(values).toEqual([String(PGVECTOR_SEARCH.IVFFLAT_PROBES)]);

    expect(prisma.$queryRaw).toHaveBeenCalledWith(query);
    expect(result).toBe(rows);
  });
});
