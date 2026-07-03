/**
 * Reference image-description matching + durable persistence.
 *
 * Pairs freshly-computed image descriptions with the image attachments of a
 * stored referenced message (keyed by attachment URL) and writes them onto the
 * most recent user message's metadata. This makes a quoted image survive the
 * ~1h Redis vision-cache TTL the stored-reference hydrator reads from: once the
 * cache expires the image would otherwise render as a bare `[image/type: name]`
 * marker on replay.
 *
 * Filename + image-filter logic mirrors the stored-reference hydrator
 * (ai-worker storedReferenceHydrator) so a persisted description renders
 * identically to a cache-hit-hydrated one.
 *
 * Extracted from ConversationHistoryService to keep that file under the
 * max-lines ceiling; the service exposes a thin delegating method.
 */

import { MessageRole } from '@tzurot/common-types/constants/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  type MessageMetadata,
  type ResolvedImageDescription,
  type StoredReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ReferenceImageDescriptions');

/** Scope identifying which conversation's most-recent user message to update. */
export interface ReferenceDescriptionScope {
  channelId: string;
  personalityId: string;
  personaId: string;
}

/**
 * Collect the resolved image descriptions for one stored reference by matching
 * each of its image attachments against `descriptionsByUrl`.
 *
 * Returns an empty array when the reference has no image attachments or none
 * of them have a description in the map — the caller treats empty as "leave
 * this reference untouched."
 */
export function collectRefImageDescriptions(
  ref: StoredReferencedMessage,
  descriptionsByUrl: Map<string, string>
): ResolvedImageDescription[] {
  const imageAttachments = ref.attachments?.filter(att => att.contentType.startsWith('image/'));
  if (imageAttachments === undefined || imageAttachments.length === 0) {
    return [];
  }

  const descriptions: ResolvedImageDescription[] = [];
  for (const att of imageAttachments) {
    const description = descriptionsByUrl.get(att.url);
    if (description !== undefined && description.length > 0) {
      descriptions.push({ filename: att.name ?? 'image', description });
    }
  }
  return descriptions;
}

/**
 * Persist resolved image descriptions onto the most recent user message's
 * stored referenced-message metadata, matched by attachment URL.
 *
 * Metadata-only: content and token count are untouched (the description text
 * already reached the prompt for the current turn; this write is purely for
 * future replay). Never throws — a history-quality enhancement, not a
 * pipeline-critical step.
 *
 * @param descriptionsByUrl attachment URL → resolved description text
 * @returns number of stored reference entries that gained descriptions
 */
export async function writeReferenceImageDescriptions(
  prisma: PrismaClient,
  scope: ReferenceDescriptionScope,
  descriptionsByUrl: Map<string, string>
): Promise<number> {
  try {
    if (descriptionsByUrl.size === 0) {
      return 0;
    }

    const lastMessage = await prisma.conversationHistory.findFirst({
      where: { ...scope, role: MessageRole.User },
      // Tiebreak on id so two user rows sharing a createdAt ms can't resolve to
      // the wrong row — mirrors the deterministic ordering the read path uses.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (lastMessage === null) {
      logger.warn({}, 'No user message found to persist reference image descriptions');
      return 0;
    }

    const metadata = (lastMessage.messageMetadata as MessageMetadata | null) ?? undefined;
    const refs = metadata?.referencedMessages;
    if (refs === undefined || refs.length === 0) {
      return 0;
    }

    let updatedRefs = 0;
    const enrichedRefs = refs.map(ref => {
      const descriptions = collectRefImageDescriptions(ref, descriptionsByUrl);
      if (descriptions.length === 0) {
        return ref;
      }
      updatedRefs++;
      // Intentional replace, not merge: a single preprocessing pass assembles
      // ALL of a message's reference images into referenceAttachments, so one
      // call's descriptionsByUrl covers every image — partial maps don't occur.
      return { ...ref, resolvedImageDescriptions: descriptions };
    });

    if (updatedRefs === 0) {
      return 0;
    }

    await prisma.conversationHistory.update({
      where: { id: lastMessage.id },
      data: { messageMetadata: { ...metadata, referencedMessages: enrichedRefs } },
    });

    logger.debug(
      { messageId: lastMessage.id, updatedRefs },
      'Persisted reference image descriptions to stored metadata'
    );
    return updatedRefs;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to persist reference image descriptions');
    return 0;
  }
}
