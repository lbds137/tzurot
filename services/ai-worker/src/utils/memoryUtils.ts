/**
 * Memory Utilities
 * Pure helper functions extracted from PgvectorMemoryAdapter
 */

import type {
  MemoryMetadata,
  NormalizedMetadata,
  MemoryQueryResult,
  PgvectorMemoryDocument,
  RetrievalComponents,
} from '../services/PgvectorTypes.js';
import { replacePromptPlaceholders } from './promptPlaceholders.js';

/**
 * Embedding dimension for BGE-small-en-v1.5 model (local embeddings)
 * BGE-small-en-v1.5 produces 384-dimensional vectors
 * Previously: text-embedding-3-small produced 1536-dimensional vectors (OpenAI)
 */
export { LOCAL_EMBEDDING_DIMENSIONS as EMBEDDING_DIMENSION } from '@tzurot/embeddings';

// Re-export shared memory UUID utilities from common-types (single source of truth)
export { hashContent, deterministicMemoryUuid } from '@tzurot/common-types/constants/memory';

/**
 * Type guard to validate a string ID is present and non-empty
 * Handles null, undefined, and empty string cases
 *
 * @example
 * if (isValidId(options.personalityId)) {
 *   // TypeScript knows personalityId is string here
 * }
 */
export function isValidId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Normalize metadata for database insertion
 * Converts optional fields to null and formats dates
 */
export function normalizeMetadata(metadata: MemoryMetadata): NormalizedMetadata {
  const nonEmpty = (val: string | undefined): string | null =>
    val !== undefined && val.length > 0 ? val : null;

  return {
    sessionId: nonEmpty(metadata.sessionId),
    canonScope: nonEmpty(metadata.canonScope) ?? 'personal',
    summaryType: nonEmpty(metadata.summaryType),
    channelId: nonEmpty(metadata.channelId),
    guildId: nonEmpty(metadata.guildId),
    messageIds: metadata.messageIds ?? [],
    senders: metadata.senders ?? [],
    createdAt: new Date(metadata.createdAt).toISOString(),
  };
}

/**
 * Transform a raw database query result into a PgvectorMemoryDocument
 * Handles placeholder replacement and metadata normalization
 */
export function mapQueryResultToDocument(memory: MemoryQueryResult): PgvectorMemoryDocument {
  // Replace {user} and {assistant} tokens with actual names
  // Pass owner_username for disambiguation when persona name matches personality name
  const content = replacePromptPlaceholders(
    memory.content,
    memory.persona_name,
    memory.personality_name,
    memory.owner_username
  );

  // Hybrid rows carry the fused RRF value as `score` plus per-arm explain
  // components. Sibling-expander rows (no rrf_score — their query predates
  // fusion) keep the legacy 1-distance similarity so their hardcoded
  // distance=0 still reads as the intentional "perfect ride-along" marker.
  const rrfScore = memory.rrf_score ?? null;
  const retrieval: RetrievalComponents | null =
    rrfScore !== null
      ? {
          denseSimilarity:
            memory.distance !== null && memory.distance !== undefined ? 1 - memory.distance : null,
          denseRank: memory.dense_rank ?? null,
          ftsRank: memory.fts_rank ?? null,
          recencyRank: memory.recency_rank ?? null,
          rrfScore,
        }
      : null;

  return {
    pageContent: content,
    metadata: {
      id: memory.id,
      personaId: memory.persona_id,
      personalityId: memory.personality_id,
      personalityName: memory.personality_name,
      sessionId: memory.session_id,
      canonScope: memory.canon_scope,
      summaryType: memory.summary_type,
      channelId: memory.channel_id,
      guildId: memory.guild_id,
      messageIds: memory.message_ids,
      senders: memory.senders,
      createdAt: new Date(memory.created_at).getTime(),
      distance: memory.distance,
      score: rrfScore ?? 1 - (memory.distance ?? 0),
      retrieval,
      chunkGroupId: memory.chunk_group_id,
      chunkIndex: memory.chunk_index,
      totalChunks: memory.total_chunks,
    },
  };
}

/**
 * Extract unique chunk group IDs and seen document IDs from a list of documents
 * Used for sibling chunk expansion
 */
export function extractChunkGroups(documents: PgvectorMemoryDocument[]): {
  chunkGroups: Set<string>;
  seenIds: Set<string>;
} {
  const chunkGroups = new Set<string>();
  const seenIds = new Set<string>();

  for (const doc of documents) {
    const groupId = doc.metadata?.chunkGroupId as string | null | undefined;
    const id = doc.metadata?.id as string | null | undefined;
    if (isValidId(groupId)) {
      chunkGroups.add(groupId);
    }
    if (isValidId(id)) {
      seenIds.add(id);
    }
  }

  return { chunkGroups, seenIds };
}

/**
 * Merge sibling documents into the main document list, avoiding duplicates
 */
export function mergeSiblings(
  documents: PgvectorMemoryDocument[],
  siblings: PgvectorMemoryDocument[],
  seenIds: Set<string>
): PgvectorMemoryDocument[] {
  const result = [...documents];
  for (const sibling of siblings) {
    const sibId = sibling.metadata?.id as string | null | undefined;
    if (isValidId(sibId) && !seenIds.has(sibId)) {
      result.push(sibling);
      seenIds.add(sibId);
    }
  }
  return result;
}
