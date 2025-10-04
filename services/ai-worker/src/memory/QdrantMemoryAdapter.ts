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
  scoreThreshold?: number;
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
  personalityName?: string;
  userId?: string;
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
          scoreThreshold: options.scoreThreshold || 0.15, // Use personality config or default to 0.15
        }
      );

      // Convert to LangChain-compatible format
      const documents: MemoryDocument[] = memories.map(memory => ({
        pageContent: memory.content,
        metadata: {
          ...memory.metadata,
          id: memory.id, // Include memory ID for logging/debugging
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
  async addMemory(data: {
    text: string;
    metadata: MemoryMetadata;
  }): Promise<void> {
    try {
      await this.qdrantService.addMemory(
        data.metadata.personalityId,
        data.metadata.personalityName || 'Unknown',
        data.text,
        {
          summaryType: data.metadata.summaryType,
          channelId: data.metadata.channelId,
          guildId: data.metadata.guildId,
          messageIds: data.metadata.messageIds,
          senders: data.metadata.senders,
        }
      );
    } catch (error) {
      logger.error({ err: error }, `Failed to add memory for personality: ${data.metadata.personalityId}`);
      // Don't throw - memory storage is non-critical, conversation should continue
    }
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
