/**
 * Write a turn's built references onto its trigger history row.
 *
 * The sibling of `visionDescriptionWriter`: that one persists the descriptions
 * of the trigger message's OWN attachments, this one persists the references it
 * quoted. Both are the same bargain — the worker paid for vision and
 * transcription, so the worker writes the result down where it will outlive a
 * cache entry.
 *
 * A free function rather than a method on the RAG service because it needs
 * nothing from that class beyond a history client, and because the guard below
 * (which summons have a row to write to at all) deserves its own tests.
 */

import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ConversationHistoryService } from '@tzurot/conversation-history';

const logger = createLogger('ReferencePersistence');

/** The identity fields the write needs off the turn's context. */
export interface ReferencePersistenceScope {
  channelId?: string;
  activePersonaId?: string;
  triggerMessageId?: string;
}

/**
 * Store `references` on the row the job was queued for.
 *
 * FAILURE-tolerant, not fire-and-forget: the writer never throws, so a lost
 * snapshot degrades a future replay rather than failing this response — but the
 * call is deliberately AWAITED. This is the durability write in a change about
 * durability, and an unawaited one can be lost to a shutdown mid-generation.
 * The cost is a row lookup plus an UPDATE — two indexed round trips, three when
 * the exact-id lookup misses and falls back to most-recent — which is the same
 * shape the sibling write (`persistTriggerDescriptions`) already awaits a
 * pipeline step earlier.
 *
 * Skipped without a channel or persona — an anonymous summon has no history row
 * of its own.
 */
export async function persistBuiltReferences(opts: {
  history: ConversationHistoryService;
  references: StoredReferencedMessage[];
  personalityId: string;
  scope: ReferencePersistenceScope;
}): Promise<void> {
  const { history, references, personalityId, scope } = opts;
  const { channelId, activePersonaId, triggerMessageId } = scope;

  if (references.length === 0) {
    return;
  }
  if (channelId === undefined || channelId.length === 0 || activePersonaId === undefined) {
    logger.debug(
      { referenceCount: references.length },
      'Skipping reference persist (no channel or persona to write against)'
    );
    return;
  }

  await history.storeTriggerReferences(
    channelId,
    personalityId,
    activePersonaId,
    references,
    triggerMessageId
  );
}
