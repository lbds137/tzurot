import { describe, it, expect, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  findPendingOffDbRows,
  recordPurgeFailure,
  recordPurgeSuccess,
  settleOffDb,
} from './purgeAudit.js';

function makeTx() {
  const create = vi.fn().mockResolvedValue({ id: 'audit-1' });
  return { tx: { retentionPurgeLog: { create } } as never, create };
}

function makePrisma(rows: unknown[] = []) {
  const create = vi.fn().mockResolvedValue({ id: 'audit-1' });
  const update = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue(rows);
  return {
    prisma: { retentionPurgeLog: { create, update, findMany } } as unknown as PrismaClient,
    create,
    update,
    findMany,
  };
}

describe('recordPurgeSuccess', () => {
  it('writes a pending row carrying the slugs the retry sweep needs', async () => {
    const { tx, create } = makeTx();

    const id = await recordPurgeSuccess(tx, {
      targetDiscordId: '900000000000000001',
      runContext: 'ops retention:purge (prod)',
      deletionCounts: { characters: 2 },
      offDbPending: { characterSlugs: ['alpha', 'beta'] },
    });

    expect(id).toBe('audit-1');
    expect(create).toHaveBeenCalledWith({
      data: {
        targetDiscordId: '900000000000000001',
        runContext: 'ops retention:purge (prod)',
        deletionCounts: { characters: 2 },
        dbOutcome: 'success',
        // 'pending', not 'done': the off-DB work has not run yet at this point
        // (this write is inside the erasure transaction), so a crash right
        // after commit must leave the row in the retry queue.
        offDbReconciled: 'pending',
        offDbPending: { characterSlugs: ['alpha', 'beta'] },
      },
      select: { id: true },
    });
  });
});

describe('recordPurgeFailure', () => {
  it('records a terminal row — a rolled-back purge owes no off-DB work', async () => {
    const { prisma, create } = makePrisma();

    await recordPurgeFailure(prisma, '900000000000000001', 'run-1', 'transaction timeout');

    expect(create).toHaveBeenCalledWith({
      data: {
        targetDiscordId: '900000000000000001',
        runContext: 'run-1',
        deletionCounts: { failureReason: 'transaction timeout' },
        dbOutcome: 'failed',
        // Born 'done': nothing was deleted, so there is no avatar to unlink.
        // A 'pending' here would put an un-drainable row in the retry queue.
        offDbReconciled: 'done',
        offDbPending: Prisma.DbNull,
      },
    });
  });
});

describe('settleOffDb', () => {
  it('clears the pending payload on success so the ledger stops holding slugs', async () => {
    const { prisma, update } = makePrisma();

    await settleOffDb(prisma, 'audit-1', 'done');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'audit-1' },
      data: { offDbReconciled: 'done', offDbPending: Prisma.DbNull },
    });
  });

  it('KEEPS the pending payload on failure — it is the retry input', async () => {
    const { prisma, update } = makePrisma();

    await settleOffDb(prisma, 'audit-1', 'failed');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'audit-1' },
      data: { offDbReconciled: 'failed' },
    });
  });
});

describe('findPendingOffDbRows', () => {
  it('queries only committed purges whose off-DB work is unsettled', async () => {
    const { prisma, findMany } = makePrisma();

    await findPendingOffDbRows(prisma);

    // db_outcome filter matters: a 'failed' row is terminal by construction, so
    // including it would make the sweep retry a row that can never settle.
    expect(findMany.mock.calls[0][0].where).toEqual({
      dbOutcome: 'success',
      offDbReconciled: { not: 'done' },
    });
  });

  it('extracts the slugs from the stored JSON', async () => {
    const { prisma } = makePrisma([
      { id: 'a1', targetDiscordId: '900000000000000001', offDbPending: { characterSlugs: ['x'] } },
    ]);

    const rows = await findPendingOffDbRows(prisma);

    expect(rows).toEqual([
      { id: 'a1', targetDiscordId: '900000000000000001', characterSlugs: ['x'] },
    ]);
  });

  it('degrades a malformed payload to "nothing to retry" instead of throwing', async () => {
    // The column is Json?, so nothing type-checks its contents. One bad row
    // must not take down the sweep for every well-formed row behind it.
    const { prisma } = makePrisma([
      { id: 'a1', targetDiscordId: '900000000000000001', offDbPending: null },
      { id: 'a2', targetDiscordId: '900000000000000002', offDbPending: 'not-an-object' },
      { id: 'a3', targetDiscordId: '900000000000000003', offDbPending: { characterSlugs: 'nope' } },
      {
        id: 'a4',
        targetDiscordId: '900000000000000004',
        offDbPending: { characterSlugs: ['good', 42, null] },
      },
    ]);

    const rows = await findPendingOffDbRows(prisma);

    expect(rows.map(row => row.characterSlugs)).toEqual([[], [], [], ['good']]);
  });
});
