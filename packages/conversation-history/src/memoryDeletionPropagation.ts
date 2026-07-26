/**
 * Memory-deletion propagation (memory-architecture Phase 0, R8: deletion means
 * deletion).
 *
 * Memories carry the triggering Discord message id in `messageIds`. When the
 * user deletes the turn that produced a memory, the memory is soft-deleted
 * (`visibility='deleted'` — the same state the RAG retrieval filter excludes),
 * so a deletion the user asked for isn't silently undone by retrieval pulling
 * the derived memory back into the next prompt.
 *
 * Shared by BOTH deletion paths on purpose. It previously lived as a private
 * method on the sync service, reachable only when Discord reported a message
 * deleted — so `/history purge`, the most explicit deletion command in the
 * product, hard-deleted the conversation rows and left their memories live and
 * retrievable. Worse, the hard delete removed the very rows the sync path
 * resolves message ids from, so tidying the Discord messages afterwards could
 * no longer clean up either. One implementation, both callers.
 *
 * **Not called by time-based retention.** `cleanupOldHistory` ages conversation
 * rows out on a schedule; long-term memory is meant to OUTLIVE that window, and
 * propagating there would quietly delete every memory whose source turn got old.
 * The trigger is a user asking for deletion, never the clock.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('memory-deletion-propagation');

/**
 * Soft-delete the memories derived from the given Discord messages.
 *
 * Locked memories are deliberately PRESERVED: a user pin is explicit curation
 * that outranks source deletion — the skip is logged so the tension stays
 * observable rather than silent.
 *
 * Non-fatal by design: a propagation failure must never break the deletion path
 * that called it. The rows the user asked to delete are already gone; failing
 * the whole operation because the derived-memory cleanup stumbled would be a
 * worse outcome than a logged miss.
 */
export async function propagateDeletionToMemories(
  prisma: PrismaClient,
  discordMessageIds: string[]
): Promise<void> {
  const ids = discordMessageIds.filter(id => id.length > 0);
  if (ids.length === 0) {
    return;
  }
  try {
    const result = await prisma.memory.updateMany({
      where: { messageIds: { hasSome: ids }, visibility: 'normal', isLocked: false },
      data: { visibility: 'deleted' },
    });
    if (result.count > 0) {
      logger.info(
        { memoriesDeleted: result.count, sourceMessages: ids.length },
        'Propagated message deletion to linked memories'
      );
    }
    const lockedRetained = await prisma.memory.count({
      where: { messageIds: { hasSome: ids }, visibility: 'normal', isLocked: true },
    });
    if (lockedRetained > 0) {
      logger.warn(
        { lockedRetained, sourceMessages: ids.length },
        'Locked memories retained despite source-message deletion (pin outranks propagation)'
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Memory deletion propagation failed (non-fatal)');
  }
}
