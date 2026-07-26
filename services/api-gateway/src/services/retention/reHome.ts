/**
 * Orphaned-character re-homing (Retention Phase 2, D11).
 *
 * A retention purge must not delete a departed user's characters out from under
 * the people still using them. Before the account cascade runs, each owned
 * character with CROSS-USER reach is re-pointed at the Orphaned-Characters
 * sentinel, so it survives the delete along with every other user's memories,
 * history, and facts on it. Characters nobody else touches die with the account
 * — that is the data-minimization half of the same decision.
 */

import { type Prisma } from '@tzurot/common-types/services/prisma';
import { findCrossUserReachIds } from './crossUserReach.js';

export interface OwnedCharacter {
  id: string;
  name: string;
  slug: string;
}

export interface ReHomeResult {
  /** The characters that should still cascade with the account. */
  deletedCharacters: OwnedCharacter[];
  /** How many were preserved under the sentinel. */
  charactersReHomed: number;
}

/**
 * Re-home the cross-user characters and return what remains to be deleted.
 *
 * Runs inside the erasure transaction, and must: a caller that re-homed outside
 * it could commit an ownership change whose cascade then rolled back, leaving a
 * live character owned by the sentinel with no purge behind it.
 */
export async function reHomeCrossUserCharacters(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    discordUserId: string;
    sentinelId: string;
    ownedCharacters: OwnedCharacter[];
  }
): Promise<ReHomeResult> {
  const { userId, discordUserId, sentinelId, ownedCharacters } = args;
  const ownedIds = ownedCharacters.map(character => character.id);
  if (ownedIds.length === 0) {
    return { deletedCharacters: ownedCharacters, charactersReHomed: 0 };
  }

  const reHomeIds = await findCrossUserReachIds(tx, userId, ownedIds);
  if (reHomeIds.length === 0) {
    return { deletedCharacters: ownedCharacters, charactersReHomed: 0 };
  }

  // Prisma client write (NOT raw SQL) so `@updatedAt` bumps: personalities is a
  // sync-tracked table and re-home is a SEMANTIC ownership change that MUST win
  // the dev<->prod last-write-wins sync (03-database § Sync-Tracked Tables). Raw
  // SQL skips the bump → a later sync could revert the re-home. (The retention
  // stamp columns use raw SQL for the OPPOSITE reason — to avoid falsely
  // winning LWW on a non-semantic write.)
  await tx.personality.updateMany({
    where: { id: { in: reHomeIds } },
    data: { ownerId: sentinelId, originalOwnerDiscordId: discordUserId },
  });

  // Re-homing preserves every reach-holder's access: the runtime gate on
  // loading a character is `isPublic OR ownerId` (buildAccessFilter), so a
  // PUBLIC character keeps working under the sentinel, and a PRIVATE one had
  // already excluded non-owners before the purge. What remains is the inverse
  // and is deliberate (design D11): a character that was public, gained another
  // user's history, then went private still counts as reachable, so it is
  // preserved rather than deleted. Owner-decided — retaining a dead character
  // beats deleting other users' memories out from under them.
  const reHomeSet = new Set(reHomeIds);
  return {
    deletedCharacters: ownedCharacters.filter(character => !reHomeSet.has(character.id)),
    charactersReHomed: reHomeIds.length,
  };
}
