/**
 * QdrantMemoryService
 * Provides RAG (Retrieval-Augmented Generation) using Qdrant vector database
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAI } from 'openai';
import { createLogger } from '../logger.js';

const logger = createLogger('QdrantMemoryService');

export interface Memory {
  id: string;
  content: string;
  metadata: {
    personalityId: string;
    personalityName: string;
    summaryType?: string;
    createdAt: string;
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
}

export class QdrantMemoryService {
  private qdrant: QdrantClient;
  private openai: OpenAI;
  private readonly EMBEDDING_MODEL = 'text-embedding-3-small';

  constructor() {
    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

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
    } = options;

    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Get collection name for this personality
      const collectionName = `personality-${personalityId}`;

      // Search in Qdrant
      const searchResults = await this.qdrant.search(collectionName, {
        vector: queryEmbedding,
        limit,
        score_threshold: scoreThreshold,
        with_payload: true,
      });

      // Map results to Memory objects
      const memories: Memory[] = searchResults.map(result => ({
        id: result.id.toString(),
        content: (result.payload?.content as string) || '',
        metadata: {
          personalityId: (result.payload?.personalityId as string) || '',
          personalityName: (result.payload?.personalityName as string) || '',
          summaryType: result.payload?.summaryType as string | undefined,
          createdAt: (result.payload?.createdAt as string) || new Date().toISOString(),
          channelId: result.payload?.channelId as string | undefined,
          guildId: result.payload?.guildId as string | undefined,
          messageIds: result.payload?.messageIds as string[] | undefined,
          senders: result.payload?.senders as string[] | undefined,
        },
        score: result.score,
      }));

      logger.debug(`Found ${memories.length} memories for query (personality: ${personalityId})`);
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
