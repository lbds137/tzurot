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
 * The chain continues one layer down: extracted facts carry their source
 * memory ids in `source_memory_ids`, so a memory deletion also retires the
 * facts distilled from it (`propagateDeletionToFacts`) — otherwise fact
 * retrieval keeps serving a statement whose only evidence the user erased.
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
      await propagateDeletionToFacts(prisma);
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

/**
 * Retire the facts whose source memories have been deleted (R8, fact layer).
 *
 * ANY-source semantics (owner call): a fact is retired the moment any of its
 * `source_memory_ids` points at a deleted memory — the statement's evidence is
 * gone from the layer the user acted on, and content corroborated by surviving
 * memories is still reachable through memory retrieval itself. Extraction
 * REPLACES a fact's sources on re-observation, so a fact revived by fresh
 * evidence carries only living sources and is not re-retired by this sweep.
 *
 * User curation outranks the cascade: locked facts and corrected-tier facts
 * are retained — the same carve-outs every extraction write already honors.
 * `forgotten` and superseded rows are already out of retrieval and keep their
 * own states.
 *
 * The predicate is a join against ALL deleted memories rather than a list of
 * just-deleted ids: every invocation also heals any fact a pre-cascade
 * deletion left behind, and no caller has to plumb id lists through
 * `updateMany` calls that don't return them. Both sides of the join are
 * unindexed array scans — fine at current table sizes; if fact volume ever
 * makes this show up in timings, the escalation is a GIN index on
 * `source_memory_ids` plus id-scoped calls.
 *
 * Same non-fatal contract as the memory propagation above: a cascade failure
 * must never break the deletion that triggered it.
 */
export async function propagateDeletionToFacts(prisma: PrismaClient): Promise<void> {
  try {
    const retired = await prisma.$executeRaw`
      UPDATE memory_facts
      SET visibility = 'deleted', updated_at = NOW()
      FROM (SELECT id::text AS id_text FROM memories WHERE visibility = 'deleted') dm
      WHERE memory_facts.visibility = 'normal'
        AND memory_facts.forgotten = false
        AND memory_facts.superseded_at IS NULL
        AND memory_facts.is_locked = false
        AND memory_facts.tier <> 'corrected'
        AND dm.id_text = ANY (memory_facts.source_memory_ids)
    `;
    if (retired > 0) {
      // Counted only when the cascade actually fired: curation-retained rows
      // persist across invocations, and re-warning about the same rows on
      // every no-op sweep would bury the lines that matter.
      const curationRetained = await prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM memory_facts
        WHERE visibility = 'normal'
          AND forgotten = false
          AND superseded_at IS NULL
          AND (is_locked = true OR tier = 'corrected')
          AND EXISTS (
            SELECT 1 FROM memories m
            WHERE m.visibility = 'deleted'
              AND m.id::text = ANY (memory_facts.source_memory_ids)
          )
      `;
      logger.info(
        { factsRetired: retired, curationRetained: curationRetained[0]?.count ?? 0 },
        'Propagated memory deletion to derived facts'
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Fact deletion propagation failed (non-fatal)');
  }
}
