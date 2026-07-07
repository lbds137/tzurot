import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';
import { NullVectorReembedder } from './NullVectorReembedder.js';

function makePrisma(rows: { id: string; content: string }[]): PrismaClient {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) } as unknown as PrismaClient;
}

function makeAdapter(
  impl?: (id: string) => Promise<boolean>
): PgvectorMemoryAdapter & { reembedMemory: ReturnType<typeof vi.fn> } {
  return {
    reembedMemory: vi.fn(impl ?? (() => Promise.resolve(true))),
  } as unknown as PgvectorMemoryAdapter & { reembedMemory: ReturnType<typeof vi.fn> };
}

describe('NullVectorReembedder', () => {
  it('re-embeds every NULL-vector row in the batch', async () => {
    const rows = [
      { id: 'mem-1', content: 'first orphaned memory' },
      { id: 'mem-2', content: 'second orphaned memory' },
    ];
    const adapter = makeAdapter();
    const sweeper = new NullVectorReembedder(makePrisma(rows), adapter);

    const stats = await sweeper.sweep();

    expect(stats).toEqual({ scanned: 2, reembedded: 2, failed: 0 });
    // Seam: id + content cross to the adapter for each row.
    expect(adapter.reembedMemory).toHaveBeenCalledWith('mem-1', 'first orphaned memory');
    expect(adapter.reembedMemory).toHaveBeenCalledWith('mem-2', 'second orphaned memory');
  });

  it('is idempotent-by-shape: a concurrently-healed row (update returns false) is not a failure', async () => {
    const adapter = makeAdapter(id => Promise.resolve(id !== 'mem-1'));
    const sweeper = new NullVectorReembedder(
      makePrisma([
        { id: 'mem-1', content: 'healed concurrently' },
        { id: 'mem-2', content: 'still orphaned' },
      ]),
      adapter
    );

    const stats = await sweeper.sweep();

    expect(stats).toEqual({ scanned: 2, reembedded: 1, failed: 0 });
  });

  it('a failing row counts as failed and does not abort the batch', async () => {
    const adapter = makeAdapter(id =>
      id === 'mem-1' ? Promise.reject(new Error('embed down')) : Promise.resolve(true)
    );
    const sweeper = new NullVectorReembedder(
      makePrisma([
        { id: 'mem-1', content: 'a' },
        { id: 'mem-2', content: 'b' },
      ]),
      adapter
    );

    const stats = await sweeper.sweep();

    expect(stats).toEqual({ scanned: 2, reembedded: 1, failed: 1 });
  });

  it('no-ops cleanly with no rows or no memory manager', async () => {
    const empty = new NullVectorReembedder(makePrisma([]), makeAdapter());
    await expect(empty.sweep()).resolves.toEqual({ scanned: 0, reembedded: 0, failed: 0 });

    const noManager = new NullVectorReembedder(makePrisma([{ id: 'x', content: 'y' }]));
    await expect(noManager.sweep()).resolves.toEqual({ scanned: 0, reembedded: 0, failed: 0 });
  });
});
