/**
 * Stored Reference Hydrator
 *
 * Enriches StoredReferencedMessage objects in conversation history with:
 * - Persona resolution (Discord ID → persona name + UUID)
 * - Vision descriptions (attachment ID/URL → cached image description)
 *
 * Follows the same mutation pattern as injectImageDescriptions() in RAGUtils.ts.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  type AttachmentEnrichment,
  type StoredReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { VisionDescriptionCache } from './VisionDescriptionCache.js';
import { batchResolveByDiscordIds } from './reference/BatchResolvers.js';
import type { RawHistoryEntry } from '../jobs/utils/conversationTypes.js';

const logger = createLogger('StoredReferenceHydrator');

/** Collect all StoredReferencedMessage objects from conversation history */
function collectRefs(rawHistory: RawHistoryEntry[]): StoredReferencedMessage[] {
  const allRefs: StoredReferencedMessage[] = [];
  for (const entry of rawHistory) {
    if (entry.messageMetadata?.referencedMessages !== undefined) {
      allRefs.push(...entry.messageMetadata.referencedMessages);
    }
  }
  return allRefs;
}

/** Resolve persona names + IDs for refs that have authorDiscordId. Returns count of resolved. */
async function resolvePersonas(
  refs: StoredReferencedMessage[],
  prisma: PrismaClient
): Promise<number> {
  const uniqueDiscordIds = [
    ...new Set(
      refs
        .map(ref => ref.authorDiscordId)
        .filter((id): id is string => id !== undefined && id.length > 0)
    ),
  ];

  if (uniqueDiscordIds.length === 0) {
    return 0;
  }

  const personaMap = await batchResolveByDiscordIds(prisma, uniqueDiscordIds);
  let resolved = 0;

  for (const ref of refs) {
    if (ref.authorDiscordId === undefined || ref.authorDiscordId.length === 0) {
      continue;
    }
    const persona = personaMap.get(ref.authorDiscordId);
    if (persona !== undefined) {
      ref.resolvedPersonaName = persona.personaName;
      ref.resolvedPersonaId = persona.personaId;
      resolved++;
    }
  }

  return resolved;
}

/**
 * Heal a stored reference whose images were never written down, from the vision
 * cache. Returns hit count.
 *
 * A fallback, not the primary source: the worker now persists what it built
 * onto the row itself, so this only fires for rows written before that (or
 * where the write missed). Rows that already carry enrichment are left alone —
 * the persisted copy is the one the renderer's own build produced.
 */
async function resolveVisionDescriptions(
  refs: StoredReferencedMessage[],
  visionCache: VisionDescriptionCache
): Promise<number> {
  let hits = 0;

  for (const ref of refs) {
    if (ref.attachmentEnrichment !== undefined && ref.attachmentEnrichment.length > 0) {
      continue;
    }
    const imageAttachments = ref.attachments?.filter(att => att.contentType.startsWith('image/'));
    if (imageAttachments === undefined || imageAttachments.length === 0) {
      continue;
    }

    const enrichment: AttachmentEnrichment[] = [];
    for (const att of imageAttachments) {
      const description = await visionCache.get({ attachmentId: att.id, url: att.url });
      if (description !== null) {
        enrichment.push({ url: att.url, kind: 'image', description });
      }
    }

    if (enrichment.length > 0) {
      ref.attachmentEnrichment = enrichment;
      hits++;
    }
  }

  return hits;
}

/**
 * Hydrate stored references in conversation history with persona and vision data.
 * Mutates refs in-place (same pattern as injectImageDescriptions).
 */
export async function hydrateStoredReferences(
  rawHistory: RawHistoryEntry[] | undefined,
  prisma: PrismaClient,
  visionCache: VisionDescriptionCache
): Promise<void> {
  if (rawHistory === undefined || rawHistory.length === 0) {
    return;
  }

  const allRefs = collectRefs(rawHistory);
  if (allRefs.length === 0) {
    return;
  }

  const personaResolved = await resolvePersonas(allRefs, prisma);
  const visionHits = await resolveVisionDescriptions(allRefs, visionCache);

  if (personaResolved > 0 || visionHits > 0) {
    logger.info(
      { totalRefs: allRefs.length, personaResolved, visionHits },
      'Hydrated stored references'
    );
  }
}
