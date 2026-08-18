/**
 * Durable persistence of the references a turn was built from.
 *
 * The worker resolves each quoted message once — paying for vision on its
 * images and transcription on its voice notes — and this writes that result
 * onto the trigger user message, so a later turn replaying the same quote out
 * of `<chat_log>` renders the description instead of `status="undescribed"`.
 *
 * It is a MERGE, not a patch and not an overwrite. The first version read the
 * row's existing `referencedMessages` back and merged descriptions into
 * whichever entries it recognised — which silently did nothing once bot-client
 * stopped populating that field. The second wrote what the worker built, but
 * spread the row's whole metadata blob to do it, which meant a concurrent
 * writer of any OTHER key in that blob could lose it. This merges the one key
 * it owns server-side and never reads the column at all.
 *
 * A FREE FUNCTION rather than a method on `ConversationHistoryService`,
 * because that merge needs `$executeRaw` and the service deliberately holds a
 * client type without it — api-gateway's fast pool is constructed as the
 * narrow type precisely so it cannot issue raw or transactional statements.
 * Same shape `getChannelHistoryWindow` already uses for `$transaction`: the
 * capability is asked for at the one signature that needs it.
 */

import { MessageRole } from '@tzurot/common-types/constants/message';
import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  type ConversationHistoryClient,
  type RawCapableConversationHistoryClient,
} from './ConversationMessageMapper.js';
import { mergeMessageMetadata } from './messageMetadataMerge.js';

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
): Promise<{ id: string; targeting: 'exact' | 'recent' } | null> {
  if (triggerMessageId !== undefined && triggerMessageId.length > 0) {
    const exact = await prisma.conversationHistory.findFirst({
      where: { ...scope, role: MessageRole.User, discordMessageId: { has: triggerMessageId } },
    });
    if (exact !== null) {
      return { id: exact.id, targeting: 'exact' };
    }
  }

  // Neither query filters `deletedAt`, and that is deliberate rather than an
  // oversight inherited from the pre-merge version. Writing metadata onto a
  // soft-deleted row is inert — the channel-history read filters
  // `deletedAt: null` (`buildChannelHistoryWhere`), so nothing renders it.
  // Filtering here would be WORSE: a trigger row soft-deleted mid-generation
  // would miss the exact lookup and fall through to the clause below, landing
  // this turn's references on an unrelated later message. An invisible write
  // beats a misdirected one.
  const recent = await prisma.conversationHistory.findFirst({
    where: { ...scope, role: MessageRole.User },
    // Tiebreak on id so two user rows sharing a createdAt ms can't resolve to
    // the wrong row — mirrors the deterministic ordering the read path uses.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return recent === null ? null : { id: recent.id, targeting: 'recent' };
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
  prisma: RawCapableConversationHistoryClient,
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

    // Server-side merge, so the row's other metadata (embedsXml, isForwarded,
    // forwardedFrom) survives without this function ever reading it. The read
    // is what used to make this unsafe: another writer committing between the
    // read and the UPDATE had its key overwritten by a spread that never
    // contained it. Not reading is a stronger guarantee than reading carefully.
    const result = await mergeMessageMetadata(
      prisma,
      target.id,
      { referencedMessages: references },
      { operation: 'trigger-references' }
    );

    if (result !== 'updated') {
      // Only `missing` is logged here, and only because it means something
      // different on this path than it does elsewhere: the lookup above found
      // this row moments ago, so its disappearance is not the ordinary
      // not-found case. `failed` is deliberately silent — the merge already
      // warned with the error object attached, and repeating it turns one
      // database problem into two warn-level events.
      if (result === 'missing') {
        logger.warn({ messageId: target.id }, 'Trigger row vanished before the reference merge');
      }
      return 0;
    }

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
