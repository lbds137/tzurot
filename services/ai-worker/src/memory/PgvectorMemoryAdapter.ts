/**
 * Pgvector Memory Adapter
 * PostgreSQL + pgvector adapter for memory retrieval and storage
 */

import { PrismaClient } from '@prisma/client';
import { OpenAI } from 'openai';
import { v5 as uuidv5 } from 'uuid';
import crypto from 'crypto';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('PgvectorMemoryAdapter');

export interface MemoryQueryOptions {
  personaId: string; // Required: which persona's memories to search
  personalityId?: string; // Optional: filter to specific personality within persona
  sessionId?: string;
  limit?: number;
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
  timestamp: number;
  summaryType?: string;
  contextType?: string;
  channelId?: string;
  guildId?: string;
  serverId?: string;
  messageIds?: string[];
  senders?: string[];
}

// Namespace UUID for memories
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const MEMORY_NAMESPACE = uuidv5('tzurot-v3-memory', DNS_NAMESPACE);

// Helper to hash content
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
}

// Helper to generate deterministic memory UUID
function deterministicMemoryUuid(personaId: string, personalityId: string, content: string): string {
  const key = `${personaId}:${personalityId}:${hashContent(content)}`;
  return uuidv5(key, MEMORY_NAMESPACE);
}

/**
 * Adapter that provides memory retrieval and storage using pgvector
 */
export class PgvectorMemoryAdapter {
  private prisma: PrismaClient;
  private openai: OpenAI;
  private embeddingModel: string;

  constructor() {
    this.prisma = new PrismaClient();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
    logger.info('Pgvector Memory Adapter initialized');
  }

  /**
   * Query memories using vector similarity search
   */
  async queryMemories(
    query: string,
    options: MemoryQueryOptions
  ): Promise<MemoryDocument[]> {
    try {
      // Generate embedding for query
      const embeddingResponse = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: query,
      });
      const queryEmbedding = embeddingResponse.data[0].embedding;

      // Build WHERE clauses
      const whereConditions: string[] = ['persona_id = $2::uuid'];
      const params: any[] = [`[${queryEmbedding.join(',')}]`, options.personaId];
      let paramCount = 2;

      // Optional personality filter
      if (options.personalityId) {
        paramCount++;
        whereConditions.push(`personality_id = $${paramCount}::uuid`);
        params.push(options.personalityId);
      }

      // Exclude newer memories (for conversation history overlap prevention)
      if (options.excludeNewerThan) {
        paramCount++;
        // excludeNewerThan is already in milliseconds - don't multiply by 1000
        const excludeDate = new Date(options.excludeNewerThan);
        whereConditions.push(`created_at < $${paramCount}::timestamptz`);
        params.push(excludeDate.toISOString());
      }

      // Build query with vector similarity search
      const limit = options.limit || 10;
      const scoreThreshold = options.scoreThreshold || 0.15;

      const whereClause = whereConditions.join(' AND ');

      // pgvector distance: 0 = identical, higher = less similar
      // We want distance < threshold (converted from similarity)
      // Similarity 0.15 means distance should be < (1 - 0.15) = 0.85
      const distanceThreshold = 1 - scoreThreshold;

      paramCount++;
      const sql = `
        SELECT
          m.id,
          m.persona_id,
          m.personality_id,
          m.content,
          m.embedding <=> $1::vector AS distance,
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
        WHERE ${whereClause.replace(/persona_id/g, 'm.persona_id').replace(/personality_id/g, 'm.personality_id').replace(/created_at/g, 'm.created_at')}
          AND m.embedding <=> $1::vector < $${paramCount}
        ORDER BY distance ASC
        LIMIT ${limit}
      `;

      params.push(distanceThreshold);

      logger.debug({
        personaId: options.personaId,
        personalityId: options.personalityId,
        limit,
        scoreThreshold,
        distanceThreshold
      }, 'Querying memories with pgvector');

      const memories = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);

      // Convert to MemoryDocument format and inject persona/personality names
      const documents: MemoryDocument[] = memories.map(memory => {
        // Replace {user} and {assistant} tokens with actual names
        let content = memory.content;
        content = content.replace(/\{user\}/g, memory.persona_name);
        content = content.replace(/\{assistant\}/g, memory.personality_name);

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
            timestamp: Math.floor(new Date(memory.created_at).getTime() / 1000),
            distance: memory.distance,
            score: 1 - memory.distance, // Convert distance back to similarity score
          },
        };
      });

      logger.debug(`Retrieved ${documents.length} memories for query (persona: ${options.personaId}, personality: ${options.personalityId || 'all'})`);
      return documents;

    } catch (error) {
      const errorDetails = {
        personaId: options.personaId,
        personalityId: options.personalityId,
        queryLength: query.length,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      logger.error({ err: error, ...errorDetails }, `Failed to query memories for persona: ${options.personaId}`);
      // Return empty array - query failures shouldn't block conversation generation
      return [];
    }
  }

  /**
   * Add a memory - for storing new interactions
   */
  async addMemory(data: {
    text: string;
    metadata: MemoryMetadata;
  }): Promise<void> {
    try {
      // Generate embedding
      const embeddingResponse = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: data.text,
      });
      const embedding = embeddingResponse.data[0].embedding;

      // Generate deterministic UUID
      const memoryId = deterministicMemoryUuid(
        data.metadata.personaId,
        data.metadata.personalityId,
        data.text
      );

      // Convert timestamp (already in milliseconds) to Date
      const createdAt = new Date(data.metadata.timestamp);

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
          ${data.metadata.sessionId || null},
          ${data.metadata.canonScope || 'personal'},
          ${data.metadata.summaryType || null},
          ${data.metadata.channelId || null},
          ${data.metadata.guildId || null},
          ${data.metadata.messageIds || []}::text[],
          ${data.metadata.senders || []}::text[],
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
