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
 * The ids among `ownedIds` that have cross-user reach — i.e. the characters a
 * retention purge re-homes instead of deleting.
 *
 * Broadened from the memories-only `fetchOtherUserReach` to all three
 * personality-scoped tables (council). The INNER JOINs drop world/orphan rows
 * with a null `persona_id` — reach is about another USER, not un-owned content.
 *
 * Accepts a transaction client OR a plain `PrismaClient` (the latter is
 * assignable to `Prisma.TransactionClient`), so the eraser can call it inside
 * its deletion transaction and the preview can call it on the base client.
 */
export async function findCrossUserReachIds(
  db: Prisma.TransactionClient,
  userId: string,
  ownedIds: string[]
): Promise<string[]> {
  if (ownedIds.length === 0) {
    return [];
  }
  const rows = await db.$queryRaw<{ personalityId: string }[]>`
    SELECT DISTINCT reach.personality_id AS "personalityId"
    FROM (
      SELECT m.personality_id FROM memories m
        JOIN personas p ON m.persona_id = p.id
        WHERE m.personality_id = ANY(${ownedIds}::uuid[]) AND p.owner_id != ${userId}::uuid
      UNION ALL
      SELECT ch.personality_id FROM conversation_history ch
        JOIN personas p ON ch.persona_id = p.id
        WHERE ch.personality_id = ANY(${ownedIds}::uuid[]) AND p.owner_id != ${userId}::uuid
      UNION ALL
      SELECT f.personality_id FROM memory_facts f
        JOIN personas p ON f.persona_id = p.id
        WHERE f.personality_id = ANY(${ownedIds}::uuid[]) AND p.owner_id != ${userId}::uuid
    ) reach
  `;
  return rows.map(row => row.personalityId);
}
