/**
 * Retrieval-time lookup of stored assistant summaries by the Discord message id
 * of the turn that triggered them.
 *
 * `memories.message_ids` carries the TRIGGER (user) message id — the assignment
 * site is `buildMemoryMetadata` in ai-worker's `LongTermMemoryService.ts` — so a
 * character's reply is reached through the user message that prompted it.
 *
 * The usability predicate mirrors the archive render's (ai-worker's
 * `memoryUtils.ts` `mapQueryResultToDocument`, `hasSummary`): a `done` status, a
 * non-empty `assistant_summary`, and a null `chunk_group_id`. Prompt version is
 * deliberately NOT checked — a stored done summary renders regardless, because a
 * version bump drives re-enqueue and must never blank the render. `visibility`
 * IS checked here, which the archive predicate does not need to do because its
 * caller — the retrieval query in ai-worker's `PgvectorQueryBuilder.ts`, which
 * applies `m.visibility = 'normal'` — already filtered: a memory soft-deleted
 * by source-message deletion must not reappear as a history summary through
 * this second door.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';

/**
 * Look up usable stored assistant summaries for the given trigger (user)
 * Discord message ids.
 *
 * Returns a Map of trigger Discord message id → assistant summary text, for
 * only the ids that resolved to a usable stored summary. An id absent from the
 * request, or one with no usable summary, is simply absent from the result.
 *
 * The `take` cap bounds the MEMORY ROWS scanned, not the ids resolved. Rows
 * arrive newest-first and the first hit for an id wins, so under the cap a
 * trigger id resolves to its newest usable row or to nothing rather than to a
 * superseded one — pinned by the `take: 1` truncation case in the component
 * test.
 */
export async function findUsableAssistantSummariesByTriggerIds(
  prisma: PrismaClient,
  personalityId: string,
  triggerDiscordIds: string[],
  take: number
): Promise<Map<string, string>> {
  const ids = triggerDiscordIds.filter(id => id.length > 0);
  const result = new Map<string, string>();
  if (ids.length === 0) {
    return result;
  }

  const rows = await prisma.memory.findMany({
    where: {
      personalityId,
      messageIds: { hasSome: ids },
      visibility: 'normal',
      chunkGroupId: null,
      summaryStatus: 'done',
    },
    select: { messageIds: true, assistantSummary: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take,
  });

  const requested = new Set(ids);
  for (const row of rows) {
    if (typeof row.assistantSummary !== 'string' || row.assistantSummary.length === 0) {
      continue;
    }
    for (const id of row.messageIds) {
      // Descending createdAt, first hit wins: the newest usable row for a
      // trigger id claims the slot. Pinned by the unit case asserting the
      // desc orderBy and by the component case that truncates at take: 1.
      if (requested.has(id) && !result.has(id)) {
        result.set(id, row.assistantSummary);
      }
    }
  }

  return result;
}
