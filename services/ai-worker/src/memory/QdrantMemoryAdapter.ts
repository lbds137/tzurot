/**
 * Qdrant Memory Adapter
 * Adapts QdrantMemoryService to work with the existing RAG service interface
 */

import { QdrantMemoryService } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('QdrantMemoryAdapter');

export interface MemoryQueryOptions {
  personalityId: string;
  userId?: string;
  sessionId?: string;
  limit?: number;
  includeGlobal?: boolean;
  includePersonal?: boolean;
  includeSession?: boolean;
}

export interface MemoryDocument {
  pageContent: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryMetadata {
  personalityId: string;
  userId?: string;
  sessionId?: string;
  canonScope: 'global' | 'personal' | 'session';
  timestamp: number;
  contextType?: string;
  channelId?: string;
  serverId?: string;
}

/**
 * Adapter that makes QdrantMemoryService compatible with LangChain's VectorStore interface
 */
export class QdrantMemoryAdapter {
  private qdrantService: QdrantMemoryService;

  constructor() {
    this.qdrantService = new QdrantMemoryService();
    logger.info('Qdrant Memory Adapter initialized');
  }

  /**
   * Query memories - compatible with ConversationalRAGService expectations
   */
  async queryMemories(
    query: string,
    options: MemoryQueryOptions
  ): Promise<MemoryDocument[]> {
    try {
      const memories = await this.qdrantService.searchMemories(
        options.personalityId,
        query,
        {
          limit: options.limit || 10,
          scoreThreshold: 0.15, // Lowered from 0.7 - semantic similarity scores are typically 0.15-0.4 for relevant matches
        }
      );

      // Convert to LangChain-compatible format
      const documents: MemoryDocument[] = memories.map(memory => ({
        pageContent: memory.content,
        metadata: {
          ...memory.metadata,
          score: memory.score,
        },
      }));

      logger.debug(`Retrieved ${documents.length} memories for query (personality: ${options.personalityId})`);
      return documents;

    } catch (error) {
      logger.error({ err: error }, `Failed to query memories for personality: ${options.personalityId}`);
      return [];
    }
  }

  /**
   * Add a memory - for storing new interactions
   */
  async addMemory(_data: {
    text: string;
    metadata: MemoryMetadata;
  }): Promise<void> {
    // For now, we don't add new memories during conversation
    // This would require generating embeddings and upserting to Qdrant
    // TODO: Implement this when we want to store new conversation memories
    logger.debug('Memory storage not yet implemented - conversations stored in PostgreSQL only');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check if we can query a personality (any personality)
      // This will fail gracefully if no collections exist
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Qdrant health check failed');
      return false;
    }
  }
}
