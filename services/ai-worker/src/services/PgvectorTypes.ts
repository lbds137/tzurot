/**
 * Pgvector Memory Types
 * Type definitions for PostgreSQL + pgvector memory adapter
 */

import { z } from 'zod';

export interface MemoryQueryOptions {
  personaId: string; // Required: which persona's memories to search
  personalityId?: string; // Optional: filter to specific personality within persona
  sessionId?: string;
  limit?: number;
  /**
   * Minimum cosine similarity score (0-1 range, where 1 = identical vectors).
   * Default: AI_DEFAULTS.MEMORY_SCORE_THRESHOLD (mirrors the config default).
   *
   * This represents a MINIMUM similarity threshold - only memories with
   * similarity >= this value will be returned.
   *
   * Internally converted to pgvector distance using: distance < (1 - similarity)
   * - pgvector cosine distance range: 0-2 (0=identical, 1=orthogonal, 2=opposite)
   * - For normalized embeddings, practically 0-1
   *
   * Examples:
   * - 0.85 → distance < 0.15 → highly similar memories only
   * - 0.70 → distance < 0.30 → moderately similar memories
   * - 0.50 (default) → distance < 0.50 → loosely related memories
   */
  scoreThreshold?: number;
  excludeNewerThan?: number; // Unix timestamp - exclude memories created after this time
  /**
   * Channel IDs to scope the search to (for LTM scoping when user references channels)
   * When provided, uses waterfall retrieval: channel-scoped first, then global backfill
   */
  channelIds?: string[];
  /**
   * Ratio of total limit to allocate to channel-scoped queries (0-1)
   * Default: 0.5 (50% of limit for channel-scoped, remaining for global)
   */
  channelBudgetRatio?: number;
  /**
   * Memory IDs to exclude from results (used for deduplication in waterfall queries)
   */
  excludeIds?: string[];
  /**
   * When true, if a matching memory is part of a chunk group,
   * also retrieve all sibling chunks in that group.
   * This enables reassembling the full original text from chunks.
   * Default: true (to ensure complete memory retrieval)
   *
   * @example
   * // Query with sibling retrieval (default behavior)
   * const memories = await adapter.queryMemories(query, { personaId: '...' });
   *
   * // Reassemble chunked memories
   * const grouped = groupByChunkId(memories);
   * for (const [groupId, chunks] of grouped) {
   *   const sorted = sortChunksByIndex(chunks);
   *   const fullText = reassembleChunks(sorted.map(c => c.pageContent));
   * }
   *
   * // Opt out of sibling retrieval (only get matched chunks)
   * const matchedOnly = await adapter.queryMemories(query, {
   *   personaId: '...',
   *   includeSiblings: false
   * });
   */
  includeSiblings?: boolean;
}

/**
 * Storage-layer memory document — what the pgvector adapter returns from raw
 * similarity queries. Distinct from the RAG-layer `MemoryDocument` defined in
 * `ConversationalRAGTypes.ts` (which has typed `metadata` fields like `score`
 * and `createdAt`). Both shapes share `pageContent` + optional `metadata`, but
 * the storage layer's metadata is wider (`Record<string, unknown>`) because
 * downstream stages may add fields the storage layer doesn't know about.
 *
 * The two interfaces remain structurally compatible at the boundary where
 * storage flows into RAG context — if you change either shape, verify the
 * other still narrows correctly at the consumption site
 * (`MemoryRetriever.retrieveMemoriesAndDecideFocus`).
 *
 * @see ./ConversationalRAGTypes.ts for the RAG-layer `MemoryDocument`
 */
export interface PgvectorMemoryDocument {
  pageContent: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryMetadata {
  personaId: string; // Persona this memory belongs to
  personalityId: string; // Personality this memory is about
  personalityName?: string;
  sessionId?: string;
  canonScope: 'global' | 'personal' | 'session';
  createdAt: number; // Timestamp in milliseconds (from Date.now() or Date.getTime())
  summaryType?: string;
  contextType?: string;
  channelId?: string;
  guildId?: string;
  serverId?: string;
  messageIds?: string[];
  senders?: string[];
  // Import provenance fields (defaults applied in PgvectorMemoryAdapter)
  sourceSystem?: string; // Default: 'tzurot-v3'. Set to 'shapes-inc' for shapes imports.
  isSummarized?: boolean; // Default: false. Set to true for pre-summarized imports.
  legacyShapesUserId?: string; // Shapes.inc user UUID for provenance tracking
  // Chunk linking fields for oversized memories
  chunkGroupId?: string; // UUID linking all chunks from same source memory
  chunkIndex?: number; // 0-based position in chunk sequence
  totalChunks?: number; // Total number of chunks in the group
}

/**
 * Zod schema for MemoryMetadata validation
 * Used to safely parse Prisma Json fields at runtime
 */
export const MemoryMetadataSchema = z.object({
  personaId: z.string(),
  personalityId: z.string(),
  personalityName: z.string().optional(),
  sessionId: z.string().optional(),
  canonScope: z.enum(['global', 'personal', 'session']),
  createdAt: z.number(),
  summaryType: z.string().optional(),
  contextType: z.string().optional(),
  channelId: z.string().optional(),
  guildId: z.string().optional(),
  serverId: z.string().optional(),
  messageIds: z.array(z.string()).optional(),
  senders: z.array(z.string()).optional(),
  // Import provenance fields
  sourceSystem: z.string().optional(),
  isSummarized: z.boolean().optional(),
  legacyShapesUserId: z.string().uuid().optional(),
  // Chunk linking fields
  chunkGroupId: z.string().uuid().optional(),
  chunkIndex: z.number().int().min(0).optional(),
  totalChunks: z.number().int().min(1).optional(),
});

/**
 * Type for raw database query result from pgvector similarity search
 * @internal Used by PgvectorMemoryAdapter and PgvectorQueryBuilder
 */
export interface MemoryQueryResult {
  id: string;
  content: string;
  persona_id: string;
  persona_name: string;
  owner_username: string; // Discord username for disambiguation when persona name matches personality name
  personality_id: string;
  personality_name: string;
  session_id: string | null;
  canon_scope: string;
  summary_type: string | null;
  channel_id: string | null;
  guild_id: string | null;
  message_ids: string[] | null;
  senders: string[] | null;
  created_at: Date | string;
  distance: number;
  // Chunk linking fields
  chunk_group_id: string | null;
  chunk_index: number | null;
  total_chunks: number | null;
}

/**
 * Normalized metadata ready for database insertion
 */
export interface NormalizedMetadata {
  sessionId: string | null;
  canonScope: string;
  summaryType: string | null;
  channelId: string | null;
  guildId: string | null;
  messageIds: string[];
  senders: string[];
  createdAt: string;
}
