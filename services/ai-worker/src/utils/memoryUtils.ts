/**
 * Memory Utilities
 * Pure helper functions extracted from PgvectorMemoryAdapter
 */

import crypto from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import type {
  MemoryMetadata,
  NormalizedMetadata,
  MemoryQueryResult,
  MemoryDocument,
} from '../services/PgvectorTypes.js';
import { replacePromptPlaceholders } from './promptPlaceholders.js';

/**
 * Embedding dimension for BGE-small-en-v1.5 model (local embeddings)
 * BGE-small-en-v1.5 produces 384-dimensional vectors
 * Previously: text-embedding-3-small produced 1536-dimensional vectors (OpenAI)
 */
export { LOCAL_EMBEDDING_DIMENSIONS as EMBEDDING_DIMENSION } from '@tzurot/embeddings';

// Namespace UUID for memories (DNS namespace -> tzurot-v3-memory namespace)
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const MEMORY_NAMESPACE = uuidv5('tzurot-v3-memory', DNS_NAMESPACE);

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
 * Hash content using SHA-256 (truncated to 32 chars)
 * Used for deterministic memory UUID generation
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
}

/**
 * Generate a deterministic UUID for a memory based on persona, personality, and content
 * Ensures the same memory content always produces the same ID (for idempotent storage)
 */
export function deterministicMemoryUuid(
  personaId: string,
  personalityId: string,
  content: string
): string {
  const key = `${personaId}:${personalityId}:${hashContent(content)}`;
  return uuidv5(key, MEMORY_NAMESPACE);
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
 * Transform a raw database query result into a MemoryDocument
 * Handles placeholder replacement and metadata normalization
 */
export function mapQueryResultToDocument(memory: MemoryQueryResult): MemoryDocument {
  // Replace {user} and {assistant} tokens with actual names
  // Pass owner_username for disambiguation when persona name matches personality name
  const content = replacePromptPlaceholders(
    memory.content,
    memory.persona_name,
    memory.personality_name,
    memory.owner_username
  );

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
    },
  };
}

/**
 * Extract unique chunk group IDs and seen document IDs from a list of documents
 * Used for sibling chunk expansion
 */
export function extractChunkGroups(documents: MemoryDocument[]): {
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
  documents: MemoryDocument[],
  siblings: MemoryDocument[],
  seenIds: Set<string>
): MemoryDocument[] {
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
