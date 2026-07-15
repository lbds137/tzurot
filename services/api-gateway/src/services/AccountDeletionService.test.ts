import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { AccountDeletionService, SuperuserDeletionError } from './AccountDeletionService.js';

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
    },
    conversationHistory: { count: vi.fn().mockResolvedValue(3) },
    memory: { count: vi.fn().mockResolvedValue(2) },
    memoryFact: { count: vi.fn().mockResolvedValue(1) },
    pendingMemory: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    llmDiagnosticLog: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ...overrides,
  };
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
      new AccountDeletionService(prisma).deleteAccount('user-1', 'discord-1')
    ).rejects.toThrow(SuperuserDeletionError);

    expect((tx.user as { delete: ReturnType<typeof vi.fn> }).delete).not.toHaveBeenCalled();
    expect(
      (tx.pendingMemory as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany
    ).not.toHaveBeenCalled();
  });

  it('builds a lowercased user: tag vocabulary from username + persona names', async () => {
    await new AccountDeletionService(prisma).deleteAccount('user-1', 'discord-1');

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
    const summary = await new AccountDeletionService(prisma).deleteAccount('user-1', 'discord-1');

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
