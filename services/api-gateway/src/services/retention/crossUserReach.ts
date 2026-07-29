/**
 * Cross-user reach for retention (Phase 2, D11).
 *
 * A character has CROSS-USER reach when a user OTHER than its owner has a
 * memory, conversation-history row, or fact scoped to it. That is the signal
 * that decides a departed owner's character's fate under a retention purge:
 *
 *   - reach  → re-home to the Orphaned-Characters sentinel (other people are
 *              still using it; deleting it would take their data with it)
 *   - none   → delete with the account (nobody else uses it — minimize)
 *
 * Single-sourced here because BOTH the eraser (which acts on it) and the
 * preview (which reports it) must agree — a drift between "what the report
 * says will be re-homed" and "what the purge actually re-homes" is exactly the
 * class of bug D3 exists to prevent.
 */

import { type Prisma } from '@tzurot/common-types/services/prisma';

/**
 * Distinct OTHER users with reach on each of `ownedIds`, as a
 * personalityId → count map. Characters with zero reach are absent.
 *
 * This is the ONE reach query — `findCrossUserReachIds` derives from its
 * keyset, and the self-serve delete preview reports its counts, so the
 * warning a deleting user reads and the re-home decision the purge makes can
 * never disagree on what "shared" means.
 *
 * Reach deliberately spans ALL THREE personality-scoped activity tables —
 * narrowing any arm silently shrinks both the re-home decision and the
 * delete warning. The INNER JOINs drop world/orphan rows with a null
 * `persona_id` — reach is about another USER, not un-owned content.
 *
 * The fourth arm covers an EXPLICIT grant rather than accumulated activity: a
 * `personality_owners` row naming someone other than the owner. Inert today
 * (the sole writer inserts `userId === ownerId`, a self-duplicate of
 * `personality.ownerId`), but the moment real co-ownership grants exist, a
 * co-owner who simply hadn't chatted yet would otherwise have their character
 * DELETED by the purge rather than re-homed — silently revoking live access.
 * The activity arms cannot see that; only the grant can.
 *
 * Accepts a transaction client OR a plain `PrismaClient` (the latter is
 * assignable to `Prisma.TransactionClient`), so the eraser can call it inside
 * its deletion transaction and the preview can call it on the base client.
 */
export async function countCrossUserReach(
  db: Prisma.TransactionClient,
  userId: string,
  ownedIds: string[]
): Promise<Map<string, number>> {
  if (ownedIds.length === 0) {
    return new Map();
  }
  const rows = await db.$queryRaw<{ personalityId: string; otherUsers: number }[]>`
    SELECT reach.personality_id AS "personalityId",
           COUNT(DISTINCT reach.other_user_id)::int AS "otherUsers"
    FROM (
      SELECT m.personality_id, p.owner_id AS other_user_id FROM memories m
        JOIN personas p ON m.persona_id = p.id
        WHERE m.personality_id = ANY(${ownedIds}::uuid[]) AND p.owner_id != ${userId}::uuid
      UNION ALL
      SELECT ch.personality_id, p.owner_id FROM conversation_history ch
        JOIN personas p ON ch.persona_id = p.id
        WHERE ch.personality_id = ANY(${ownedIds}::uuid[]) AND p.owner_id != ${userId}::uuid
      UNION ALL
      SELECT f.personality_id, p.owner_id FROM memory_facts f
        JOIN personas p ON f.persona_id = p.id
        WHERE f.personality_id = ANY(${ownedIds}::uuid[]) AND p.owner_id != ${userId}::uuid
      UNION ALL
      SELECT po.personality_id, po.user_id FROM personality_owners po
        WHERE po.personality_id = ANY(${ownedIds}::uuid[]) AND po.user_id != ${userId}::uuid
    ) reach
    GROUP BY reach.personality_id
  `;
  return new Map(rows.map(row => [row.personalityId, row.otherUsers]));
}

/**
 * The ids among `ownedIds` that have cross-user reach — i.e. the characters a
 * retention purge re-homes instead of deleting. The keyset of
 * {@link countCrossUserReach}; see there for what counts as reach.
 */
export async function findCrossUserReachIds(
  db: Prisma.TransactionClient,
  userId: string,
  ownedIds: string[]
): Promise<string[]> {
  return Array.from((await countCrossUserReach(db, userId, ownedIds)).keys());
}
