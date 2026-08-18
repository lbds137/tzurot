/**
 * Durable persistence of the references a turn was built from.
 *
 * The worker resolves each quoted message once — paying for vision on its
 * images and transcription on its voice notes — and this writes that result
 * onto the trigger user message, so a later turn replaying the same quote out
 * of `<chat_log>` renders the description instead of `status="undescribed"`.
 *
 * It is a WRITE, not a patch. The predecessor read the row's existing
 * `referencedMessages` back and merged descriptions into whichever entries it
 * recognised — which meant it silently did nothing at all once bot-client
 * stopped populating that field, because there was never anything to merge
 * into. Writing what the worker built has no such failure mode: the array is
 * either stored or the row was not found, and both say so in the log.
 *
 * Extracted from ConversationHistoryService to keep that file under the
 * max-lines ceiling; the service exposes a thin delegating method.
 */

import { MessageRole } from '@tzurot/common-types/constants/message';
import {
  type MessageMetadata,
  type StoredReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ConversationHistoryClient } from './ConversationMessageMapper.js';

const logger = createLogger('TriggerReferenceWriter');

/** Scope identifying which conversation's trigger user message to update. */
export interface TriggerMessageScope {
  channelId: string;
  personalityId: string;
  personaId: string;
}

/**
 * Locate the user row a job's writes belong to.
 *
 * Prefers an exact match on the Discord message that triggered the job. The
 * fallback — most recent user row in the conversation — is what this used to do
 * unconditionally, and it is wrong whenever a second message lands during the
 * seconds-to-a-minute generation window: the first job's descriptions would be
 * written onto the second message. It stays as a fallback rather than being
 * replaced because the trigger row's own persist is best-effort bot-side and
 * the id is optional on the job context, so an exact lookup can legitimately
 * find nothing.
 */
export async function findTriggerMessage(
  prisma: ConversationHistoryClient,
  scope: TriggerMessageScope,
  triggerMessageId: string | undefined
): Promise<{ id: string; messageMetadata: unknown; targeting: 'exact' | 'recent' } | null> {
  if (triggerMessageId !== undefined && triggerMessageId.length > 0) {
    const exact = await prisma.conversationHistory.findFirst({
      where: { ...scope, role: MessageRole.User, discordMessageId: { has: triggerMessageId } },
    });
    if (exact !== null) {
      return { id: exact.id, messageMetadata: exact.messageMetadata, targeting: 'exact' };
    }
  }

  const recent = await prisma.conversationHistory.findFirst({
    where: { ...scope, role: MessageRole.User },
    // Tiebreak on id so two user rows sharing a createdAt ms can't resolve to
    // the wrong row — mirrors the deterministic ordering the read path uses.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return recent === null
    ? null
    : { id: recent.id, messageMetadata: recent.messageMetadata, targeting: 'recent' };
}

/**
 * Store the references the worker built onto the trigger user message.
 *
 * Metadata-only: content and token count are untouched. The reference text
 * already reached the model for this turn; this write exists for the replays
 * after it. Never throws — a history-quality enhancement, not a
 * pipeline-critical step.
 *
 * @returns number of references stored (0 when nothing was written)
 */
export async function writeTriggerReferences(
  prisma: ConversationHistoryClient,
  scope: TriggerMessageScope,
  references: StoredReferencedMessage[],
  triggerMessageId?: string
): Promise<number> {
  try {
    if (references.length === 0) {
      return 0;
    }

    const target = await findTriggerMessage(prisma, scope, triggerMessageId);
    if (target === null) {
      logger.warn({}, 'No user message found to store built references on');
      return 0;
    }

    // Shallow merge, so the row's other metadata (embedsXml, isForwarded)
    // survives. That makes this a read-modify-write, and it is safe for the
    // key this function owns: THIS is the sole writer of `referencedMessages`.
    //
    // It is NOT safe for keys owned by others, and there is now one:
    // `mergeForwardedOrigin` writes `forwardedFrom` to this same column from
    // bot-client's post-persist back-fill. If that write commits between this
    // function's read and its UPDATE, the spread below replaces the blob with
    // a version that never had `forwardedFrom` and silently drops it. The
    // normal ordering makes that unlikely — the back-fill fires within a
    // second of the persist, this runs after a job resolves references — but
    // ordering is not a guarantee. The fix is to merge server-side the way
    // that writer does, which needs a raw-capable client where this service
    // deliberately holds a narrow one. TASK-658; do not add a third writer of
    // this column before it lands.
    const metadata = (target.messageMetadata as MessageMetadata | null) ?? {};

    await prisma.conversationHistory.update({
      where: { id: target.id },
      data: { messageMetadata: { ...metadata, referencedMessages: references } },
    });

    logger.debug(
      { messageId: target.id, references: references.length, targeting: target.targeting },
      'Stored built references on trigger message'
    );
    return references.length;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to store built references');
    return 0;
  }
}
