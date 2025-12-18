/* eslint-disable max-lines */
/**
 * Pgvector Memory Adapter
 * PostgreSQL + pgvector adapter for memory retrieval and storage
 */

import { type PrismaClient, Prisma } from '@tzurot/common-types';
import { OpenAI } from 'openai';
import { v5 as uuidv5 } from 'uuid';
import crypto from 'crypto';
import { z } from 'zod';
import {
  createLogger,
  MODEL_DEFAULTS,
  AI_DEFAULTS,
  filterValidDiscordIds,
  splitTextByTokens,
  generateMemoryChunkGroupUuid,
  countTextTokens,
} from '@tzurot/common-types';
import { replacePromptPlaceholders } from '../utils/promptPlaceholders.js';

const logger = createLogger('PgvectorMemoryAdapter');

export interface MemoryQueryOptions {
  personaId: string; // Required: which persona's memories to search
  personalityId?: string; // Optional: filter to specific personality within persona
  sessionId?: string;
  limit?: number;
  /**
   * Minimum cosine similarity score (0-1 range, where 1 = identical vectors)
   * Default: 0.85 (returns only highly similar memories)
   *
   * This represents a MINIMUM similarity threshold - only memories with
   * similarity >= this value will be returned.
   *
   * Internally converted to pgvector distance using: distance < (1 - similarity)
   * - pgvector cosine distance range: 0-2 (0=identical, 1=orthogonal, 2=opposite)
   * - For normalized embeddings, practically 0-1
   *
   * Examples:
   * - 0.85 (default) → distance < 0.15 → highly similar memories only
   * - 0.70 → distance < 0.30 → moderately similar memories
   * - 0.50 → distance < 0.50 → loosely related memories
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

export interface MemoryDocument {
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
  // Chunk linking fields
  chunkGroupId: z.string().uuid().optional(),
  chunkIndex: z.number().int().min(0).optional(),
  totalChunks: z.number().int().min(1).optional(),
});

// Namespace UUID for memories
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const MEMORY_NAMESPACE = uuidv5('tzurot-v3-memory', DNS_NAMESPACE);

// Helper to hash content
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
}

// Helper to generate deterministic memory UUID
function deterministicMemoryUuid(
  personaId: string,
  personalityId: string,
  content: string
): string {
  const key = `${personaId}:${personalityId}:${hashContent(content)}`;
  return uuidv5(key, MEMORY_NAMESPACE);
}

/**
 * Type for raw database query result from pgvector similarity search
 */
interface MemoryQueryResult {
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
 * Adapter that provides memory retrieval and storage using pgvector
 */
export class PgvectorMemoryAdapter {
  private prisma: PrismaClient;
  private openai: OpenAI;
  private embeddingModel: string;

  constructor(prisma: PrismaClient, openaiApiKey: string) {
    this.prisma = prisma;
    this.openai = new OpenAI({
      apiKey: openaiApiKey,
    });
    this.embeddingModel =
      process.env.EMBEDDING_MODEL !== undefined && process.env.EMBEDDING_MODEL.length > 0
        ? process.env.EMBEDDING_MODEL
        : MODEL_DEFAULTS.EMBEDDING;
    logger.info({ embeddingModel: this.embeddingModel }, 'Pgvector Memory Adapter initialized');
  }

  /**
   * Query memories using vector similarity search
   */
  async queryMemories(query: string, options: MemoryQueryOptions): Promise<MemoryDocument[]> {
    try {
      // Generate embedding for query
      const embeddingResponse = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: query,
      });
      const queryEmbedding = embeddingResponse.data[0].embedding;

      // Validate embedding dimensions (text-embedding-3-small produces 1536 dimensions)
      const expectedDimensions = 1536;
      if (queryEmbedding?.length !== expectedDimensions) {
        throw new Error(
          `Invalid embedding dimensions: expected ${expectedDimensions}, got ${queryEmbedding?.length ?? 0}`
        );
      }

      // Format embedding as PostgreSQL vector
      // SAFETY: embeddingVector is constructed from validated numeric array only
      // Prisma.raw() is safe here because we control the data source (OpenAI embeddings)
      const embeddingVector = `[${queryEmbedding.join(',')}]`;

      // Build query with vector similarity search
      const limit =
        options.limit !== undefined && options.limit !== null && options.limit > 0
          ? options.limit
          : 10;
      // scoreThreshold is MINIMUM similarity (0-1 range)
      // Default 0.85 = only show highly similar memories
      const minSimilarity =
        options.scoreThreshold !== undefined &&
        options.scoreThreshold !== null &&
        options.scoreThreshold > 0
          ? options.scoreThreshold
          : 0.85;

      // pgvector distance: 0 = identical, 2 = opposite (practically 0-1 for normalized embeddings)
      // Cosine Distance = 1 - Cosine Similarity
      // If we want similarity > 0.85, we need distance < (1 - 0.85) = 0.15
      const maxDistance = 1 - minSimilarity;

      // Build WHERE conditions using Prisma.sql for safe parameterization
      const whereConditions: Prisma.Sql[] = [Prisma.sql`m.persona_id = ${options.personaId}::uuid`];

      // Optional personality filter
      if (options.personalityId !== undefined && options.personalityId.length > 0) {
        whereConditions.push(Prisma.sql`m.personality_id = ${options.personalityId}::uuid`);
      }

      // Exclude newer memories (for conversation history overlap prevention)
      if (
        options.excludeNewerThan !== undefined &&
        options.excludeNewerThan !== null &&
        options.excludeNewerThan > 0
      ) {
        // excludeNewerThan is already in milliseconds - don't multiply by 1000
        const excludeDate = new Date(options.excludeNewerThan).toISOString();
        whereConditions.push(Prisma.sql`m.created_at < ${excludeDate}::timestamptz`);
      }

      // Exclude specific memory IDs (for waterfall deduplication)
      if (options.excludeIds !== undefined && options.excludeIds.length > 0) {
        // Build array of UUIDs for NOT IN clause
        const excludeUuids = options.excludeIds.map(id => Prisma.sql`${id}::uuid`);
        whereConditions.push(Prisma.sql`m.id NOT IN (${Prisma.join(excludeUuids, ', ')})`);
      }

      // Filter by channel IDs (for channel-scoped queries)
      if (options.channelIds !== undefined && options.channelIds.length > 0) {
        // Build array of channel IDs for IN clause
        const channelValues = options.channelIds.map(id => Prisma.sql`${id}`);
        whereConditions.push(Prisma.sql`m.channel_id IN (${Prisma.join(channelValues, ', ')})`);
      }

      // Build WHERE clause from conditions
      const whereClause = Prisma.join(whereConditions, ' AND ');

      // Build SQL query using Prisma.join() to safely combine parameterized and raw parts
      // NOTE: The embedding vector must use Prisma.raw() because:
      // 1. pgvector requires exact '[n,n,n,...]' format which can't be parameterized
      // 2. embeddingVector is validated and constructed from numeric array only (safe)
      // 3. Prisma.raw() cannot be nested in Prisma.sql, so we use Prisma.join() instead
      const sqlQuery = Prisma.join(
        [
          Prisma.sql`
            SELECT
              m.id,
              m.persona_id,
              m.personality_id,
              m.content,
              m.embedding <=> `,
          Prisma.raw(`'${embeddingVector}'::vector`),
          Prisma.sql` AS distance,
              m.session_id,
              m.canon_scope,
              m.summary_type,
              m.channel_id,
              m.guild_id,
              m.message_ids,
              m.senders,
              m.created_at,
              m.chunk_group_id,
              m.chunk_index,
              m.total_chunks,
              COALESCE(persona.preferred_name, persona.name) as persona_name,
              owner.username as owner_username,
              COALESCE(personality.display_name, personality.name) as personality_name
            FROM memories m
            JOIN personas persona ON m.persona_id = persona.id
            JOIN users owner ON persona.owner_id = owner.id
            JOIN personalities personality ON m.personality_id = personality.id
            WHERE `,
          whereClause,
          Prisma.sql`
              AND m.embedding <=> `,
          Prisma.raw(`'${embeddingVector}'::vector`),
          Prisma.sql` < ${maxDistance}
            ORDER BY distance ASC
            LIMIT ${limit}
          `,
        ],
        ''
      );

      logger.debug(
        {
          personaId: options.personaId,
          personalityId: options.personalityId,
          limit,
          minSimilarity,
          maxDistance,
        },
        'Querying memories with pgvector'
      );

      const memories = await this.prisma.$queryRaw<MemoryQueryResult[]>(sqlQuery);

      // Convert to MemoryDocument format and inject persona/personality names
      let documents: MemoryDocument[] = memories.map(memory => {
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
            createdAt: new Date(memory.created_at).getTime(), // Store as milliseconds for formatMemoryTimestamp
            distance: memory.distance,
            score: 1 - memory.distance, // Convert distance back to similarity score
            // Chunk linking metadata
            chunkGroupId: memory.chunk_group_id,
            chunkIndex: memory.chunk_index,
            totalChunks: memory.total_chunks,
          },
        };
      });

      // Expand results with sibling chunks (default: true for complete memory retrieval)
      if (options.includeSiblings !== false && documents.length > 0) {
        documents = await this.expandWithSiblings(documents, options.personaId);
      }

      logger.debug(
        `Retrieved ${documents.length} memories for query (persona: ${options.personaId}, personality: ${options.personalityId !== undefined && options.personalityId.length > 0 ? options.personalityId : 'all'})`
      );
      return documents;
    } catch (error) {
      const errorDetails = {
        personaId: options.personaId,
        personalityId: options.personalityId,
        queryLength: query.length,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      logger.error(
        { err: error, ...errorDetails },
        `Failed to query memories for persona: ${options.personaId}`
      );
      // Return empty array - query failures shouldn't block conversation generation
      return [];
    }
  }

  /**
   * Add a memory - for storing new interactions
   *
   * Automatically splits oversized text into chunks if it exceeds the embedding
   * token limit (text-embedding-3-small has 8191 token limit). Each chunk is
   * stored with linking metadata (chunkGroupId, chunkIndex, totalChunks) to
   * enable sibling retrieval.
   */
  async addMemory(data: { text: string; metadata: MemoryMetadata }): Promise<void> {
    const { chunks, wasChunked, originalTokenCount } = splitTextByTokens(data.text);

    if (!wasChunked) {
      // Text fits within limit - store as single memory
      await this.storeSingleMemory(data);
      return;
    }

    // Text exceeds limit - split into chunks with linking metadata
    // Use deterministic UUID so retrying same memory produces same chunk group
    const chunkGroupId = generateMemoryChunkGroupUuid(
      data.metadata.personaId,
      data.metadata.personalityId,
      data.text
    );

    logger.info(
      {
        chunkGroupId,
        totalChunks: chunks.length,
        originalTokenCount,
        personaId: data.metadata.personaId,
        personalityId: data.metadata.personalityId,
      },
      '[PgvectorMemoryAdapter] Splitting oversized memory into chunks'
    );

    // Store all chunks in parallel for better performance
    await Promise.all(
      chunks.map((chunkText, i) =>
        this.storeSingleMemory({
          text: chunkText,
          metadata: {
            ...data.metadata,
            chunkGroupId,
            chunkIndex: i,
            totalChunks: chunks.length,
          },
        })
      )
    );

    logger.debug(
      { chunkGroupId, storedChunks: chunks.length },
      '[PgvectorMemoryAdapter] Successfully stored all memory chunks'
    );
  }

  /**
   * Store a single memory record (internal helper)
   * Used by addMemory() for both single memories and individual chunks
   */
  private async storeSingleMemory(data: { text: string; metadata: MemoryMetadata }): Promise<void> {
    try {
      // Defensive validation: warn if text exceeds embedding limit
      // This shouldn't happen in normal operation (splitTextByTokens handles it),
      // but continuation prefixes could push chunks slightly over
      const textTokenCount = countTextTokens(data.text);
      if (textTokenCount > AI_DEFAULTS.EMBEDDING_MAX_TOKENS) {
        logger.warn(
          {
            tokenCount: textTokenCount,
            maxTokens: AI_DEFAULTS.EMBEDDING_MAX_TOKENS,
            chunkIndex: data.metadata.chunkIndex,
            chunkGroupId: data.metadata.chunkGroupId,
            textLength: data.text.length,
          },
          '[PgvectorMemoryAdapter] Text exceeds embedding token limit - may fail'
        );
      }

      const embedding = await this.generateEmbedding(data.text);

      // For chunked memories, include chunkIndex in the hash for deterministic UUIDs
      const contentForHash =
        data.metadata.chunkIndex !== undefined
          ? `${data.text}::chunk::${data.metadata.chunkIndex}`
          : data.text;

      const memoryId = deterministicMemoryUuid(
        data.metadata.personaId,
        data.metadata.personalityId,
        contentForHash
      );
      const normalized = this.normalizeMetadata(data.metadata);

      await this.prisma.$executeRaw`
        INSERT INTO memories (
          id, persona_id, personality_id, source_system, content, embedding,
          session_id, canon_scope, summary_type, channel_id, guild_id,
          message_ids, senders, is_summarized, created_at,
          chunk_group_id, chunk_index, total_chunks
        ) VALUES (
          ${memoryId}::uuid,
          ${data.metadata.personaId}::uuid,
          ${data.metadata.personalityId}::uuid,
          'tzurot-v3',
          ${data.text},
          ${`[${embedding.join(',')}]`}::vector(1536),
          ${normalized.sessionId},
          ${normalized.canonScope},
          ${normalized.summaryType},
          ${normalized.channelId},
          ${normalized.guildId},
          ${normalized.messageIds}::text[],
          ${normalized.senders}::text[],
          false,
          ${normalized.createdAt}::timestamptz,
          ${data.metadata.chunkGroupId ?? null}::uuid,
          ${data.metadata.chunkIndex ?? null},
          ${data.metadata.totalChunks ?? null}
        )
        ON CONFLICT (id) DO NOTHING
      `;

      logger.debug(
        {
          memoryId,
          personaId: data.metadata.personaId,
          chunkIndex: data.metadata.chunkIndex,
        },
        'Added memory to pgvector'
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          personaId: data.metadata.personaId,
          chunkIndex: data.metadata.chunkIndex,
        },
        `Failed to add memory for persona: ${data.metadata.personaId}`
      );
      throw error;
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    const embedding = response.data[0].embedding;
    const expectedDimensions = 1536;
    if (embedding?.length !== expectedDimensions) {
      throw new Error(
        `Invalid embedding dimensions: expected ${expectedDimensions}, got ${embedding?.length || 0}`
      );
    }
    return embedding;
  }

  private normalizeMetadata(metadata: MemoryMetadata): {
    sessionId: string | null;
    canonScope: string;
    summaryType: string | null;
    channelId: string | null;
    guildId: string | null;
    messageIds: string[];
    senders: string[];
    createdAt: string;
  } {
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
   * Fetch all chunks in a chunk group, ordered by chunkIndex
   * @internal
   */
  private async fetchChunkSiblings(
    chunkGroupId: string,
    personaId: string
  ): Promise<MemoryDocument[]> {
    const memories = await this.prisma.$queryRaw<MemoryQueryResult[]>`
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

    return memories.map(memory => {
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
          distance: 0, // Siblings have no distance (not from similarity search)
          score: 1,
          chunkGroupId: memory.chunk_group_id,
          chunkIndex: memory.chunk_index,
          totalChunks: memory.total_chunks,
        },
      };
    });
  }

  /**
   * Expand memory results to include sibling chunks
   * - Finds all chunk groups in results
   * - Fetches missing siblings for each group
   * - Returns deduplicated results
   * @internal
   */
  private async expandWithSiblings(
    documents: MemoryDocument[],
    personaId: string
  ): Promise<MemoryDocument[]> {
    // Find unique chunk groups that need expansion
    const chunkGroups = new Set<string>();
    const seenIds = new Set<string>();

    for (const doc of documents) {
      const groupId = doc.metadata?.chunkGroupId as string | undefined;
      const id = doc.metadata?.id as string | undefined;
      if (groupId !== undefined && groupId.length > 0) {
        chunkGroups.add(groupId);
      }
      if (id !== undefined && id.length > 0) {
        seenIds.add(id);
      }
    }

    // No chunk groups - return original documents
    if (chunkGroups.size === 0) {
      return documents;
    }

    logger.debug(
      { chunkGroupCount: chunkGroups.size, originalDocCount: documents.length },
      '[PgvectorMemoryAdapter] Expanding results with sibling chunks'
    );

    // Fetch siblings for each group
    const allDocs = [...documents];
    for (const groupId of chunkGroups) {
      try {
        const siblings = await this.fetchChunkSiblings(groupId, personaId);
        for (const sibling of siblings) {
          const sibId = sibling.metadata?.id as string | undefined;
          if (sibId !== undefined && sibId.length > 0 && !seenIds.has(sibId)) {
            allDocs.push(sibling);
            seenIds.add(sibId);
          }
        }
      } catch (error) {
        logger.error(
          { err: error, chunkGroupId: groupId },
          '[PgvectorMemoryAdapter] Failed to fetch chunk siblings'
        );
        // Continue with other groups
      }
    }

    logger.debug(
      { expandedDocCount: allDocs.length, addedSiblings: allDocs.length - documents.length },
      '[PgvectorMemoryAdapter] Sibling expansion complete'
    );

    return allDocs;
  }

  /**
   * Query memories with channel scoping using the "waterfall" method
   *
   * When channelIds are provided, this method:
   * 1. First queries memories from the specified channels (up to channelBudgetRatio of limit)
   * 2. Then backfills with global semantic search (excluding already-found IDs)
   * 3. Returns combined results with channel-scoped memories first
   *
   * This ensures users get relevant channel-specific context when they reference
   * channels (e.g., "remember what we talked about in #gaming") while still
   * including semantically relevant memories from other contexts.
   *
   * @param query - The search query text
   * @param options - Query options including channelIds for scoping
   * @returns Combined memories from channel-scoped and global searches
   */
  async queryMemoriesWithChannelScoping(
    query: string,
    options: MemoryQueryOptions
  ): Promise<MemoryDocument[]> {
    const totalLimit = options.limit ?? 10;
    // Clamp channelBudgetRatio to valid 0-1 range to prevent invalid budget calculations
    const rawRatio = options.channelBudgetRatio ?? AI_DEFAULTS.CHANNEL_MEMORY_BUDGET_RATIO;
    const channelBudgetRatio = Math.max(0, Math.min(1, rawRatio));

    // If no channels specified, just do a normal query
    if (!options.channelIds || options.channelIds.length === 0) {
      return this.queryMemories(query, options);
    }

    // Validate channel IDs to prevent SQL injection (Discord snowflakes are 17-19 digit strings)
    const validChannelIds = filterValidDiscordIds(options.channelIds);
    if (validChannelIds.length === 0) {
      logger.warn(
        { originalChannelIds: options.channelIds },
        '[PgvectorMemoryAdapter] No valid Discord channel IDs provided, falling back to global query'
      );
      return this.queryMemories(query, { ...options, channelIds: undefined });
    }

    if (validChannelIds.length < options.channelIds.length) {
      logger.warn(
        {
          original: options.channelIds.length,
          valid: validChannelIds.length,
          filtered: options.channelIds.filter(id => !validChannelIds.includes(id)),
        },
        '[PgvectorMemoryAdapter] Some channel IDs filtered out as invalid'
      );
    }

    // Ensure at least 1 channel-scoped memory when channels are specified
    // (prevents edge case where totalLimit=1, ratio=0.5 → channelBudget=0)
    const channelBudget = Math.max(1, Math.floor(totalLimit * channelBudgetRatio));

    logger.debug(
      {
        channelIds: validChannelIds,
        totalLimit,
        channelBudget,
        channelBudgetRatio,
      },
      '[PgvectorMemoryAdapter] Starting waterfall query with channel scoping'
    );

    // Step 1: Query channel-scoped memories first
    let channelResults: MemoryDocument[] = [];
    try {
      channelResults = await this.queryMemories(query, {
        ...options,
        channelIds: validChannelIds,
        limit: channelBudget,
      });

      logger.debug(
        { channelResultCount: channelResults.length, channelBudget },
        '[PgvectorMemoryAdapter] Channel-scoped query complete'
      );
    } catch (error) {
      logger.error(
        { err: error, channelIds: validChannelIds },
        '[PgvectorMemoryAdapter] Channel-scoped query failed, continuing with global only'
      );
      // Continue to global query - better to return some results than none
    }

    // Step 2: Calculate remaining budget and get IDs to exclude
    const remainingBudget = totalLimit - channelResults.length;
    const excludeIds = channelResults
      .map(r => r.metadata?.id as string | undefined)
      .filter((id): id is string => id !== undefined);

    // Step 3: Global semantic query with exclusion (no channel filter)
    let globalResults: MemoryDocument[] = [];
    if (remainingBudget > 0) {
      try {
        globalResults = await this.queryMemories(query, {
          ...options,
          channelIds: undefined, // Remove channel filter for global search
          limit: remainingBudget,
          excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
        });

        logger.debug(
          { globalResultCount: globalResults.length, remainingBudget },
          '[PgvectorMemoryAdapter] Global backfill query complete'
        );
      } catch (error) {
        logger.error({ err: error }, '[PgvectorMemoryAdapter] Global backfill query failed');
        // Return channel results only if global fails
      }
    }

    // Step 4: Combine results (channel-scoped first for prominence)
    const combinedResults = [...channelResults, ...globalResults];

    logger.info(
      {
        totalResults: combinedResults.length,
        channelScoped: channelResults.length,
        globalBackfill: globalResults.length,
        channelIds: validChannelIds,
      },
      '[PgvectorMemoryAdapter] Waterfall query complete'
    );

    return combinedResults;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple query to verify database connection and pgvector extension
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Pgvector health check failed');
      return false;
    }
  }
}
