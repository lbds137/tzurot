import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@tzurot/common-types/services/prisma';
import { RETENTION_POLICY } from '@tzurot/common-types/constants/retention';
import {
  countEligibleUsers,
  countInGrace,
  countNotifyCohort,
  filterStillNotifyEligible,
  isStillEligibleForPurge,
  selectEligibleUsers,
  selectNotifyCohort,
} from './eligibility.js';

/**
 * Reconstruct the full SQL a `$queryRaw` tagged template would send, splicing
 * any nested `Prisma.Sql` fragment inline.
 *
 * This matters: the predicate lives in a shared fragment, so joining only the
 * OUTER template strings would silently assert against a query with no WHERE
 * clause in it — and every "the predicate contains X" test would pass by
 * examining the wrong string.
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

/** Every bound parameter, including those carried by a nested fragment. */
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

function makeDb(rows: unknown[] = []) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  return { db: { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient, queryRaw };
}

describe('the eligibility predicate', () => {
  it('gates on every arm (D4) and nothing else', async () => {
    const { db, queryRaw } = makeDb();

    await selectEligibleUsers(db);

    const sql = flattenSql(queryRaw.mock.calls[0]);
    // Unreachable OR gone OR grace-expired — any of the three qualifies.
    expect(sql).toContain('u.dm_undeliverable_since IS NOT NULL');
    expect(sql).toContain('u.discord_account_gone_at IS NOT NULL');
    expect(sql).toContain('u.retention_notified_at <');
    // Inactivity, with the NULL → created_at fallback (never "active now").
    expect(sql).toContain('COALESCE(u.last_active_at, u.created_at)');
    // The two exemptions that must never be purge-able.
    expect(sql).toContain('u.is_superuser = false');
    expect(sql).toContain('u.retention_exempt = false');
    // The windows are bound, not inlined — and they're the single named constants.
    expect(flattenValues(queryRaw.mock.calls[0])).toContain(RETENTION_POLICY.WINDOW_DAYS);
    expect(flattenValues(queryRaw.mock.calls[0])).toContain(RETENTION_POLICY.GRACE_PERIOD_DAYS);

    // NEGATIVE: the predicate must not silently widen to reachable users. A
    // purge that ignores reachability would erase people who could be notified.
    expect(sql).not.toContain('OR u.is_superuser');
    expect(sql).not.toContain('notify_enabled');
  });

  it('makes every signal clear the 180-day bar too — none is a fast-track', async () => {
    // Owner call: D13 sketched purging a Discord-10013 account without waiting
    // out the inactivity window. That stays unbuilt, and the Phase-3 grace arm
    // inherits the same rule: the OR covers only the three qualifying signals
    // and is ANDed with the inactivity window, never ORed around it.
    const { db, queryRaw } = makeDb();

    await selectEligibleUsers(db);

    const sql = flattenSql(queryRaw.mock.calls[0]).replace(/\s+/g, ' ');
    // Fragment-bound values flatten to `?` placeholders, hence the literal \?.
    expect(sql).toMatch(
      /\(u\.dm_undeliverable_since IS NOT NULL OR u\.discord_account_gone_at IS NOT NULL OR u\.retention_notified_at < now\(\) - make_interval\(days => \?\)\) AND COALESCE/
    );
    expect(sql).not.toMatch(/OR u\.retention_notified_at[^)]*$/);
  });

  it('labels by signal strength: account_gone > unreachable > grace_expired', async () => {
    const { db } = makeDb([
      {
        userId: 'u1',
        discordId: '900000000000000001',
        inactiveSince: new Date('2025-01-01'),
        accountGone: true,
        unreachable: true,
      },
      {
        userId: 'u2',
        discordId: '900000000000000002',
        inactiveSince: new Date('2025-02-01'),
        accountGone: false,
        unreachable: true,
      },
      {
        userId: 'u3',
        discordId: '900000000000000003',
        inactiveSince: new Date('2025-03-01'),
        accountGone: false,
        unreachable: false,
      },
    ]);

    const cohort = await selectEligibleUsers(db);

    expect(cohort.map(row => row.reason)).toEqual(['account_gone', 'unreachable', 'grace_expired']);
  });
});

describe('the notify predicate (Phase 3)', () => {
  it('selects only reachable, un-warned, inactive, non-exempt users', async () => {
    const { db, queryRaw } = makeDb();

    await selectNotifyCohort(db, null);

    const sql = flattenSql(queryRaw.mock.calls[0]);
    // Reachable: BOTH unreachable stamps must be null...
    expect(sql).toContain('u.dm_undeliverable_since IS NULL');
    expect(sql).toContain('u.discord_account_gone_at IS NULL');
    // ...one notice per inactivity spell (also the cross-run idempotency guard)...
    expect(sql).toContain('u.retention_notified_at IS NULL');
    // ...the same inactivity window and exemptions as the purge predicate.
    expect(sql).toContain('COALESCE(u.last_active_at, u.created_at)');
    expect(sql).toContain('u.is_superuser = false');
    expect(sql).toContain('u.retention_exempt = false');
    expect(flattenValues(queryRaw.mock.calls[0])).toContain(RETENTION_POLICY.WINDOW_DAYS);
  });

  it('narrows by the outbound-DM allowlist at the SQL level when one is set', async () => {
    const { db, queryRaw } = makeDb();

    await selectNotifyCohort(db, new Set(['111111111111111111']));

    const sql = flattenSql(queryRaw.mock.calls[0]);
    expect(sql).toContain('u.discord_id = ANY(');
    expect(flattenValues(queryRaw.mock.calls[0])).toContainEqual(['111111111111111111']);
  });

  it('adds no allowlist clause when unrestricted (prod)', async () => {
    const { db, queryRaw } = makeDb();

    await selectNotifyCohort(db, null);

    expect(flattenSql(queryRaw.mock.calls[0])).not.toContain('ANY(');
  });
});

describe('filterStillNotifyEligible (the send-time re-check)', () => {
  it('returns the still-eligible subset', async () => {
    const { db, queryRaw } = makeDb([{ userId: 'keep-1' }, { userId: 'keep-2' }]);

    const eligible = await filterStillNotifyEligible(db, ['keep-1', 'gone-active', 'keep-2']);

    expect(eligible).toEqual(new Set(['keep-1', 'keep-2']));
    const sql = flattenSql(queryRaw.mock.calls[0]);
    // Scoped to the batch AND evaluating the full notify predicate — dropping
    // any arm would DM a deletion warning to a user who just came back.
    expect(sql).toContain('u.id = ANY(');
    expect(sql).toContain('u.retention_notified_at IS NULL');
  });

  it('short-circuits on an empty batch without touching the db', async () => {
    const { db, queryRaw } = makeDb();

    expect(await filterStillNotifyEligible(db, [])).toEqual(new Set());
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('the reporting counts', () => {
  it('countNotifyCohort returns a number', async () => {
    const { db } = makeDb([{ n: 51n }]);

    expect(await countNotifyCohort(db)).toBe(51);
  });

  it('countInGrace bounds by the grace window and keeps the exemption guards', async () => {
    const { db, queryRaw } = makeDb([{ n: 3n }]);

    const count = await countInGrace(db);

    expect(count).toBe(3);
    const sql = flattenSql(queryRaw.mock.calls[0]);
    expect(sql).toContain('u.retention_notified_at >=');
    expect(sql).toContain('u.is_superuser = false');
    expect(sql).toContain('u.retention_exempt = false');
    expect(flattenValues(queryRaw.mock.calls[0])).toContain(RETENTION_POLICY.GRACE_PERIOD_DAYS);
  });

  it('countInGrace excludes users an unreachable stamp already made purge-eligible', async () => {
    // Disjointness: a mid-grace user whose LATER release DM bounced is in the
    // purge cohort via the unreachable arm — counting them as "in grace" too
    // would report the same user as both purgeable-now and still-waiting.
    const { db, queryRaw } = makeDb([{ n: 0n }]);

    await countInGrace(db);

    const sql = flattenSql(queryRaw.mock.calls[0]);
    expect(sql).toContain('u.dm_undeliverable_since IS NULL');
    expect(sql).toContain('u.discord_account_gone_at IS NULL');
  });
});

describe('isStillEligibleForPurge (the TOCTOU re-check)', () => {
  it('scopes the SAME predicate to one user', async () => {
    const { db, queryRaw } = makeDb([{ eligible: true }]);

    const eligible = await isStillEligibleForPurge(db, 'user-uuid');

    expect(eligible).toBe(true);
    const sql = flattenSql(queryRaw.mock.calls[0]);
    // The single-user scope AND the full predicate — a re-check that dropped
    // any arm would re-authorise a purge the cohort query would have excluded.
    expect(sql).toContain('u.id =');
    expect(sql).toContain('u.dm_undeliverable_since IS NOT NULL');
    expect(sql).toContain('u.retention_exempt = false');
    expect(flattenValues(queryRaw.mock.calls[0])).toContain('user-uuid');
  });

  it('returns false when the user no longer matches — they became active', async () => {
    const { db } = makeDb([]);

    expect(await isStillEligibleForPurge(db, 'user-uuid')).toBe(false);
  });

  it('returns false for a user row that no longer exists at all', async () => {
    // Same empty result as "became active", deliberately: an already-purged
    // target is not eligible, and the caller reports that as an idempotent
    // skip rather than an error.
    const { db } = makeDb([]);

    expect(await isStillEligibleForPurge(db, 'deleted-user')).toBe(false);
  });
});

describe('countEligibleUsers', () => {
  it('returns the count as a number, not the driver bigint', async () => {
    // count(*) comes back as a bigint; leaking that to the breaker's division
    // would throw ("Cannot mix BigInt and other types").
    const { db } = makeDb([{ n: 7n }]);

    const count = await countEligibleUsers(db);

    expect(count).toBe(7);
    expect(typeof count).toBe('number');
  });

  it('reports zero when the query returns no rows', async () => {
    const { db } = makeDb([]);

    expect(await countEligibleUsers(db)).toBe(0);
  });
});
