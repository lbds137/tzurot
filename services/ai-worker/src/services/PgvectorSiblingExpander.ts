/**
 * Pgvector Sibling Chunk Expander
 * Fetches and merges sibling chunks for chunked memory retrieval
 */

import { type PrismaClient, createLogger } from '@tzurot/common-types';
import {
  mapQueryResultToDocument,
  extractChunkGroups,
  mergeSiblings,
} from '../utils/memoryUtils.js';
import type { MemoryQueryResult, MemoryDocument } from './PgvectorTypes.js';

const logger = createLogger('PgvectorSiblingExpander');

/**
 * Fetch all chunks in a chunk group, ordered by chunkIndex
 */
export async function fetchChunkSiblings(
  prisma: PrismaClient,
  chunkGroupId: string,
  personaId: string
): Promise<MemoryDocument[]> {
  const memories = await prisma.$queryRaw<MemoryQueryResult[]>`
    SELECT m.id, m.content, m.persona_id, m.personality_id, m.session_id,
           m.canon_scope, m.summary_type, m.channel_id, m.guild_id,
           m.message_ids, m.senders, m.created_at,
           m.chunk_group_id, m.chunk_index, m.total_chunks,
           0::float8 as distance,
           COALESCE(persona.preferred_name, persona.name) as persona_name,
           owner.username as owner_username,
           COALESCE(personality.display_name, personality.name) as personality_name
    FROM memories m
    JOIN personas persona ON m.persona_id = persona.id
    JOIN users owner ON persona.owner_id = owner.id
    JOIN personalities personality ON m.personality_id = personality.id
    WHERE m.persona_id = ${personaId}::uuid
      AND m.chunk_group_id = ${chunkGroupId}::uuid
    ORDER BY m.chunk_index ASC
  `;

  // SQL sets distance=0 for siblings, mapQueryResultToDocument handles score calculation
  return memories.map(mapQueryResultToDocument);
}

/**
 * Expand memory results to include sibling chunks
 * - Finds all chunk groups in results
 * - Fetches missing siblings for each group
 * - Returns deduplicated results
 */
export async function expandWithSiblings(
  prisma: PrismaClient,
  documents: MemoryDocument[],
  personaId: string
): Promise<MemoryDocument[]> {
  const { chunkGroups, seenIds } = extractChunkGroups(documents);
  if (chunkGroups.size === 0) {
    return documents;
  }

  logger.debug(
    { chunkGroupCount: chunkGroups.size, originalDocCount: documents.length },
    '[PgvectorSiblingExpander] Expanding results with sibling chunks'
  );

  let allDocs = [...documents];
  for (const groupId of chunkGroups) {
    try {
      const siblings = await fetchChunkSiblings(prisma, groupId, personaId);
      allDocs = mergeSiblings(allDocs, siblings, seenIds);
    } catch (error) {
      logger.error(
        { err: error, chunkGroupId: groupId },
        '[PgvectorSiblingExpander] Failed to fetch chunk siblings'
      );
    }
  }

  logger.debug(
    { expandedDocCount: allDocs.length, addedSiblings: allDocs.length - documents.length },
    '[PgvectorSiblingExpander] Sibling expansion complete'
  );
  return allDocs;
}
