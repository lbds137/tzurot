/**
 * Vector Memory Manager - Handles long-term memory using vector database
 *
 * Implements the multi-layered canon system:
 * - Global Canon: Baseline personality traits (read-only)
 * - Personal Canon: User-specific relationship history
 * - Session Canon: Temporary roleplay/conversation bubbles
 */

import { ChromaClient } from 'chromadb';
import { Document } from '@langchain/core/documents';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { OpenAIEmbeddings } from '@langchain/openai';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('VectorMemoryManager');

export type CanonScope = 'global' | 'personal' | 'session';

export interface MemoryMetadata {
  personalityId: string;
  personalityName?: string;
  userId?: string;
  sessionId?: string;
  canonScope: CanonScope;
  timestamp: number;
  summaryType?: string;
  contextType?: 'dm' | 'channel' | 'thread';
  channelId?: string;
  guildId?: string;
  serverId?: string;
  messageIds?: string[];
  senders?: string[];
}

export interface MemoryDocument {
  text: string;
  metadata: MemoryMetadata;
}

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

export class VectorMemoryManager {
  private client: ChromaClient;
  private embeddings: OpenAIEmbeddings;
  private vectorStore: Chroma | null = null;
  private readonly collectionName = 'personality-memories';
  private readonly chromaUrl: string;

  constructor(
    chromaUrl = 'http://localhost:8000',
    openAIApiKey?: string
  ) {
    this.chromaUrl = chromaUrl;
    this.client = new ChromaClient({ path: chromaUrl });
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: openAIApiKey ?? process.env.OPENAI_API_KEY,
      modelName: 'text-embedding-3-small' // Cheaper and faster than ada-002
    });
  }

  /**
   * Initialize the vector store
   */
  async initialize(): Promise<void> {
    try {
      logger.info('[VectorMemory] Initializing vector store...');

      this.vectorStore = (await Chroma.fromExistingCollection(
        this.embeddings,
        {
          collectionName: this.collectionName,
          url: this.chromaUrl
        }
      ));

      logger.info('[VectorMemory] Vector store initialized successfully');
    } catch {
      // Collection doesn't exist, create it
      logger.info('[VectorMemory] Creating new collection...');

      this.vectorStore = (await Chroma.fromDocuments(
        [], // Start with empty documents
        this.embeddings,
        {
          collectionName: this.collectionName,
          url: this.chromaUrl
        }
      ));

      logger.info('[VectorMemory] New collection created');
    }
  }

  /**
   * Add a memory to the vector store
   */
  async addMemory(memory: MemoryDocument): Promise<void> {
    if (!this.vectorStore) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    const doc = new Document({
      pageContent: memory.text,
      metadata: {
        ...memory.metadata,
        timestamp: memory.metadata.timestamp || Date.now()
      }
    });

    await this.vectorStore.addDocuments([doc]);

    logger.debug(`[VectorMemory] Added ${memory.metadata.canonScope} memory for ${memory.metadata.personalityId}`);
  }

  /**
   * Add multiple memories in batch
   */
  async addMemories(memories: MemoryDocument[]): Promise<void> {
    if (!this.vectorStore) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    const docs = memories.map(memory => new Document({
      pageContent: memory.text,
      metadata: {
        ...memory.metadata,
        timestamp: memory.metadata.timestamp || Date.now()
      }
    }));

    await this.vectorStore.addDocuments(docs);

    logger.info(`[VectorMemory] Added ${memories.length} memories in batch`);
  }

  /**
   * Query memories with multi-layered canon filtering
   */
  async queryMemories(
    query: string,
    options: MemoryQueryOptions
  ): Promise<Document[]> {
    if (!this.vectorStore) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    const {
      personalityId,
      userId,
      sessionId,
      limit = 10,
      includeGlobal = true,
      includePersonal = true,
      includeSession = true
    } = options;

    // Build filter for canon scopes
    const scopeFilters: CanonScope[] = [];
    if (includeGlobal) {scopeFilters.push('global');}
    if (includePersonal) {scopeFilters.push('personal');}
    if (includeSession) {scopeFilters.push('session');}

    // Query the vector store
    const results = await this.vectorStore.similaritySearch(
      query,
      limit * 3 // Get more results to filter by metadata
    );

    // Filter results by metadata
    const filtered = results.filter(doc => {
      const meta = doc.metadata as MemoryMetadata;

      // Must match personality
      if (meta.personalityId !== personalityId) {return false;}

      // Must be in allowed scopes
      if (!scopeFilters.includes(meta.canonScope)) {return false;}

      // For personal canon, must match user
      if (meta.canonScope === 'personal' && meta.userId !== userId) {return false;}

      // For session canon, must match session
      if (meta.canonScope === 'session' && meta.sessionId !== sessionId) {return false;}

      return true;
    });

    logger.debug(`[VectorMemory] Query returned ${filtered.length} relevant memories for ${personalityId}`);

    return filtered.slice(0, limit);
  }

  /**
   * Get global canon (baseline personality traits)
   */
  async getGlobalCanon(personalityId: string, limit = 5): Promise<Document[]> {
    if (!this.vectorStore) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    const results = await this.vectorStore.similaritySearch(
      `Tell me about ${personalityId}'s personality and core traits`,
      limit * 2
    );

    return results
      .filter(doc => {
        const meta = doc.metadata as MemoryMetadata;
        return meta.personalityId === personalityId && meta.canonScope === 'global';
      })
      .slice(0, limit);
  }

  /**
   * Get User Relationship Profile (Personal Canon)
   */
  async getUserRelationshipProfile(
    personalityId: string,
    userId: string,
    limit = 10
  ): Promise<Document[]> {
    if (!this.vectorStore) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    const results = await this.vectorStore.similaritySearch(
      `Relationship between ${personalityId} and user ${userId}`,
      limit * 2
    );

    return results
      .filter(doc => {
        const meta = doc.metadata as MemoryMetadata;
        return meta.personalityId === personalityId &&
               meta.canonScope === 'personal' &&
               meta.userId === userId;
      })
      .slice(0, limit);
  }

  /**
   * Delete all memories for a session (cleanup after roleplay ends)
   */
  async deleteSessionMemories(sessionId: string): Promise<void> {
    if (!this.vectorStore) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    logger.info(`[VectorMemory] Deleting session memories for ${sessionId}`);

    // Note: ChromaDB filtering for deletion may vary based on version
    // This is a placeholder - you may need to query + delete by IDs
    logger.warn('[VectorMemory] Session deletion not fully implemented - requires ID-based deletion');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.heartbeat();
      return true;
    } catch (error) {
      logger.error('[VectorMemory] Health check failed:', error);
      return false;
    }
  }
}
