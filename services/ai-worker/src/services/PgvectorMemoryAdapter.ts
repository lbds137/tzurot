/**
 * Pgvector Memory Adapter
 * PostgreSQL + pgvector adapter for memory retrieval and storage
 */

import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateMemoryChunkGroupUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { splitTextByTokens } from '@tzurot/common-types/utils/textChunker';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { IEmbeddingService } from '@tzurot/embeddings';
import {
  EMBEDDING_DIMENSION,
  isValidId,
  deterministicMemoryUuid,
  normalizeMetadata,
  mapQueryResultToDocument,
} from '../utils/memoryUtils.js';
import {
  buildWhereConditions,
  buildSimilaritySearchQuery,
  parseQueryOptions,
} from './PgvectorQueryBuilder.js';
import { expandWithSiblings } from './PgvectorSiblingExpander.js';
import { waterfallMemoryQuery } from './PgvectorChannelScoping.js';

// Re-export types for consumers that import from this module (~10 files)
export { MemoryQueryOptions, MemoryMetadata, MemoryMetadataSchema } from './PgvectorTypes.js';

import type {
  MemoryQueryOptions,
  PgvectorMemoryDocument,
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
   * The shared local embedding service, so sibling retrievers (e.g. the
   * generation-side `FactRetriever`, slice 4a) can reuse the same embedder
   * without a second instance.
   */
  getEmbeddingService(): IEmbeddingService {
    return this.embeddingService;
  }

  /**
   * Query memories using vector similarity search
   */
  async queryMemories(
    query: string,
    options: MemoryQueryOptions
  ): Promise<PgvectorMemoryDocument[]> {
    try {
      // Validate query input before calling OpenAI API
      if (!isValidId(query)) {
        logger.warn(
          { personaId: options.personaId },
          'Empty or null query provided, returning empty results'
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
      let documents: PgvectorMemoryDocument[] = memories.map(mapQueryResultToDocument);

      // Expand results with sibling chunks (default: true for complete memory retrieval)
      if (options.includeSiblings !== false && documents.length > 0) {
        documents = await expandWithSiblings(this.prisma, documents, options.personaId);
      }

      logger.debug(
        {
          count: documents.length,
          personaId: options.personaId,
          personalityId: isValidId(options.personalityId) ? options.personalityId : 'all',
        },
        'Retrieved memories for query'
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
      'Splitting oversized memory into chunks'
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
      'Successfully stored all memory chunks'
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
          'Text exceeds embedding token limit - may fail'
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
          id, persona_id, personality_id, source_system, content, embedding,
          session_id, canon_scope, summary_type, channel_id, guild_id,
          message_ids, senders, is_summarized, created_at,
          legacy_shapes_user_id,
          chunk_group_id, chunk_index, total_chunks
        ) VALUES (
          ${memoryId}::uuid,
          ${data.metadata.personaId}::uuid,
          ${data.metadata.personalityId}::uuid,
          ${data.metadata.sourceSystem ?? 'tzurot-v3'},
          ${data.text},
          -- BGE-small-en-v1.5 local embedding (384 dimensions)
          ${`[${embedding.join(',')}]`}::vector(384),
          ${normalized.sessionId},
          ${normalized.canonScope},
          ${normalized.summaryType},
          ${normalized.channelId},
          ${normalized.guildId},
          ${normalized.messageIds}::text[],
          ${normalized.senders}::text[],
          ${data.metadata.isSummarized ?? false},
          ${normalized.createdAt}::timestamptz,
          ${data.metadata.legacyShapesUserId ?? null}::uuid,
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

  /**
   * Re-embed one memory in place — the NULL-vector self-healing path. Rows
   * get a NULL embedding when an edit lands during embedding-service downtime
   * (correct per the visibility invariant: invisible beats wrongly-matched);
   * this restores them to RAG visibility. Guards with embedding IS NULL so a
   * concurrent normal update can't be clobbered (idempotent by shape).
   *
   * @returns true when a row was updated, false when the row no longer
   *   qualifies (already re-embedded, deleted, or made non-normal).
   *
   * Deliberately does NOT touch updated_at: that column tracks content edits
   * (the UI shows "Updated" and supports sort=updatedAt), and a background
   * embedding repair is not a content change — bumping it would make healed
   * memories masquerade as user-edited.
   */
  async reembedMemory(memoryId: string, text: string): Promise<boolean> {
    const embedding = await this.generateEmbedding(text);
    const updated = await this.prisma.$executeRaw`
      UPDATE memories
      SET embedding = ${`[${embedding.join(',')}]`}::vector(384)
      WHERE id = ${memoryId}::uuid
        AND embedding IS NULL
        AND visibility = 'normal'
    `;
    return updated > 0;
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
   * Query memories with channel scoping using the "waterfall" method
   * Delegates to waterfallMemoryQuery with this.queryMemories as the query function
   */
  async queryMemoriesWithChannelScoping(
    query: string,
    options: MemoryQueryOptions
  ): Promise<PgvectorMemoryDocument[]> {
    return waterfallMemoryQuery((q, o) => this.queryMemories(q, o), query, options);
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
