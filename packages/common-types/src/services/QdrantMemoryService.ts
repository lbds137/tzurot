/**
 * QdrantMemoryService
 * Provides RAG (Retrieval-Augmented Generation) using Qdrant vector database
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAI } from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';

const logger = createLogger('QdrantMemoryService');
const config = getConfig();

export interface Memory {
  id: string;
  content: string;
  metadata: {
    personalityId: string;
    personalityName: string;
    userId?: string; // USER ISOLATION - critical for privacy
    sessionId?: string; // Session-specific memories
    canonScope?: 'global' | 'personal' | 'session'; // Memory scope
    summaryType?: string;
    createdAt: number; // Unix timestamp in milliseconds
    channelId?: string;
    guildId?: string;
    messageIds?: string[];
    senders?: string[];
  };
  score?: number;
}

export interface MemorySearchOptions {
  limit?: number;
  scoreThreshold?: number;
  excludeNewerThan?: number; // Unix timestamp - exclude memories created after this time
  userId?: string; // USER ISOLATION - filter to specific user's memories
  sessionId?: string; // Filter to specific session
  includeGlobal?: boolean; // Include global (non-user-specific) memories
  includePersonal?: boolean; // Include user-specific memories
  includeSession?: boolean; // Include session-specific memories
}

export class QdrantMemoryService {
  private qdrant: QdrantClient;
  private openai: OpenAI;
  private readonly EMBEDDING_MODEL = config.EMBEDDING_MODEL;

  constructor() {
    const qdrantUrl = config.QDRANT_URL;
    const qdrantApiKey = config.QDRANT_API_KEY;
    const openaiApiKey = config.OPENAI_API_KEY;

    if (!qdrantUrl || !qdrantApiKey) {
      throw new Error('QDRANT_URL and QDRANT_API_KEY must be set');
    }

    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY must be set for embeddings');
    }

    this.qdrant = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
    });

    this.openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    logger.info('Qdrant Memory Service initialized');
  }

  /**
   * Search for relevant memories for a personality
   */
  async searchMemories(
    personalityId: string,
    query: string,
    options: MemorySearchOptions = {}
  ): Promise<Memory[]> {
    const {
      limit = 10,
      scoreThreshold = 0.7,
      excludeNewerThan,
      userId,
      sessionId,
      includeGlobal = true,
      includePersonal = true,
      includeSession = true,
    } = options;

    try {
      // Get collection name for this personality
      const collectionName = `personality-${personalityId}`;

      // Ensure collection and indexes exist before searching
      // This prevents "index required but not found" errors
      await this.ensureCollection(collectionName);

      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Build filter with USER ISOLATION
      const mustConditions: any[] = [];

      // Timestamp filter - exclude recent memories that overlap with conversation history
      if (excludeNewerThan) {
        mustConditions.push({
          key: 'createdAt',
          range: {
            lt: excludeNewerThan, // Less than (older than) the oldest conversation message
          },
        });
      }

      // USER ISOLATION: Build scope-based filter
      // This ensures users only see their own memories + global memories
      const shouldConditions: any[] = [];

      if (includeGlobal) {
        // Global memories (no userId set)
        shouldConditions.push({
          is_empty: { key: 'userId' }
        });
      }

      if (includePersonal && userId) {
        // Personal memories for this specific user
        shouldConditions.push({
          key: 'userId',
          match: { value: userId }
        });
      }

      if (includeSession && sessionId) {
        // Session-specific memories
        shouldConditions.push({
          key: 'sessionId',
          match: { value: sessionId }
        });
      }

      // Build final filter
      const filter: any = shouldConditions.length > 0
        ? {
            must: mustConditions,
            should: shouldConditions, // At least one should condition must match
          }
        : mustConditions.length > 0
        ? { must: mustConditions }
        : undefined;

      // Search in Qdrant
      const searchResults = await this.qdrant.search(collectionName, {
        vector: queryEmbedding,
        limit,
        score_threshold: scoreThreshold,
        filter,
        with_payload: true,
      });

      // Map results to Memory objects
      const memories: Memory[] = searchResults.map(result => ({
        id: result.id.toString(),
        content: (result.payload?.content as string) || '',
        metadata: {
          personalityId: (result.payload?.personalityId as string) || '',
          personalityName: (result.payload?.personalityName as string) || '',
          userId: result.payload?.userId as string | undefined,
          sessionId: result.payload?.sessionId as string | undefined,
          canonScope: result.payload?.canonScope as 'global' | 'personal' | 'session' | undefined,
          summaryType: result.payload?.summaryType as string | undefined,
          createdAt: (result.payload?.createdAt as number) || Date.now(),
          channelId: result.payload?.channelId as string | undefined,
          guildId: result.payload?.guildId as string | undefined,
          messageIds: result.payload?.messageIds as string[] | undefined,
          senders: result.payload?.senders as string[] | undefined,
        },
        score: result.score,
      }));

      logger.debug(`Found ${memories.length} memories for query (personality: ${personalityId}, userId: ${userId || 'none'})`);
      return memories;

    } catch (error) {
      // If collection doesn't exist, return empty array
      if ((error as {status?: number}).status === 404) {
        logger.debug(`No memory collection found for personality: ${personalityId}`);
        return [];
      }

      logger.error({ err: error }, `Failed to search memories for personality: ${personalityId}`);
      throw error;
    }
  }

  /**
   * Generate an embedding for text using OpenAI
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.EMBEDDING_MODEL,
        input: text,
      });

      return response.data[0].embedding;

    } catch (error) {
      logger.error({ err: error }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Add a new memory to a personality's collection
   */
  async addMemory(
    personalityId: string,
    personalityName: string,
    content: string,
    metadata: {
      userId?: string; // USER ISOLATION - critical for privacy
      sessionId?: string; // Session-specific memories
      canonScope?: 'global' | 'personal' | 'session'; // Memory scope
      summaryType?: string;
      channelId?: string;
      guildId?: string;
      messageIds?: string[];
      senders?: string[];
    }
  ): Promise<void> {
    try {
      const collectionName = `personality-${personalityId}`;

      // Ensure collection exists (create if needed)
      await this.ensureCollection(collectionName);

      // Generate embedding for the content
      const embedding = await this.generateEmbedding(content);

      // Generate a UUID for this memory (Qdrant requires UUID or unsigned integer)
      const memoryId = uuidv4();

      // Upsert the memory point
      await this.qdrant.upsert(collectionName, {
        wait: true,
        points: [
          {
            id: memoryId,
            vector: embedding,
            payload: {
              personalityId,
              personalityName,
              content,
              userId: metadata.userId, // USER ISOLATION - store userId for filtering
              sessionId: metadata.sessionId, // Session-specific memories
              canonScope: metadata.canonScope || 'personal', // Default to personal scope
              summaryType: metadata.summaryType || 'conversation',
              createdAt: Date.now(), // Unix timestamp in milliseconds
              channelId: metadata.channelId,
              guildId: metadata.guildId,
              messageIds: metadata.messageIds,
              senders: metadata.senders,
            },
          },
        ],
      });

      logger.info(`Stored new memory for personality ${personalityName} (${personalityId}, userId: ${metadata.userId || 'global'}, scope: ${metadata.canonScope || 'personal'})`);
    } catch (error) {
      logger.error({ err: error }, `Failed to add memory for personality: ${personalityId}`);
      throw error;
    }
  }

  /**
   * Ensure a collection exists (create if needed)
   */
  private async ensureCollection(collectionName: string): Promise<void> {
    try {
      await this.qdrant.getCollection(collectionName);
    } catch (error) {
      if ((error as {status?: number}).status === 404) {
        // Collection doesn't exist, create it
        await this.qdrant.createCollection(collectionName, {
          vectors: {
            size: 1536, // text-embedding-3-small dimension
            distance: 'Cosine',
          },
        });
        logger.info(`Created new memory collection: ${collectionName}`);
      } else {
        throw error;
      }
    }

    // Ensure createdAt index exists (for timestamp-based filtering)
    // This is safe to call even if the index already exists
    try {
      await this.qdrant.createPayloadIndex(collectionName, {
        field_name: 'createdAt',
        field_schema: 'integer',
      });
      logger.info(`Created createdAt index for collection: ${collectionName}`);
    } catch (error) {
      // Index might already exist, which is fine
      logger.debug(`Index creation skipped for ${collectionName}: ${error}`);
    }
  }

  /**
   * Check if a personality has a memory collection
   */
  async hasMemories(personalityId: string): Promise<boolean> {
    try {
      const collectionName = `personality-${personalityId}`;
      const collection = await this.qdrant.getCollection(collectionName);
      return (collection.points_count ?? 0) > 0;
    } catch (error) {
      if ((error as {status?: number}).status === 404) {
        return false;
      }
      throw error;
    }
  }
}
