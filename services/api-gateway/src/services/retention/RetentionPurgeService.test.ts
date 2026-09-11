import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { resetConfig } from '@tzurot/common-types/config/config';
import {
  RetentionPurgeService,
  BREAKER_HARD_FRACTION,
  RECONCILE_BATCH_SIZE,
} from './RetentionPurgeService.js';
import type { PurgeScope } from './purgeScope.js';

const mockErase = vi.hoisted(() => vi.fn());
const mockCleanupOffDb = vi.hoisted(() => vi.fn());
const mockCreateLog = vi.hoisted(() => vi.fn());
// A real class, not vi.fn().mockImplementation(...): `vi.clearAllMocks()` in
// beforeEach strips a mock constructor's implementation, which then throws
// "is not a constructor" on the next `new`.
vi.mock('../AccountEraserService.js', () => ({
  AccountEraserService: class {
    erase = mockErase;
    cleanupOffDb = mockCleanupOffDb;
  },
}));

/** Every existing call site passes this scope explicitly now that the
 * constructor's scope defaults to `resolvePurgeScope()` (which reads live
 * config) — an explicit unrestricted scope keeps these tests independent of
 * the ambient environment. */
const UNRESTRICTED: PurgeScope = { kind: 'unrestricted' };

/**
 * Reconstruct the full SQL a `$queryRaw` tagged-template call would send,
 * splicing any nested `Prisma.Sql` fragment inline — mirrors eligibility.test.ts's
 * flattenSql/flattenValues, needed here to assert the ceiling count's scope
 * narrowing crosses into the actual query.
 */
function flattenSql(call: unknown[]): string {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return strings
    .map((chunk, i) => {
      const value = values[i];
      const isFragment =
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { sql?: unknown }).sql === 'string';
      return chunk + (isFragment ? (value as { sql: string }).sql : '');
    })
    .join(' ');
}

function flattenValues(call: unknown[]): unknown[] {
  const [, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return values.flatMap(value => {
    if (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as { values?: unknown }).values)
    ) {
      return (value as { values: unknown[] }).values;
    }
    return [value];
  });
}

describe('RetentionPurgeService.buildPreview', () => {
  function makePreviewPrisma(opts: {
    cohort: unknown[];
    userbase: number;
    owned?: { id: string }[];
    reach?: { personalityId: string }[];
    reachableToNotify?: number;
    inGrace?: number;
    reminderDue?: number;
    /** Only set when the scope under test narrows the cohort. */
    unrestrictedEligible?: number;
  }) {
    const queryRaw = vi
      .fn()
      // call 1 = the cohort; calls 2-4 = notify/in-grace/reminder counts; call 5
      // (scope-narrowed only) = the un-narrowed eligible count; call 6+ = per-user reach
      .mockResolvedValueOnce(opts.cohort)
      .mockResolvedValueOnce([{ n: BigInt(opts.reachableToNotify ?? 0) }])
      .mockResolvedValueOnce([{ n: BigInt(opts.inGrace ?? 0) }])
      .mockResolvedValueOnce([{ n: BigInt(opts.reminderDue ?? 0) }]);
    if (opts.unrestrictedEligible !== undefined) {
      queryRaw.mockResolvedValueOnce([{ n: BigInt(opts.unrestrictedEligible) }]);
    }
    queryRaw.mockResolvedValue(opts.reach ?? []);
    return {
      $queryRaw: queryRaw,
      user: { count: vi.fn().mockResolvedValue(opts.userbase) },
      personality: { findMany: vi.fn().mockResolvedValue(opts.owned ?? []) },
    } as unknown as PrismaClient;
  }

  const ONE_USER = [
    {
      userId: 'u1',
      discordId: '900000000000000001',
      username: 'inactiveuser',
      inactiveSince: new Date('2025-01-01T00:00:00Z'),
      accountGone: false,
      unreachable: true,
      wasNotified: false,
    },
  ];

  it('splits owned characters into delete vs re-home and totals them', async () => {
    const prisma = makePreviewPrisma({
      cohort: ONE_USER,
      userbase: 100,
      owned: [{ id: 'x1' }, { id: 'x2' }, { id: 'z1' }],
      reach: [{ personalityId: 'x1' }, { personalityId: 'x2' }], // 2 re-homed, 1 deleted
    });

    const preview = await new RetentionPurgeService({ prisma }, UNRESTRICTED).buildPreview();

    expect(preview.users[0]?.ownedCharacters).toEqual({ toDelete: 1, toReHome: 2 });
    expect(preview.totals.charactersToDelete).toBe(1);
    expect(preview.totals.charactersToReHome).toBe(2);
    expect(preview.users[0]?.inactiveSince).toBe('2025-01-01T00:00:00.000Z');
  });

  it('computes the userbase percentage to one decimal place', async () => {
    const prisma = makePreviewPrisma({ cohort: ONE_USER, userbase: 300 });

    const { totals } = await new RetentionPurgeService({ prisma }, UNRESTRICTED).buildPreview();

    expect(totals.eligibleCount).toBe(1);
    expect(totals.userbaseCount).toBe(300);
    expect(totals.percentOfUserbase).toBe(0.3);
    expect(totals.breakerWarning).toBe(false);
  });

  it('raises the breaker warning when the cohort exceeds the warn fraction', async () => {
    // 1 of 5 = 20% > 15% warn threshold.
    const prisma = makePreviewPrisma({ cohort: ONE_USER, userbase: 5 });

    const { totals } = await new RetentionPurgeService({ prisma }, UNRESTRICTED).buildPreview();

    expect(totals.percentOfUserbase).toBe(20);
    expect(totals.breakerWarning).toBe(true);
  });

  it('does NOT warn at exactly the warn fraction — the breaker fires on EXCEEDING it', async () => {
    // 3 of 20 = exactly 15.0%. The threshold is a strict `>`, matching the
    // "exceeds" wording; pinning the boundary so a future `>=` (or a nudged
    // constant) can't silently start crying wolf on every ordinary run.
    const cohort = ['u1', 'u2', 'u3'].map((userId, i) => ({
      userId,
      discordId: `90000000000000000${i}`,
      username: `inactive${String(i)}`,
      inactiveSince: new Date('2025-01-01T00:00:00Z'),
      accountGone: false,
      unreachable: true,
      wasNotified: false,
    }));
    const prisma = makePreviewPrisma({ cohort, userbase: 20 });

    const { totals } = await new RetentionPurgeService({ prisma }, UNRESTRICTED).buildPreview();

    expect(totals.percentOfUserbase).toBe(15);
    expect(totals.breakerWarning).toBe(false);
  });

  it('reports an empty cohort without dividing by zero on an empty userbase', async () => {
    const prisma = makePreviewPrisma({ cohort: [], userbase: 0 });

    const { users, totals } = await new RetentionPurgeService(
      { prisma },
      UNRESTRICTED
    ).buildPreview();

    expect(users).toEqual([]);
    expect(totals.percentOfUserbase).toBe(0);
    expect(totals.breakerWarning).toBe(false);
  });

  it('surfaces the reachable-branch pipeline counts (Phase 3)', async () => {
    // graceExpired is a labeled SUBSET of the cohort, not an addition to it —
    // the count must come from the reasons, not a fourth query.
    const cohort = [
      { ...ONE_USER[0] },
      {
        userId: 'u2',
        discordId: '900000000000000002',
        username: 'gracelapsed',
        inactiveSince: new Date('2025-02-01T00:00:00Z'),
        accountGone: false,
        unreachable: false,
        wasNotified: true,
      },
    ];
    const prisma = makePreviewPrisma({
      cohort,
      userbase: 100,
      reachableToNotify: 51,
      inGrace: 4,
      reminderDue: 7,
    });

    const { totals } = await new RetentionPurgeService({ prisma }, UNRESTRICTED).buildPreview();

    expect(totals.eligibleCount).toBe(2);
    expect(totals.reachableToNotify).toBe(51);
    expect(totals.inGrace).toBe(4);
    expect(totals.reminderDue).toBe(7);
    expect(totals.graceExpired).toBe(1);
    expect(totals.bystander).toBe(0);
  });

  it('reports scope kind unrestricted with excludedEligibleCount 0, and does NOT query the un-narrowed count', async () => {
    const prisma = makePreviewPrisma({ cohort: ONE_USER, userbase: 100 });

    const { totals } = await new RetentionPurgeService({ prisma }, UNRESTRICTED).buildPreview();

    expect(totals.scope).toEqual({ kind: 'unrestricted', excludedEligibleCount: 0 });
    // 4 queries only: cohort, notify, in-grace, reminder-due — no 5th
    // (un-narrowed eligible) query.
    const queryRawMock = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
    expect(queryRawMock).toHaveBeenCalledTimes(4);
  });

  it('reports scope kind allowlist with the un-narrowed count minus the narrowed cohort', async () => {
    const scope: PurgeScope = { kind: 'allowlist', discordIds: new Set(['900000000000000001']) };
    const prisma = makePreviewPrisma({ cohort: ONE_USER, userbase: 100, unrestrictedEligible: 5 });

    const { totals } = await new RetentionPurgeService({ prisma }, scope).buildPreview();

    expect(totals.scope).toEqual({ kind: 'allowlist', excludedEligibleCount: 4 });
  });

  it('reports scope kind unscoped_non_production with the un-narrowed count as fully excluded', async () => {
    const scope: PurgeScope = { kind: 'unscoped_non_production' };
    const prisma = makePreviewPrisma({ cohort: [], userbase: 100, unrestrictedEligible: 7 });

    const { totals } = await new RetentionPurgeService({ prisma }, scope).buildPreview();

    expect(totals.scope).toEqual({ kind: 'unscoped_non_production', excludedEligibleCount: 7 });
  });
});

describe('RetentionPurgeService.purgeUser', () => {
  /**
   * @param eligible  cohort size the hard-ceiling check sees
   * @param userbase  denominator for that check
   * @param userRow   what the discordId lookup resolves to
   */
  function makePurgePrisma(opts: {
    eligible: number;
    userbase: number;
    userRow?: { id: string } | null;
  }) {
    return {
      $queryRaw: vi.fn().mockResolvedValue([{ n: BigInt(opts.eligible) }]),
      user: {
        count: vi.fn().mockResolvedValue(opts.userbase),
        findUnique: vi
          .fn()
          .mockResolvedValue(opts.userRow === undefined ? { id: 'u1' } : opts.userRow),
      },
      retentionPurgeLog: { create: mockCreateLog },
    } as unknown as PrismaClient;
  }

  const SUMMARY = { characters: 2, charactersReHomed: 1 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockErase.mockResolvedValue(SUMMARY);
    mockCreateLog.mockResolvedValue({ id: 'audit-1' });
  });

  it('erases in RETENTION mode and reports the character split', async () => {
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100 });

    const outcome = await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: 'test-run',
    });

    // Mode is the load-bearing argument across this seam: 'self-serve' would
    // delete a departed user's shared characters for everyone else too.
    expect(mockErase).toHaveBeenCalledWith({
      userId: 'u1',
      discordUserId: '900000000000000001',
      mode: 'retention',
      runContext: 'test-run',
    });
    expect(outcome).toEqual({
      status: 'purged',
      discordId: '900000000000000001',
      charactersDeleted: 2,
      charactersReHomed: 1,
    });
  });

  it('is idempotent for a user who is already gone — no erase attempted', async () => {
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100, userRow: null });

    const outcome = await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    expect(outcome).toEqual({
      status: 'skipped',
      discordId: '900000000000000001',
      reason: 'already_gone',
    });
    expect(mockErase).not.toHaveBeenCalled();
  });

  it('reports already_gone (not breaker_tripped) for a missing user while the breaker is tripped', async () => {
    // Existence is checked before the ceiling, so the reason describes what
    // actually happened. Answering `breaker_tripped` for a user who does not
    // exist would send an operator looking for a cohort problem that isn't there.
    const prisma = makePurgePrisma({ eligible: 90, userbase: 100, userRow: null });

    const outcome = await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    expect(outcome).toMatchObject({ status: 'skipped', reason: 'already_gone' });
    expect(mockErase).not.toHaveBeenCalled();
  });

  it('reports a null erase (the in-transaction re-check) as no_longer_eligible', async () => {
    // The eraser returns null when the TOCTOU re-check rolled the transaction
    // back — the user became active between preview and purge.
    mockErase.mockResolvedValue(null);
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100 });

    const outcome = await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    expect(outcome).toEqual({
      status: 'skipped',
      discordId: '900000000000000001',
      reason: 'no_longer_eligible',
    });
  });

  it('refuses when the cohort exceeds the hard ceiling — and erases nothing', async () => {
    // 30 of 100 = 30% > the 25% ceiling.
    const prisma = makePurgePrisma({ eligible: 30, userbase: 100 });

    const outcome = await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    expect(outcome.status).toBe('skipped');
    expect(outcome).toMatchObject({ reason: 'breaker_tripped' });
    expect(mockErase).not.toHaveBeenCalled();
  });

  it('does NOT trip at exactly the ceiling — it fires on EXCEEDING it', async () => {
    const prisma = makePurgePrisma({ eligible: BREAKER_HARD_FRACTION * 100, userbase: 100 });

    const outcome = await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    expect(outcome.status).toBe('purged');
  });

  it('proceeds past the ceiling ONLY with the explicit override', async () => {
    const prisma = makePurgePrisma({ eligible: 90, userbase: 100 });

    const outcome = await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
      breakerOverride: true,
    });

    expect(outcome.status).toBe('purged');
    expect(mockErase).toHaveBeenCalled();
  });

  it('records a FAILED ledger row when the erasure throws, then rethrows', async () => {
    // The success row is written inside the erasure transaction, so a rollback
    // takes it with it — without this path the ledger would claim no attempt
    // was ever made.
    mockErase.mockRejectedValue(new Error('transaction timeout'));
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100 });

    await expect(
      new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
        discordId: '900000000000000001',
        runContext: 'test-run',
      })
    ).rejects.toThrow('transaction timeout');

    expect(mockCreateLog).toHaveBeenCalledTimes(1);
    expect(mockCreateLog.mock.calls[0][0].data).toMatchObject({
      targetDiscordId: '900000000000000001',
      runContext: 'test-run',
      dbOutcome: 'failed',
      // Nothing was deleted, so no off-DB work is owed — a 'pending' here would
      // put an un-drainable row in the reconciliation queue forever.
      offDbReconciled: 'done',
    });
  });

  it('does NOT let a failed ledger write mask the original error', async () => {
    mockErase.mockRejectedValue(new Error('transaction timeout'));
    mockCreateLog.mockRejectedValue(new Error('ledger unavailable'));
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100 });

    // The caller needs the REAL failure; a swallowed audit write is the lesser
    // loss, and surfacing 'ledger unavailable' would send debugging the wrong way.
    await expect(
      new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
        discordId: '900000000000000001',
        runContext: null,
      })
    ).rejects.toThrow('transaction timeout');
  });

  it('writes NO ledger row for the TOCTOU abort — that is a routine non-event', async () => {
    mockErase.mockResolvedValue(null);
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100 });

    await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    expect(mockCreateLog).not.toHaveBeenCalled();
  });
});

describe('RetentionPurgeService.reconcileOffDb', () => {
  function makeReconcilePrisma(opts: { totalPending: number; rows: unknown[] }) {
    const count = vi.fn().mockResolvedValue(opts.totalPending);
    const findMany = vi.fn().mockResolvedValue(opts.rows);
    const update = vi.fn().mockResolvedValue({});
    return {
      prisma: { retentionPurgeLog: { count, findMany, update } } as unknown as PrismaClient,
      count,
      findMany,
      update,
    };
  }

  const row = (n: number) => ({
    id: `audit-${String(n)}`,
    targetDiscordId: `90000000000000000${String(n)}`,
    offDbPending: { characterSlugs: [`slug-${String(n)}`] },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sweeps ONE bounded batch and reports the unattempted rows as remaining', async () => {
    // A long-unreconciled backlog must not run the whole queue in one ~60s
    // HTTP request — the per-user purge's own lesson (D2).
    const { prisma, findMany } = makeReconcilePrisma({
      totalPending: 120,
      rows: Array.from({ length: RECONCILE_BATCH_SIZE }, (_, i) => row(i)),
    });
    mockCleanupOffDb.mockResolvedValue(true);

    const result = await new RetentionPurgeService({ prisma }, UNRESTRICTED).reconcileOffDb();

    // The bound crosses the seam into the query.
    expect(findMany.mock.calls[0][0].take).toBe(RECONCILE_BATCH_SIZE);
    expect(result).toEqual({
      settled: RECONCILE_BATCH_SIZE,
      stillFailing: 0,
      remaining: 120 - RECONCILE_BATCH_SIZE,
    });
  });

  it('counts an in-batch failure as stillFailing, not remaining', async () => {
    // Attempted-but-failed rows stay queued for a future run, but calling
    // them "remaining" would make the CLI loop re-attempt them immediately.
    const { prisma, update } = makeReconcilePrisma({
      totalPending: 2,
      rows: [row(1), row(2)],
    });
    mockCleanupOffDb.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await new RetentionPurgeService({ prisma }, UNRESTRICTED).reconcileOffDb();

    expect(result).toEqual({ settled: 1, stillFailing: 1, remaining: 0 });
    // Both attempts settled their ledger outcome.
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('is a zero-work no-op on an empty queue', async () => {
    const { prisma } = makeReconcilePrisma({ totalPending: 0, rows: [] });

    const result = await new RetentionPurgeService({ prisma }, UNRESTRICTED).reconcileOffDb();

    expect(result).toEqual({ settled: 0, stillFailing: 0, remaining: 0 });
    expect(mockCleanupOffDb).not.toHaveBeenCalled();
  });
});

describe('RetentionPurgeService.purgeUser — scope refusal', () => {
  function makePurgePrisma(opts: { eligible: number; userbase: number }) {
    return {
      $queryRaw: vi.fn().mockResolvedValue([{ n: BigInt(opts.eligible) }]),
      user: {
        count: vi.fn().mockResolvedValue(opts.userbase),
        findUnique: vi.fn().mockResolvedValue({ id: 'u1' }),
      },
      retentionPurgeLog: { create: mockCreateLog },
    } as unknown as PrismaClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockErase.mockResolvedValue({ characters: 0, charactersReHomed: 0 });
  });

  it('skips a target outside the scope allowlist before any lookup', async () => {
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100 });
    const scope: PurgeScope = { kind: 'allowlist', discordIds: new Set(['900000000000000099']) };

    const outcome = await new RetentionPurgeService({ prisma }, scope).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    expect(outcome).toEqual({
      status: 'skipped',
      discordId: '900000000000000001',
      reason: 'outside_allowlist',
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(mockErase).not.toHaveBeenCalled();
  });

  it('proceeds to erase a target inside the scope allowlist', async () => {
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100 });
    const scope: PurgeScope = {
      kind: 'allowlist',
      discordIds: new Set(['900000000000000001']),
    };

    const outcome = await new RetentionPurgeService({ prisma }, scope).purgeUser({
      discordId: '900000000000000001',
      runContext: 'test-run',
    });

    expect(outcome.status).toBe('purged');
    expect(mockErase).toHaveBeenCalledWith(
      expect.objectContaining({ discordUserId: '900000000000000001' })
    );
  });

  it('skips every target when the scope is unscoped_non_production', async () => {
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100 });
    const scope: PurgeScope = { kind: 'unscoped_non_production' };

    const outcome = await new RetentionPurgeService({ prisma }, scope).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    expect(outcome).toEqual({
      status: 'skipped',
      discordId: '900000000000000001',
      reason: 'unscoped_non_production',
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockErase).not.toHaveBeenCalled();
  });

  it('the default scope (no scope argument) resolves live from config — unscoped under NODE_ENV=test', async () => {
    const prisma = makePurgePrisma({ eligible: 1, userbase: 100 });
    vi.stubEnv('OUTBOUND_DM_ALLOWLIST', '');
    resetConfig();

    try {
      const outcome = await new RetentionPurgeService({ prisma }).purgeUser({
        discordId: '900000000000000001',
        runContext: null,
      });

      expect(outcome).toEqual({
        status: 'skipped',
        discordId: '900000000000000001',
        reason: 'unscoped_non_production',
      });
    } finally {
      vi.unstubAllEnvs();
      resetConfig();
    }
  });
});

describe('RetentionPurgeService — ceiling count scope narrowing', () => {
  function makeCeilingPrisma(opts: { eligible: number; userbase: number }) {
    return {
      $queryRaw: vi.fn().mockResolvedValue([{ n: BigInt(opts.eligible) }]),
      user: {
        count: vi.fn().mockResolvedValue(opts.userbase),
        findUnique: vi.fn().mockResolvedValue({ id: 'u1' }),
      },
      personality: { findMany: vi.fn().mockResolvedValue([]) },
      retentionPurgeLog: { create: mockCreateLog },
    } as unknown as PrismaClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockErase.mockResolvedValue({ characters: 0, charactersReHomed: 0 });
  });

  it('narrows the ceiling count SQL when the scope is an allowlist', async () => {
    const prisma = makeCeilingPrisma({ eligible: 1, userbase: 100 });
    const scope: PurgeScope = { kind: 'allowlist', discordIds: new Set(['900000000000000001']) };

    await new RetentionPurgeService({ prisma }, scope).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    const queryRawMock = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const sql = flattenSql(queryRawMock.mock.calls[0]);
    expect(sql).toContain('u.discord_id = ANY(');
    expect(flattenValues(queryRawMock.mock.calls[0])).toContainEqual(['900000000000000001']);
  });

  it('does NOT narrow the ceiling count SQL when the scope is unrestricted', async () => {
    const prisma = makeCeilingPrisma({ eligible: 1, userbase: 100 });

    await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    const queryRawMock = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(flattenSql(queryRawMock.mock.calls[0])).not.toContain('u.discord_id = ANY(');
  });

  it('buildPreview also narrows its cohort query by the scope allowlist', async () => {
    const scope: PurgeScope = { kind: 'allowlist', discordIds: new Set(['900000000000000001']) };
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ n: BigInt(0) }])
      .mockResolvedValueOnce([{ n: BigInt(0) }])
      .mockResolvedValueOnce([{ n: BigInt(0) }])
      // The scope narrows this call, so buildPreview also queries the
      // un-narrowed eligible count for the preview's `scope` field.
      .mockResolvedValueOnce([{ n: BigInt(0) }]);
    const prisma = {
      $queryRaw: queryRaw,
      user: { count: vi.fn().mockResolvedValue(10) },
      personality: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await new RetentionPurgeService({ prisma }, scope).buildPreview();

    // Call 0 is the cohort query — the one narrowed by the scope allowlist.
    const sql = flattenSql(queryRaw.mock.calls[0]);
    expect(sql).toContain('u.discord_id = ANY(');
    expect(flattenValues(queryRaw.mock.calls[0])).toContainEqual(['900000000000000001']);
  });
});

describe('RetentionPurgeService.purgeUser — concurrent-delete (P2025) classification', () => {
  function makePurgePrisma(opts: {
    eligible: number;
    userbase: number;
    findUniqueResults: (Record<string, unknown> | null)[];
  }) {
    const findUnique = vi.fn();
    for (const result of opts.findUniqueResults) {
      findUnique.mockResolvedValueOnce(result);
    }
    return {
      $queryRaw: vi.fn().mockResolvedValue([{ n: BigInt(opts.eligible) }]),
      user: {
        count: vi.fn().mockResolvedValue(opts.userbase),
        findUnique,
      },
      retentionPurgeLog: { create: mockCreateLog },
    } as unknown as PrismaClient;
  }

  const p2025 = (): InstanceType<typeof Prisma.PrismaClientKnownRequestError> =>
    new Prisma.PrismaClientKnownRequestError('No record found', {
      code: 'P2025',
      clientVersion: 'test',
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateLog.mockResolvedValue({ id: 'audit-1' });
  });

  it('classifies a P2025 as already_gone when the confirming read finds no row', async () => {
    // First findUnique: the existence lookup before erasure (finds the row).
    // Second findUnique: the confirming re-read inside isConcurrentlyGone.
    const prisma = makePurgePrisma({
      eligible: 1,
      userbase: 100,
      findUniqueResults: [{ id: 'u1' }, null],
    });
    mockErase.mockRejectedValue(p2025());

    const outcome = await new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
      discordId: '900000000000000001',
      runContext: null,
    });

    expect(outcome).toEqual({
      status: 'skipped',
      discordId: '900000000000000001',
      reason: 'already_gone',
    });
    expect(mockCreateLog).not.toHaveBeenCalled();
  });

  it('keeps the original P2025 failure when the confirming read still finds the row', async () => {
    const prisma = makePurgePrisma({
      eligible: 1,
      userbase: 100,
      findUniqueResults: [{ id: 'u1' }, { id: 'u1' }],
    });
    mockErase.mockRejectedValue(p2025());

    await expect(
      new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
        discordId: '900000000000000001',
        runContext: null,
      })
    ).rejects.toMatchObject({ code: 'P2025' });

    expect(mockCreateLog).toHaveBeenCalledTimes(1);
  });

  it('keeps the ORIGINAL P2025 failure when the confirming read itself rejects', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'u1' })
      .mockRejectedValueOnce(new Error('lookup unavailable'));
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ n: BigInt(1) }]),
      user: { count: vi.fn().mockResolvedValue(100), findUnique },
      retentionPurgeLog: { create: mockCreateLog },
    } as unknown as PrismaClient;
    mockErase.mockRejectedValue(p2025());

    await expect(
      new RetentionPurgeService({ prisma }, UNRESTRICTED).purgeUser({
        discordId: '900000000000000001',
        runContext: null,
      })
    ).rejects.toMatchObject({ code: 'P2025' });

    expect(mockCreateLog).toHaveBeenCalledTimes(1);
  });
});
