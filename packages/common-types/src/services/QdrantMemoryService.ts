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

/**
 * Qdrant filter condition types (simplified from Qdrant SDK)
 */
interface FieldCondition {
  key: string;
  match?: { value: string | number };
  range?: { lt?: number; lte?: number; gt?: number; gte?: number };
}

interface Filter {
  must?: FieldCondition[];
  should?: FieldCondition[];
  must_not?: FieldCondition[];
}

export interface Memory {
  id: string;
  content: string;
  metadata: {
    personaId?: string; // Persona this memory belongs to
    personalityId: string; // Personality this memory is about
    personalityName: string;
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
  personalityId?: string; // Filter to specific personality (for persona-scoped collections)
  limit?: number;
  scoreThreshold?: number;
  excludeNewerThan?: number; // Unix timestamp - exclude memories created after this time
  sessionId?: string; // Filter to specific session
}

/**
 * Safely extract and validate a Qdrant payload field
 */
function validatePayloadField<T>(
  payload: Record<string, unknown> | undefined,
  field: string,
  validator: (val: unknown) => val is T,
  defaultValue: T
): T {
  const value = payload?.[field];
  return validator(value) ? value : defaultValue;
}

// Type guards for validation
const isString = (val: unknown): val is string => typeof val === 'string';
const isNumber = (val: unknown): val is number => typeof val === 'number';
const isStringArray = (val: unknown): val is string[] =>
  Array.isArray(val) && val.every(item => typeof item === 'string');
const isCanonScope = (val: unknown): val is 'global' | 'personal' | 'session' =>
  val === 'global' || val === 'personal' || val === 'session';

export class QdrantMemoryService {
  private qdrant: QdrantClient;
  private openai: OpenAI;
  private readonly EMBEDDING_MODEL = config.EMBEDDING_MODEL;
  private ensuredCollections: Set<string> = new Set(); // Cache to avoid redundant index creation attempts

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
   * Search for relevant memories for a persona
   * Uses persona-scoped collections with optional personality filtering
   */
  async searchMemories(
    personaId: string,
    query: string,
    options: MemorySearchOptions = {}
  ): Promise<Memory[]> {
    const {
      personalityId, // Filter to specific personality
      limit = 10,
      scoreThreshold = 0.7,
      excludeNewerThan,
      sessionId,
    } = options;

    try {
      // Get collection name for this persona
      const collectionName = `persona-${personaId}`;

      // Ensure collection and indexes exist before searching
      // This prevents "index required but not found" errors
      await this.ensureCollection(collectionName);

      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Build filter conditions
      const mustConditions: FieldCondition[] = [];

      // Filter by personality if specified
      if (personalityId) {
        mustConditions.push({
          key: 'personalityId',
          match: { value: personalityId }
        });
      }

      // Timestamp filter - exclude recent memories that overlap with conversation history
      if (excludeNewerThan) {
        mustConditions.push({
          key: 'createdAt',
          range: {
            lt: excludeNewerThan, // Less than (older than) the oldest conversation message
          },
        });
      }

      // Session filter
      if (sessionId) {
        mustConditions.push({
          key: 'sessionId',
          match: { value: sessionId }
        });
      }

      // Build final filter
      const filter: Filter | undefined = mustConditions.length > 0 ? { must: mustConditions } : undefined;

      // Log search parameters for debugging
      logger.info(`Qdrant search params: limit=${limit}, scoreThreshold=${scoreThreshold}, personalityId=${personalityId || 'none'}, excludeNewerThan=${excludeNewerThan ? new Date(excludeNewerThan).toISOString() : 'none'}, sessionId=${sessionId || 'none'}`);
      logger.debug(`Qdrant filter: ${JSON.stringify(filter)}`);

      // Search in Qdrant
      const searchResults = await this.qdrant.search(collectionName, {
        vector: queryEmbedding,
        limit,
        score_threshold: scoreThreshold,
        filter,
        with_payload: true,
      });

      // Map results to Memory objects with validated payload extraction
      const memories: Memory[] = searchResults.map(result => {
        const payload = result.payload as Record<string, unknown> | undefined;

        return {
          id: result.id.toString(),
          content: validatePayloadField(payload, 'content', isString, ''),
          metadata: {
            personaId: payload?.personaId !== undefined && isString(payload.personaId) ? payload.personaId : undefined,
            personalityId: validatePayloadField(payload, 'personalityId', isString, ''),
            personalityName: validatePayloadField(payload, 'personalityName', isString, ''),
            sessionId: payload?.sessionId !== undefined && isString(payload.sessionId) ? payload.sessionId : undefined,
            canonScope: payload?.canonScope !== undefined && isCanonScope(payload.canonScope) ? payload.canonScope : undefined,
            summaryType: payload?.summaryType !== undefined && isString(payload.summaryType) ? payload.summaryType : undefined,
            createdAt: validatePayloadField(payload, 'createdAt', isNumber, Date.now()),
            channelId: payload?.channelId !== undefined && isString(payload.channelId) ? payload.channelId : undefined,
            guildId: payload?.guildId !== undefined && isString(payload.guildId) ? payload.guildId : undefined,
            messageIds: payload?.messageIds !== undefined && isStringArray(payload.messageIds) ? payload.messageIds : undefined,
            senders: payload?.senders !== undefined && isStringArray(payload.senders) ? payload.senders : undefined,
          },
          score: result.score,
        };
      });

      // Log date distribution for debugging
      const dateDistribution: Record<string, number> = {};
      memories.forEach(m => {
        const date = new Date(m.metadata.createdAt).toISOString().split('T')[0];
        dateDistribution[date] = (dateDistribution[date] || 0) + 1;
      });
      logger.info(`Found ${memories.length} memories for query (persona: ${personaId}, personality: ${personalityId || 'all'})`);
      logger.info(`Memory date distribution: ${JSON.stringify(dateDistribution)}`);

      return memories;

    } catch (error) {
      // If collection doesn't exist, return empty array
      if ((error as {status?: number}).status === 404) {
        logger.debug(`No memory collection found for persona: ${personaId}`);
        return [];
      }

      const errorDetails = {
        personaId,
        personalityId,
        collectionName: `persona-${personaId}`,
        queryLength: query.length,
        limit,
        scoreThreshold,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      logger.error({ err: error, ...errorDetails }, `Failed to search memories for persona: ${personaId}`);
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
      const errorDetails = {
        textLength: text.length,
        model: this.EMBEDDING_MODEL,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      logger.error({ err: error, ...errorDetails }, 'Failed to generate embedding from OpenAI');
      throw error;
    }
  }

  /**
   * Add a new memory to a persona's collection
   * Memories are scoped to personas, with personalityId stored for filtering
   */
  async addMemory(
    personaId: string,
    personalityId: string,
    personalityName: string,
    content: string,
    metadata: {
      sessionId?: string; // Session-specific memories
      canonScope?: 'global' | 'personal' | 'session'; // Memory scope
      summaryType?: string;
      timestamp?: number; // Unix timestamp in milliseconds (if not provided, uses current time)
      channelId?: string;
      guildId?: string;
      messageIds?: string[];
      senders?: string[];
    }
  ): Promise<void> {
    try {
      const collectionName = `persona-${personaId}`;

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
              personalityId, // Store for filtering within persona collection
              personalityName,
              personaId, // Store persona ID as well
              content,
              sessionId: metadata.sessionId, // Session-specific memories
              canonScope: metadata.canonScope || 'personal', // Default to personal scope
              summaryType: metadata.summaryType || 'conversation',
              createdAt: Math.floor(metadata.timestamp || Date.now()), // Use provided timestamp or current time (integer only for Qdrant index)
              channelId: metadata.channelId,
              guildId: metadata.guildId,
              messageIds: metadata.messageIds,
              senders: metadata.senders,
            },
          },
        ],
      });

      logger.info(`Stored new memory for persona ${personaId} (personality: ${personalityName}/${personalityId}, scope: ${metadata.canonScope || 'personal'})`);
    } catch (error) {
      const errorDetails = {
        personaId,
        personalityId,
        personalityName,
        collectionName: `persona-${personaId}`,
        canonScope: metadata.canonScope || 'personal',
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      logger.error({ err: error, ...errorDetails }, `Failed to add memory for persona: ${personaId}`);
      throw error;
    }
  }

  /**
   * Ensure a collection exists (create if needed)
   * Uses in-memory cache to avoid redundant checks and index creation attempts
   */
  private async ensureCollection(collectionName: string): Promise<void> {
    // Check cache first to avoid redundant operations
    if (this.ensuredCollections.has(collectionName)) {
      return;
    }

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
          optimizers_config: {
            indexing_threshold: 0, // Index immediately to ensure all points are indexed
          },
        });
        logger.info(`Created new memory collection: ${collectionName}`);
      } else {
        throw error;
      }
    }

    // Ensure required indexes exist (for filtering)
    // Only attempt once per collection (cached above)
    const indexes = [
      { field: 'createdAt', schema: 'integer' as const },     // Timestamp filtering
      { field: 'personalityId', schema: 'keyword' as const }, // Personality filtering (for persona collections)
      { field: 'sessionId', schema: 'keyword' as const },     // Session filtering
    ];

    for (const { field, schema } of indexes) {
      try {
        await this.qdrant.createPayloadIndex(collectionName, {
          field_name: field,
          field_schema: schema,
          wait: false, // Don't block - index creation happens in background
        });
        logger.info(`Created ${field} index for collection: ${collectionName}`);
      } catch (error) {
        // Index might already exist, which is fine
        logger.debug(`Index creation skipped for ${collectionName}.${field}: ${error}`);
      }
    }

    // Cache this collection to avoid redundant checks
    this.ensuredCollections.add(collectionName);
  }

  /**
   * Check if a persona has a memory collection
   */
  async hasMemories(personaId: string): Promise<boolean> {
    try {
      const collectionName = `persona-${personaId}`;
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
