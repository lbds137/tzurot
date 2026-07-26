import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  AccountDeletionService,
  RetentionIneligibleError,
  SuperuserDeletionError,
} from './AccountDeletionService.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

function makeTx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ username: 'Alice', isSuperuser: false }),
      delete: vi.fn().mockResolvedValue({}),
    },
    persona: {
      findMany: vi.fn().mockResolvedValue([{ id: 'p1', name: 'My Persona', preferredName: 'Vee' }]),
    },
    personality: {
      findMany: vi.fn().mockResolvedValue([{ id: 'x1', name: 'XBot', slug: 'xbot' }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    conversationHistory: { count: vi.fn().mockResolvedValue(3) },
    memory: { count: vi.fn().mockResolvedValue(2) },
    memoryFact: { count: vi.fn().mockResolvedValue(1) },
    pendingMemory: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    llmDiagnosticLog: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    retentionPurgeLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    ...overrides,
  };
}

/**
 * A tx `$queryRaw` for retention mode, where TWO different raw queries run in a
 * fixed order: the eligibility re-check, then the cross-user-reach lookup.
 * Sequencing them explicitly keeps a passing test from depending on one mock
 * value happening to satisfy both.
 */
function retentionQueryRaw(opts: { eligible: boolean; reach: { personalityId: string }[] }) {
  return vi
    .fn()
    .mockResolvedValueOnce(opts.eligible ? [{ eligible: true }] : [])
    .mockResolvedValue(opts.reach);
}

function makePrisma(tx: Record<string, unknown>): PrismaClient {
  return {
    $transaction: vi
      .fn()
      .mockImplementation(async (callback: (t: unknown) => Promise<unknown>) => callback(tx)),
    $queryRaw: vi.fn().mockResolvedValue([]),
    persona: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]) },
    personality: { findMany: vi.fn().mockResolvedValue([{ id: 'x1', name: 'XBot' }]) },
    conversationHistory: { count: vi.fn().mockResolvedValue(3) },
    memory: { count: vi.fn().mockResolvedValue(2) },
    memoryFact: { count: vi.fn().mockResolvedValue(1) },
    exportJob: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
}

describe('AccountDeletionService.preview', () => {
  it('returns the fixed phrase, counts, and per-character reach', async () => {
    const prisma = makePrisma(makeTx());
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
      { personalityId: 'x1', otherUsers: 2 },
    ]);

    const preview = await new AccountDeletionService(prisma).preview('user-1');

    expect(preview.confirmationPhrase).toBe('DELETE MY ACCOUNT');
    expect(preview.counts).toEqual({
      personas: 1,
      characters: 1,
      conversationMessages: 3,
      memories: 2,
      facts: 1,
    });
    expect(preview.ownedCharacters).toEqual([
      { id: 'x1', name: 'XBot', otherUsersWithMemories: 2 },
    ]);
    expect(preview.hasActiveExport).toBe(false);
  });

  it('skips the reach query entirely when the user owns no characters', async () => {
    const prisma = makePrisma(makeTx());
    (prisma.personality.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const preview = await new AccountDeletionService(prisma).preview('user-1');

    expect(preview.ownedCharacters).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('AccountDeletionService.deleteAccount', () => {
  let tx: Record<string, unknown>;
  let prisma: PrismaClient;

  beforeEach(() => {
    tx = makeTx();
    prisma = makePrisma(tx);
  });

  it('throws SuperuserDeletionError before touching any data', async () => {
    (
      tx.user as { findUniqueOrThrow: ReturnType<typeof vi.fn> }
    ).findUniqueOrThrow.mockResolvedValue({ username: 'owner', isSuperuser: true });

    await expect(
      new AccountDeletionService(prisma).deleteAccount('user-1', 'discord-1', 'self-serve')
    ).rejects.toThrow(SuperuserDeletionError);

    expect((tx.user as { delete: ReturnType<typeof vi.fn> }).delete).not.toHaveBeenCalled();
    expect(
      (tx.pendingMemory as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany
    ).not.toHaveBeenCalled();
  });

  it('builds a lowercased user: tag vocabulary from username + persona names', async () => {
    await new AccountDeletionService(prisma).deleteAccount('user-1', 'discord-1', 'self-serve');

    // $executeRaw is a template tag: call args are (strings, ...values); the
    // sweep's only interpolated value is the tag list. Call 0 is
    // SET CONSTRAINTS (no values), call 1 is the fact sweep.
    const executeCalls = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls;
    const sweepCall = executeCalls.find(call => call.length > 1);
    expect(sweepCall).toBeDefined();
    expect(sweepCall?.[1]).toEqual(
      expect.arrayContaining(['user:alice', 'user:my persona', 'user:vee'])
    );
  });

  it('sweeps pending memories in both arms and returns the full summary', async () => {
    const summary = await new AccountDeletionService(prisma).deleteAccount(
      'user-1',
      'discord-1',
      'self-serve'
    );

    const pendingWhere = (tx.pendingMemory as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany
      .mock.calls[0][0].where;
    expect(pendingWhere.OR).toEqual([
      { personaId: { in: ['p1'] } },
      { personalityId: { in: ['x1'] } },
    ]);

    const diagWhere = (tx.llmDiagnosticLog as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany
      .mock.calls[0][0].where;
    expect(diagWhere).toEqual({ userId: 'discord-1' });

    expect((tx.user as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
    expect(summary).toEqual(
      expect.objectContaining({
        personas: 1,
        characters: 1,
        conversationMessages: 3,
        memories: 2,
        facts: 1,
        pendingMemories: 2,
        diagnosticLogs: 1,
        characterNames: ['XBot'],
        characterSlugs: ['xbot'],
        characterIds: ['x1'],
      })
    );
  });
});

describe('AccountDeletionService.deleteAccount (retention mode)', () => {
  it('re-homes cross-user characters to the sentinel and excludes them from the summary + sweep scope', async () => {
    const personalityUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = makeTx({
      personality: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'x1', name: 'Shared', slug: 'shared' }, // cross-user reach → re-home
          { id: 'z1', name: 'Solo', slug: 'solo' }, // nobody else → delete
        ]),
        updateMany: personalityUpdateMany,
      },
      // Still eligible; only x1 has cross-user reach.
      $queryRaw: retentionQueryRaw({ eligible: true, reach: [{ personalityId: 'x1' }] }),
      $executeRaw: vi.fn().mockResolvedValue(0),
    });
    const prisma = makePrisma(tx);
    // ensureOrphanSentinel's prisma.$queryRaw (the sentinel bootstrap CTE).
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ created: false }]);

    const summary = await new AccountDeletionService(prisma).deleteAccount(
      'user-1',
      'discord-1',
      'retention'
    );

    // Re-home is a Prisma client write (NOT raw SQL) so @updatedAt bumps and the
    // change wins the sync LWW. It targets ONLY the reach-holding character (x1)
    // and stamps the departed owner's Discord id as provenance.
    expect(personalityUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['x1'] } },
      data: { ownerId: expect.any(String), originalOwnerDiscordId: 'discord-1' },
    });

    // Summary + sweep scope cover ONLY the deleted (non-re-homed) character.
    expect(summary.characterIds).toEqual(['z1']);
    expect(summary.characterNames).toEqual(['Solo']);
    expect(summary.characters).toBe(1);

    const pendingWhere = (tx.pendingMemory as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany
      .mock.calls[0][0].where;
    expect(pendingWhere.OR).toEqual([
      { personaId: { in: ['p1'] } },
      { personalityId: { in: ['z1'] } },
    ]);
  });

  it('deletes every owned character normally when none have cross-user reach', async () => {
    const personalityUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = makeTx({
      personality: {
        findMany: vi.fn().mockResolvedValue([{ id: 'z1', name: 'Solo', slug: 'solo' }]),
        updateMany: personalityUpdateMany,
      },
      $queryRaw: retentionQueryRaw({ eligible: true, reach: [] }), // no cross-user reach
      $executeRaw: vi.fn().mockResolvedValue(0),
    });
    const prisma = makePrisma(tx);
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ created: false }]);

    const summary = await new AccountDeletionService(prisma).deleteAccount(
      'user-1',
      'discord-1',
      'retention'
    );

    // No re-home fired — nothing had cross-user reach.
    expect(personalityUpdateMany).not.toHaveBeenCalled();
    expect(summary.characterIds).toEqual(['z1']);
    expect(summary.charactersReHomed).toBe(0);
  });

  it('ABORTS without deleting when the in-transaction re-check fails (D4 TOCTOU)', async () => {
    // The user became active between cohort selection and this purge — the
    // predicate no longer holds, so the transaction must roll back rather than
    // erase a live account.
    const tx = makeTx({
      $queryRaw: retentionQueryRaw({ eligible: false, reach: [] }),
      $executeRaw: vi.fn().mockResolvedValue(0),
    });
    const prisma = makePrisma(tx);
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ created: false }]);

    await expect(
      new AccountDeletionService(prisma).deleteAccount('user-1', 'discord-1', 'retention')
    ).rejects.toThrow(RetentionIneligibleError);

    const userDelete = (tx.user as { delete: ReturnType<typeof vi.fn> }).delete;
    const auditCreate = (tx.retentionPurgeLog as { create: ReturnType<typeof vi.fn> }).create;
    expect(userDelete).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('writes the audit row INSIDE the transaction so a purge can never go unlogged', async () => {
    const tx = makeTx({
      personality: {
        findMany: vi.fn().mockResolvedValue([{ id: 'z1', name: 'Solo', slug: 'solo' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: retentionQueryRaw({ eligible: true, reach: [] }),
      $executeRaw: vi.fn().mockResolvedValue(0),
    });
    const prisma = makePrisma(tx);
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ created: false }]);

    const summary = await new AccountDeletionService(prisma).deleteAccount(
      'user-1',
      'discord-1',
      'retention',
      'ops retention:purge (dev)'
    );

    const auditCreate = (tx.retentionPurgeLog as { create: ReturnType<typeof vi.fn> }).create;
    // The write goes through the TRANSACTION client, not the base client —
    // that is what makes it atomic with the deletion it records.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      targetDiscordId: 'discord-1',
      runContext: 'ops retention:purge (dev)',
      dbOutcome: 'success',
      offDbReconciled: 'pending',
      // The slugs the off-DB retry sweep needs for the avatar unlink.
      offDbPending: { characterSlugs: ['solo'] },
    });
    expect(summary.auditLogId).toBe('audit-1');
  });

  it('writes NO audit row for a self-serve deletion', async () => {
    // The retention ledger records purges the operator initiated. A user
    // deleting their own account is not one, and logging it would put their
    // Discord id in a table their deletion was supposed to empty.
    const tx = makeTx();
    const prisma = makePrisma(tx);

    await new AccountDeletionService(prisma).deleteAccount('user-1', 'discord-1', 'self-serve');

    expect(
      (tx.retentionPurgeLog as { create: ReturnType<typeof vi.fn> }).create
    ).not.toHaveBeenCalled();
  });
});
