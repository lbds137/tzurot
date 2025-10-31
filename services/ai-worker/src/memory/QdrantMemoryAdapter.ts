/**
 * Qdrant Memory Adapter
 * Adapts QdrantMemoryService to work with the existing RAG service interface
 */

import { QdrantMemoryService } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('QdrantMemoryAdapter');

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
        options.personaId,
        query,
        {
          personalityId: options.personalityId, // Optional filter to specific personality
          limit: options.limit || 10,
          scoreThreshold: options.scoreThreshold || 0.15, // Use personality config or default to 0.15
          excludeNewerThan: options.excludeNewerThan, // Filter out memories that overlap with conversation history
          sessionId: options.sessionId,
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
      // But log detailed error info for debugging
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
        data.metadata.personaId,
        data.metadata.personalityId,
        data.metadata.personalityName || 'Unknown',
        data.text,
        {
          sessionId: data.metadata.sessionId,
          canonScope: data.metadata.canonScope,
          summaryType: data.metadata.summaryType,
          timestamp: data.metadata.timestamp, // Pass through PostgreSQL timestamp for perfect sync
          channelId: data.metadata.channelId,
          guildId: data.metadata.guildId,
          messageIds: data.metadata.messageIds,
          senders: data.metadata.senders,
        }
      );
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
      // Check if we can query a personality (any personality)
      // This will fail gracefully if no collections exist
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Qdrant health check failed');
      return false;
    }
  }
}
