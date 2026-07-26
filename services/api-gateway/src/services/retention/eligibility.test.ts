import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@tzurot/common-types/services/prisma';
import {
  RETENTION_WINDOW_DAYS,
  countEligibleUsers,
  isStillEligibleForPurge,
  selectEligibleUsers,
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
    // Unreachable OR gone — either signal qualifies.
    expect(sql).toContain('u.dm_undeliverable_since IS NOT NULL');
    expect(sql).toContain('u.discord_account_gone_at IS NOT NULL');
    // Inactivity, with the NULL → created_at fallback (never "active now").
    expect(sql).toContain('COALESCE(u.last_active_at, u.created_at)');
    // The two exemptions that must never be purge-able.
    expect(sql).toContain('u.is_superuser = false');
    expect(sql).toContain('u.retention_exempt = false');
    // The window is bound, not inlined — and it's the single named constant.
    expect(flattenValues(queryRaw.mock.calls[0])).toContain(RETENTION_WINDOW_DAYS);

    // NEGATIVE: the predicate must not silently widen to reachable users. A
    // purge that ignores reachability would erase people who could be notified.
    expect(sql).not.toContain('OR u.is_superuser');
    expect(sql).not.toContain('notify_enabled');
  });

  it('makes a gone account clear the 180-day bar too — it is NOT a fast-track', async () => {
    // Owner call: D13 sketched purging a Discord-10013 account without waiting
    // out the inactivity window. That stays unbuilt, so the inactivity
    // condition must apply to BOTH signals — i.e. the OR covers only the two
    // unreachability flags and is ANDed with the window, never ORed around it.
    const { db, queryRaw } = makeDb();

    await selectEligibleUsers(db);

    const sql = flattenSql(queryRaw.mock.calls[0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(
      /\(u\.dm_undeliverable_since IS NOT NULL OR u\.discord_account_gone_at IS NOT NULL\) AND COALESCE/
    );
    expect(sql).not.toMatch(/OR u\.discord_account_gone_at IS NOT NULL\s*\)?\s*$/);
  });

  it('labels a gone account as account_gone even when both signals are stamped', async () => {
    const { db } = makeDb([
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
    ]);

    const cohort = await selectEligibleUsers(db);

    expect(cohort.map(row => row.reason)).toEqual(['account_gone', 'unreachable']);
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
