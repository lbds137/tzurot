/**
 * Cache-boundary telemetry for the hysteresis history window.
 *
 * Split out of `ContextAssembler` for the file-size limit, and it reads better
 * here anyway: both pieces are about where the cached prefix actually begins,
 * which is a different concern from assembling the context itself.
 */

import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('HistoryWindowTelemetry');

/**
 * How many merged-history entries precede the DB window's head row.
 *
 * Cache-boundary telemetry: entries ahead of the head shift where the stable
 * prefix actually begins, so a nonzero count explains a cache miss that the
 * head row id alone would say should not have happened.
 *
 * Returns null when the head is not in the merged list — an empty window, or a
 * head the merge dropped. That is a different fact from "nothing was
 * prepended", and collapsing it to 0 would hide the merge dropping a row it
 * should have kept.
 */
export function countEntriesBeforeHead(
  history: ConversationMessage[],
  headRowId: string | null
): number | null {
  if (headRowId === null) {
    return null;
  }
  const index = history.findIndex(message => message.id === headRowId);
  return index >= 0 ? index : null;
}

/**
 * Emit the cache-boundary pair.
 *
 * **info, not debug.** Prod defaults to `LOG_LEVEL=info`, and these two fields
 * are what the rollout reads to decide whether the window design works — at
 * debug the evidence is absent and nobody would know to bump the level looking
 * for it. Deliberately its own line rather than fields on the assembler's wide
 * debug dump: that one is a diagnostic, this one has a job.
 *
 * `headRowId` joins it to the service's own window line; the assembler is the
 * only layer that can see how much extended context landed ahead of the head.
 */
export function logCacheBoundary(
  channelId: string,
  headRowId: string | null,
  extendedContextPrepended: number | null
): void {
  logger.info({ channelId, headRowId, extendedContextPrepended }, 'History window cache boundary');
}
