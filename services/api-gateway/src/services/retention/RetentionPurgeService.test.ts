import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { RetentionPurgeService, RETENTION_WINDOW_DAYS } from './RetentionPurgeService.js';

/** Join the template-strings array (call[0]) to assert on the SQL skeleton. */
function joinSql(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join(' ');
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  const queryRaw = vi.fn().mockResolvedValue([]);
  const prisma = {
    $queryRaw: queryRaw,
    user: { count: vi.fn().mockResolvedValue(100) },
    personality: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return { prisma: prisma as unknown as PrismaClient, queryRaw };
}

describe('RetentionPurgeService.selectPurgeCohort', () => {
  it('gates on every predicate arm (D4) and nothing else', async () => {
    const { prisma, queryRaw } = makePrisma();

    await new RetentionPurgeService(prisma).selectPurgeCohort();

    const sql = joinSql(queryRaw.mock.calls[0]);
    // Unreachable OR gone — either signal qualifies.
    expect(sql).toContain('u.dm_undeliverable_since IS NOT NULL');
    expect(sql).toContain('u.discord_account_gone_at IS NOT NULL');
    // Inactivity, with the NULL → created_at fallback (never "active now").
    expect(sql).toContain('COALESCE(u.last_active_at, u.created_at)');
    // The two exemptions that must never be purge-able.
    expect(sql).toContain('u.is_superuser = false');
    expect(sql).toContain('u.retention_exempt = false');
    // The window is bound, not inlined — and it's the single named constant.
    expect(queryRaw.mock.calls[0]).toEqual(expect.arrayContaining([RETENTION_WINDOW_DAYS]));

    // NEGATIVE: the predicate must not silently widen to reachable users. A
    // purge that ignores reachability would erase people who could be notified.
    expect(sql).not.toContain('OR u.is_superuser');
    expect(sql).not.toContain('notify_enabled');
  });

  it('labels a gone account as account_gone even when both signals are stamped', async () => {
    const { prisma } = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([
        {
          userId: 'u1',
          discordId: '900000000000000001',
          inactiveSince: new Date('2025-01-01'),
          accountGone: true,
        },
        {
          userId: 'u2',
          discordId: '900000000000000002',
          inactiveSince: new Date('2025-02-01'),
          accountGone: false,
        },
      ]),
    });

    const cohort = await new RetentionPurgeService(prisma).selectPurgeCohort();

    expect(cohort.map(row => row.reason)).toEqual(['account_gone', 'unreachable']);
  });
});

describe('RetentionPurgeService.buildPreview', () => {
  function makePreviewPrisma(opts: {
    cohort: unknown[];
    userbase: number;
    owned?: { id: string }[];
    reach?: { personalityId: string }[];
  }) {
    const queryRaw = vi
      .fn()
      // call 1 = the cohort; call 2+ = per-user reach
      .mockResolvedValueOnce(opts.cohort)
      .mockResolvedValue(opts.reach ?? []);
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
      inactiveSince: new Date('2025-01-01T00:00:00Z'),
      accountGone: false,
    },
  ];

  it('splits owned characters into delete vs re-home and totals them', async () => {
    const prisma = makePreviewPrisma({
      cohort: ONE_USER,
      userbase: 100,
      owned: [{ id: 'x1' }, { id: 'x2' }, { id: 'z1' }],
      reach: [{ personalityId: 'x1' }, { personalityId: 'x2' }], // 2 re-homed, 1 deleted
    });

    const preview = await new RetentionPurgeService(prisma).buildPreview();

    expect(preview.users[0]?.ownedCharacters).toEqual({ toDelete: 1, toReHome: 2 });
    expect(preview.totals.charactersToDelete).toBe(1);
    expect(preview.totals.charactersToReHome).toBe(2);
    expect(preview.users[0]?.inactiveSince).toBe('2025-01-01T00:00:00.000Z');
  });

  it('computes the userbase percentage to one decimal place', async () => {
    const prisma = makePreviewPrisma({ cohort: ONE_USER, userbase: 300 });

    const { totals } = await new RetentionPurgeService(prisma).buildPreview();

    expect(totals.eligibleCount).toBe(1);
    expect(totals.userbaseCount).toBe(300);
    expect(totals.percentOfUserbase).toBe(0.3);
    expect(totals.breakerWarning).toBe(false);
  });

  it('raises the breaker warning when the cohort exceeds the warn fraction', async () => {
    // 1 of 5 = 20% > 15% warn threshold.
    const prisma = makePreviewPrisma({ cohort: ONE_USER, userbase: 5 });

    const { totals } = await new RetentionPurgeService(prisma).buildPreview();

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
      inactiveSince: new Date('2025-01-01T00:00:00Z'),
      accountGone: false,
    }));
    const prisma = makePreviewPrisma({ cohort, userbase: 20 });

    const { totals } = await new RetentionPurgeService(prisma).buildPreview();

    expect(totals.percentOfUserbase).toBe(15);
    expect(totals.breakerWarning).toBe(false);
  });

  it('reports an empty cohort without dividing by zero on an empty userbase', async () => {
    const prisma = makePreviewPrisma({ cohort: [], userbase: 0 });

    const { users, totals } = await new RetentionPurgeService(prisma).buildPreview();

    expect(users).toEqual([]);
    expect(totals.percentOfUserbase).toBe(0);
    expect(totals.breakerWarning).toBe(false);
  });
});
