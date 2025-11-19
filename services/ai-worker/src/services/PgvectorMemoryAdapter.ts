/**
 * Pgvector Memory Adapter
 * PostgreSQL + pgvector adapter for memory retrieval and storage
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { OpenAI } from 'openai';
import { v5 as uuidv5 } from 'uuid';
import crypto from 'crypto';
import { z } from 'zod';
import { createLogger, MODEL_DEFAULTS } from '@tzurot/common-types';
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
}

/**
 * Adapter that provides memory retrieval and storage using pgvector
 */
export class PgvectorMemoryAdapter {
  private prisma: PrismaClient;
  private openai: OpenAI;
  private embeddingModel: string;

  constructor() {
    this.prisma = new PrismaClient({
      log: ['error', 'warn'],
      // Set connection timeout to prevent hanging connections
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
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
              persona.name as persona_name,
              COALESCE(personality.display_name, personality.name) as personality_name
            FROM memories m
            JOIN personas persona ON m.persona_id = persona.id
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
      const documents: MemoryDocument[] = memories.map(memory => {
        // Replace {user} and {assistant} tokens with actual names
        const content = replacePromptPlaceholders(
          memory.content,
          memory.persona_name,
          memory.personality_name
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
          },
        };
      });

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
   */
  async addMemory(data: { text: string; metadata: MemoryMetadata }): Promise<void> {
    try {
      // Generate embedding
      const embeddingResponse = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: data.text,
      });
      const embedding = embeddingResponse.data[0].embedding;

      // Validate embedding dimensions (text-embedding-3-small produces 1536 dimensions)
      const expectedDimensions = 1536;
      if (embedding?.length !== expectedDimensions) {
        throw new Error(
          `Invalid embedding dimensions: expected ${expectedDimensions}, got ${embedding?.length || 0}`
        );
      }

      // Generate deterministic UUID
      const memoryId = deterministicMemoryUuid(
        data.metadata.personaId,
        data.metadata.personalityId,
        data.text
      );

      // Convert timestamp (already in milliseconds) to Date
      const createdAt = new Date(data.metadata.createdAt);

      // Insert memory with pgvector embedding
      await this.prisma.$executeRaw`
        INSERT INTO memories (
          id,
          persona_id,
          personality_id,
          source_system,
          content,
          embedding,
          session_id,
          canon_scope,
          summary_type,
          channel_id,
          guild_id,
          message_ids,
          senders,
          is_summarized,
          created_at
        ) VALUES (
          ${memoryId}::uuid,
          ${data.metadata.personaId}::uuid,
          ${data.metadata.personalityId}::uuid,
          'tzurot-v3',
          ${data.text},
          ${`[${embedding.join(',')}]`}::vector(1536),
          ${data.metadata.sessionId !== undefined && data.metadata.sessionId.length > 0 ? data.metadata.sessionId : null},
          ${data.metadata.canonScope !== undefined && data.metadata.canonScope.length > 0 ? data.metadata.canonScope : 'personal'},
          ${data.metadata.summaryType !== undefined && data.metadata.summaryType.length > 0 ? data.metadata.summaryType : null},
          ${data.metadata.channelId !== undefined && data.metadata.channelId.length > 0 ? data.metadata.channelId : null},
          ${data.metadata.guildId !== undefined && data.metadata.guildId.length > 0 ? data.metadata.guildId : null},
          ${data.metadata.messageIds ?? []}::text[],
          ${data.metadata.senders ?? []}::text[],
          false,
          ${createdAt.toISOString()}::timestamptz
        )
        ON CONFLICT (id) DO NOTHING
      `;

      logger.debug({ memoryId, personaId: data.metadata.personaId }, 'Added memory to pgvector');
    } catch (error) {
      logger.error({ err: error }, `Failed to add memory for persona: ${data.metadata.personaId}`);
      // Re-throw so pending_memory can be preserved for retry
      throw error;
    }
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

  /**
   * Cleanup - close Prisma connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
