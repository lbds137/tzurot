/**
 * Pgvector Memory Adapter
 * PostgreSQL + pgvector adapter for memory retrieval and storage
 */

import { type PrismaClient } from '@tzurot/common-types';
import {
  createLogger,
  AI_DEFAULTS,
  filterValidDiscordIds,
  splitTextByTokens,
  generateMemoryChunkGroupUuid,
  countTextTokens,
} from '@tzurot/common-types';
import type { IEmbeddingService } from '@tzurot/embeddings';
import {
  EMBEDDING_DIMENSION,
  isValidId,
  deterministicMemoryUuid,
  normalizeMetadata,
  mapQueryResultToDocument,
  extractChunkGroups,
  mergeSiblings,
} from '../utils/memoryUtils.js';
import {
  buildWhereConditions,
  buildSimilaritySearchQuery,
  parseQueryOptions,
} from './PgvectorQueryBuilder.js';

// Re-export types for backward compatibility (18 files import from this module)
export {
  MemoryQueryOptions,
  MemoryDocument,
  MemoryMetadata,
  MemoryMetadataSchema,
  MemoryQueryResult,
} from './PgvectorTypes.js';

import type {
  MemoryQueryOptions,
  MemoryDocument,
  MemoryMetadata,
  MemoryQueryResult,
} from './PgvectorTypes.js';

const logger = createLogger('PgvectorMemoryAdapter');

/**
 * Adapter that provides memory retrieval and storage using pgvector
 */
export class PgvectorMemoryAdapter {
  private prisma: PrismaClient;
  private embeddingService: IEmbeddingService;

  constructor(prisma: PrismaClient, embeddingService: IEmbeddingService) {
    this.prisma = prisma;
    this.embeddingService = embeddingService;
    logger.info(
      { embeddingDimension: embeddingService.getDimensions() },
      'Pgvector Memory Adapter initialized with local embedding service'
    );
  }

  /**
   * Query memories using vector similarity search
   */
  async queryMemories(query: string, options: MemoryQueryOptions): Promise<MemoryDocument[]> {
    try {
      // Validate query input before calling OpenAI API
      if (!isValidId(query)) {
        logger.warn(
          { personaId: options.personaId },
          '[PgvectorMemoryAdapter] Empty or null query provided, returning empty results'
        );
        return [];
      }

      // Generate embedding and format as PostgreSQL vector
      const queryEmbedding = await this.generateEmbedding(query);
      const embeddingVector = `[${queryEmbedding.join(',')}]`;

      // Parse options with defaults
      const { limit, minSimilarity, maxDistance } = parseQueryOptions(options);

      // Build and execute query
      const whereConditions = buildWhereConditions(options);
      const sqlQuery = buildSimilaritySearchQuery(
        embeddingVector,
        whereConditions,
        maxDistance,
        limit
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
      let documents: MemoryDocument[] = memories.map(mapQueryResultToDocument);

      // Expand results with sibling chunks (default: true for complete memory retrieval)
      if (options.includeSiblings !== false && documents.length > 0) {
        documents = await this.expandWithSiblings(documents, options.personaId);
      }

      logger.debug(
        `Retrieved ${documents.length} memories for query (persona: ${options.personaId}, personality: ${isValidId(options.personalityId) ? options.personalityId : 'all'})`
      );
      return documents;
    } catch (error) {
      logger.error(
        {
          err: error,
          personaId: options.personaId,
          personalityId: options.personalityId,
          queryLength: query.length,
        },
        `Failed to query memories for persona: ${options.personaId}`
      );
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

    // Store all chunks in parallel for better performance.
    // Retry safety: Deterministic UUIDs (based on content + chunkIndex) ensure that
    // retrying the same memory produces identical chunk IDs. Combined with
    // ON CONFLICT DO NOTHING in storeSingleMemory(), this makes parallel storage
    // idempotent - partial failures don't cause duplicates, and subsequent retries
    // will complete any missing chunks without affecting already-stored ones.
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
      const normalized = normalizeMetadata(data.metadata);

      await this.prisma.$executeRaw`
        INSERT INTO memories (
          id, persona_id, personality_id, source_system, content, embedding_local,
          session_id, canon_scope, summary_type, channel_id, guild_id,
          message_ids, senders, is_summarized, created_at,
          chunk_group_id, chunk_index, total_chunks
        ) VALUES (
          ${memoryId}::uuid,
          ${data.metadata.personaId}::uuid,
          ${data.metadata.personalityId}::uuid,
          'tzurot-v3',
          ${data.text},
          -- embedding_local: BGE-small-en-v1.5 (384 dimensions)
          ${`[${embedding.join(',')}]`}::vector(384),
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
    if (!this.embeddingService.isServiceReady()) {
      throw new Error('Embedding service is not ready');
    }

    const embedding = await this.embeddingService.getEmbedding(text);

    if (embedding === undefined) {
      throw new Error('Embedding service returned undefined result');
    }

    if (embedding.length === 0) {
      throw new Error('Embedding service returned empty embedding array');
    }

    if (embedding.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Invalid embedding dimensions: expected ${EMBEDDING_DIMENSION}, got ${embedding.length}`
      );
    }

    // Convert Float32Array to number[]
    return Array.from(embedding);
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

    // SQL sets distance=0 for siblings, mapQueryResultToDocument handles score calculation
    return memories.map(mapQueryResultToDocument);
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
    const { chunkGroups, seenIds } = extractChunkGroups(documents);
    if (chunkGroups.size === 0) {
      return documents;
    }

    logger.debug(
      { chunkGroupCount: chunkGroups.size, originalDocCount: documents.length },
      '[PgvectorMemoryAdapter] Expanding results with sibling chunks'
    );

    let allDocs = [...documents];
    for (const groupId of chunkGroups) {
      try {
        const siblings = await this.fetchChunkSiblings(groupId, personaId);
        allDocs = mergeSiblings(allDocs, siblings, seenIds);
      } catch (error) {
        logger.error(
          { err: error, chunkGroupId: groupId },
          '[PgvectorMemoryAdapter] Failed to fetch chunk siblings'
        );
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
      .map(r => r.metadata?.id as string | null | undefined)
      .filter((id): id is string => id !== undefined && id !== null);

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
