/**
 * Memory Utilities
 * Pure helper functions extracted from PgvectorMemoryAdapter
 */

import type {
  MemoryMetadata,
  NormalizedMetadata,
  MemoryQueryResult,
  PgvectorMemoryDocument,
} from '../services/PgvectorTypes.js';
import { replacePromptPlaceholders } from './promptPlaceholders.js';
import { splitMemoryContent } from '@tzurot/common-types/utils/memoryContentSplit';
import { ARCHIVE_SUMMARY_PROMPT_VERSION } from '../services/archiveSummary/constants.js';

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

  // @spec MEM-ARCH-006 — unparseable rows leave the split fields undefined
  // Split the stored `{user}: ... \n{assistant}: ...` template back into its
  // parts for the memory-archive split render. `split` is null for legacy
  // rows that don't match the template — both fields below stay undefined in
  // that case (never a default), since their absence is what the split
  // renderer reads to pick the verbatim fallback.
  const split = splitMemoryContent(memory.content);

  // @spec MEM-ARCH-021 — a stored `done` summary renders REGARDLESS of prompt
  // version: a version bump drives re-enqueue, it must never blank the archive.
  // Chunk rows never render a summary: the write side never summarizes them,
  // so excluding them here keeps that invariant local — it stops one chunk of
  // a group from ever rendering as a summary beside its verbatim siblings.
  const storedSummary = memory.assistant_summary;
  const hasSummary =
    memory.chunk_group_id === null &&
    memory.summary_status === 'done' &&
    typeof storedSummary === 'string' &&
    storedSummary.length > 0;

  // @spec MEM-ARCH-022 — retrieval-time refresh eligibility. Chunk rows are
  // never eligible: the write side deliberately never enqueues them (a chunk is
  // a slice of the template, so it could only die as `no_template`), which is
  // exactly why they sit at a null status forever — without this clause every
  // sibling expansion would re-enqueue them. `pending` is excluded because a
  // job is already in flight. `done` and `dead` are excluded only at the
  // CURRENT prompt version: a version bump is what re-admits them, and B1's
  // processor is built to accept exactly that. Absence of the flag is what the
  // caller reads as "not eligible" — never write `false`.
  const summaryVersionIsStale = memory.summary_prompt_version !== ARCHIVE_SUMMARY_PROMPT_VERSION;
  const summaryRefreshEligible =
    memory.chunk_group_id === null &&
    (memory.summary_status === null ||
      memory.summary_status === 'failed' ||
      ((memory.summary_status === 'done' || memory.summary_status === 'dead') &&
        summaryVersionIsStale));

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
      score: 1 - memory.distance,
      chunkGroupId: memory.chunk_group_id,
      chunkIndex: memory.chunk_index,
      totalChunks: memory.total_chunks,
      ...(split !== null
        ? {
            userTurn: replacePromptPlaceholders(
              split.user,
              memory.persona_name,
              memory.personality_name,
              memory.owner_username
            ),
            subjectName: memory.persona_name,
          }
        : {}),
      ...(hasSummary ? { assistantSummary: storedSummary } : {}),
      ...(summaryRefreshEligible ? { summaryRefreshEligible: true } : {}),
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
