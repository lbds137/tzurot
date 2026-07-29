import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@tzurot/common-types/services/prisma';
import { countCrossUserReach, findCrossUserReachIds } from './crossUserReach.js';

/** Join the template-strings array (call[0]) to assert on the SQL skeleton. */
function joinSql(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join(' ');
}

function makeDb(rows: { personalityId: string; otherUsers: number }[]) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  return { db: { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient, queryRaw };
}

describe('countCrossUserReach', () => {
  it('maps each reached id to its distinct other-user count', async () => {
    const { db } = makeDb([
      { personalityId: 'x1', otherUsers: 2 },
      { personalityId: 'x2', otherUsers: 1 },
    ]);

    const counts = await countCrossUserReach(db, 'user-1', ['x1', 'x2', 'z1']);

    expect(counts.get('x1')).toBe(2);
    expect(counts.get('x2')).toBe(1);
    expect(counts.has('z1')).toBe(false);
  });

  it('short-circuits without querying when the user owns nothing', async () => {
    const { db, queryRaw } = makeDb([]);

    expect((await countCrossUserReach(db, 'user-1', [])).size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('counts DISTINCT users across the unioned arms', async () => {
    const { db, queryRaw } = makeDb([]);

    await countCrossUserReach(db, 'user-1', ['x1']);

    const sql = joinSql(queryRaw.mock.calls[0]);
    // One user reachable via several arms (memory AND history AND a grant)
    // must count once — the union yields (personality, user) pairs and the
    // count collapses them.
    expect(sql).toContain('COUNT(DISTINCT reach.other_user_id)');
    expect(sql).toContain('GROUP BY reach.personality_id');
  });
});

describe('findCrossUserReachIds', () => {
  it('returns the ids other users have data on (the keyset of the count)', async () => {
    const { db } = makeDb([
      { personalityId: 'x1', otherUsers: 1 },
      { personalityId: 'x2', otherUsers: 3 },
    ]);

    expect(await findCrossUserReachIds(db, 'user-1', ['x1', 'x2', 'z1'])).toEqual(['x1', 'x2']);
  });

  it('short-circuits without querying when the user owns nothing', async () => {
    const { db, queryRaw } = makeDb([]);

    expect(await findCrossUserReachIds(db, 'user-1', [])).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('spans all four reach sources and excludes the owner themself', async () => {
    const { db, queryRaw } = makeDb([]);

    await findCrossUserReachIds(db, 'user-1', ['x1']);

    const sql = joinSql(queryRaw.mock.calls[0]);
    // Reach = memories ∪ conversation_history ∪ facts (D11's broadened signal).
    // A narrowing regression here silently deletes characters other people use.
    expect(sql).toContain('FROM memories m');
    expect(sql).toContain('FROM conversation_history ch');
    expect(sql).toContain('FROM memory_facts f');
    // The fourth arm is an explicit GRANT rather than accumulated activity. It
    // is inert today (the only writer inserts userId === ownerId), which is
    // exactly why it needs pinning: nothing in production would surface a
    // regression here until real co-ownership ships, at which point losing this
    // arm means a co-owner's character gets DELETED instead of re-homed.
    expect(sql).toContain('FROM personality_owners po');
    // Reach is about ANOTHER user — the owner's own rows must not count.
    expect(sql).toContain('p.owner_id != ');
    // The grant arm needs its own inequality: it joins no persona, so the
    // `p.owner_id !=` above does not constrain it. A `=` here would invert the
    // arm into "re-home only the owner's self-grant", i.e. re-home nothing.
    expect(sql).toContain('po.user_id != ');
    // INNER JOINs drop null-persona (world) rows: un-owned content isn't reach.
    expect(sql).toContain('JOIN personas p');
    // The departed user's id and the owned ids cross the seam as bound values.
    expect(queryRaw.mock.calls[0]).toEqual(expect.arrayContaining([['x1'], 'user-1']));
  });
});
