/**
 * MemoryImporter - Imports LTM memories from shapes.inc to Qdrant
 *
 * Handles:
 * - Reading shapes.inc memory format
 * - Mapping to v3 Qdrant metadata format
 * - UUID resolution (personality and user IDs)
 * - Orphaned memory handling
 * - Embedding generation
 * - Qdrant storage
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type { OpenAI } from 'openai';
import { UUIDMapper, type UserResolutionResult } from './UUIDMapper.js';
import type {
  ShapesIncMemory,
  V3MemoryMetadata,
  MemoryImportResult,
} from './types.js';
import { v4 as uuidv4 } from 'uuid';

export interface MemoryImportOptions {
  personalityId: string; // V3 personality UUID
  personalityName: string;
  uuidMapper: UUIDMapper;
  uuidMappings?: Map<string, { discordId: string; newUserId?: string; note?: string }>;
  qdrant?: QdrantClient; // Required for actual writes
  openai?: OpenAI; // Required for embeddings
  skipExisting?: boolean; // Don't re-import existing memories
  dryRun?: boolean; // Parse but don't write to Qdrant
}

export class MemoryImporter {
  private options: MemoryImportOptions;
  private stats: MemoryImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    orphaned: 0,
    errors: [],
  };

  constructor(options: MemoryImportOptions) {
    this.options = options;
  }

  /**
   * Import memories from shapes.inc format
   */
  async importMemories(shapesMemories: ShapesIncMemory[]): Promise<MemoryImportResult> {
    console.log(`\n📦 Importing ${shapesMemories.length} memories...`);

    for (const memory of shapesMemories) {
      try {
        await this.importSingleMemory(memory);
      } catch (error) {
        this.stats.failed++;
        this.stats.errors.push({
          memoryId: memory.id,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`  ❌ Failed to import memory ${memory.id}:`, error);
      }
    }

    return this.stats;
  }

  /**
   * Import a single memory
   *
   * For memories with multiple senders (group conversations), creates a separate
   * entry in each sender's persona collection. This ensures all participants
   * have access to the memory in their own context.
   */
  private async importSingleMemory(memory: ShapesIncMemory): Promise<void> {
    // Resolve all senders to v3 personas
    const senderResolutions = await this.resolveSenders(memory.senders);

    if (senderResolutions.length === 0) {
      throw new Error('No senders found in memory');
    }

    // Extract summary text (shared across all sender copies)
    const summaryText = memory.result;

    // Generate embedding once (shared across all sender copies)
    let embedding: number[] | null = null;
    if (!this.options.dryRun) {
      if (!this.options.openai) {
        throw new Error('OpenAI client required for embedding generation');
      }
      embedding = await this.generateEmbedding(summaryText);
    }

    // Create a separate memory entry for each sender
    for (const sender of senderResolutions) {
      // Build v3 Qdrant metadata for this sender
      const v3Metadata = this.buildV3Metadata(memory, sender);

      // Generate unique memory ID for this sender's copy
      const memoryCopyId = senderResolutions.length > 1
        ? `${memory.id}/sender-${sender.v3PersonaId}`
        : memory.id;

      if (this.options.dryRun) {
        console.log(`  🔍 [DRY RUN] Would import memory ${memoryCopyId}`);
        console.log(`     Persona: ${v3Metadata.personaId} (orphaned: ${sender.isOrphaned})`);
        console.log(`     Text length: ${summaryText.length} chars`);
        if (senderResolutions.length > 1) {
          console.log(`     [Group conversation: ${senderResolutions.length} participants]`);
        }
      } else {
        // Store in Qdrant
        if (!this.options.qdrant || !embedding) {
          throw new Error('Qdrant client and embedding required for memory storage');
        }

        await this.storeInQdrant(
          memoryCopyId,
          summaryText,
          embedding,
          v3Metadata
        );

        console.log(`  ✅ Imported memory ${memoryCopyId}`);
        console.log(`     Persona: ${v3Metadata.personaId} (orphaned: ${sender.isOrphaned})`);
        if (senderResolutions.length > 1) {
          console.log(`     [Group conversation: ${senderResolutions.length} participants]`);
        }
      }

      // Track statistics
      this.stats.imported++;
      if (sender.isOrphaned) {
        this.stats.orphaned++;
      }
    }
  }

  /**
   * Generate embedding for memory text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.options.openai) {
      throw new Error('OpenAI client not configured');
    }

    const response = await this.options.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    return response.data[0].embedding;
  }

  /**
   * Store memory in Qdrant
   */
  private async storeInQdrant(
    memoryId: string,
    content: string,
    embedding: number[],
    metadata: V3MemoryMetadata
  ): Promise<void> {
    if (!this.options.qdrant) {
      throw new Error('Qdrant client not configured');
    }

    // Collection name is persona-scoped
    const collectionName = `persona-${metadata.personaId}`;

    // Ensure collection exists
    await this.ensureCollection(collectionName, embedding.length);

    // Generate point ID (use shapes.inc memory ID or generate new UUID)
    const pointId = memoryId || uuidv4();

    // Store point with vector and metadata
    await this.options.qdrant.upsert(collectionName, {
      points: [
        {
          id: pointId,
          vector: embedding,
          payload: {
            content,
            personaId: metadata.personaId,
            personalityId: metadata.personalityId,
            personalityName: metadata.personalityName,
            sessionId: metadata.sessionId,
            canonScope: metadata.canonScope,
            createdAt: metadata.timestamp,
            summaryType: metadata.summaryType,
            contextType: metadata.contextType,
            channelId: metadata.channelId,
            guildId: metadata.guildId,
            serverId: metadata.serverId,
          },
        },
      ],
    });
  }

  /**
   * Ensure Qdrant collection exists with proper configuration
   */
  private async ensureCollection(
    collectionName: string,
    vectorSize: number
  ): Promise<void> {
    if (!this.options.qdrant) {
      throw new Error('Qdrant client not configured');
    }

    try {
      // Check if collection exists
      await this.options.qdrant.getCollection(collectionName);
    } catch (error) {
      // Collection doesn't exist, create it
      await this.options.qdrant.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      });

      // Create payload indexes for filtering
      await this.options.qdrant.createPayloadIndex(collectionName, {
        field_name: 'personalityId',
        field_schema: 'keyword',
      });

      await this.options.qdrant.createPayloadIndex(collectionName, {
        field_name: 'createdAt',
        field_schema: 'integer',
      });

      await this.options.qdrant.createPayloadIndex(collectionName, {
        field_name: 'sessionId',
        field_schema: 'keyword',
      });
    }
  }

  /**
   * Resolve sender UUIDs to v3 personas
   */
  private async resolveSenders(
    shapesUserIds: string[]
  ): Promise<UserResolutionResult[]> {
    const resolutions: UserResolutionResult[] = [];

    for (const shapesUserId of shapesUserIds) {
      // Look up Discord ID from UUID mappings if available
      const mappingData = this.options.uuidMappings?.get(shapesUserId);
      const shapesUserData = mappingData ? { discordId: mappingData.discordId } : undefined;

      // Resolve using UUID mapper with Discord ID data if available
      const resolution = await this.options.uuidMapper.resolveUser(shapesUserId, shapesUserData);
      resolutions.push(resolution);
    }

    return resolutions;
  }

  /**
   * Build v3 Qdrant metadata from shapes.inc memory
   */
  private buildV3Metadata(
    memory: ShapesIncMemory,
    sender: UserResolutionResult
  ): V3MemoryMetadata {
    return {
      personaId: sender.v3PersonaId!,
      personalityId: this.options.personalityId,
      personalityName: this.options.personalityName,
      sessionId: null, // Shapes.inc didn't have sessions
      canonScope: sender.isOrphaned ? 'shared' : 'personal',
      timestamp: Math.floor(memory.metadata.created_at * 1000), // Convert seconds to milliseconds
      summaryType: 'conversation',
      contextType: memory.metadata.discord_guild_id ? 'guild' : 'dm',
      channelId: memory.metadata.discord_channel_id,
      guildId: memory.metadata.discord_guild_id,
      serverId: memory.metadata.discord_guild_id, // Guild ID = Server ID in Discord
    };
  }

  /**
   * Get import statistics
   */
  getStats(): MemoryImportResult {
    return this.stats;
  }

  /**
   * Validate shapes.inc memories before import
   */
  static validate(memories: ShapesIncMemory[]): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (memories.length === 0) {
      warnings.push('No memories to import');
    }

    const seenIds = new Set<string>();
    for (const memory of memories) {
      // Check for duplicate IDs
      if (seenIds.has(memory.id)) {
        errors.push(`Duplicate memory ID: ${memory.id}`);
      }
      seenIds.add(memory.id);

      // Validate required fields
      if (!memory.result || memory.result.trim().length === 0) {
        errors.push(`Memory ${memory.id} has empty summary text`);
      }

      if (!memory.senders || memory.senders.length === 0) {
        errors.push(`Memory ${memory.id} has no senders`);
      }

      // Validate timestamps
      if (!memory.metadata.created_at || memory.metadata.created_at <= 0) {
        errors.push(`Memory ${memory.id} has invalid timestamp`);
      }

      // Validate personality ID match
      // (This would need to be checked against expected personality ID)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get date range of memories
   */
  static getDateRange(memories: ShapesIncMemory[]): {
    earliest: Date | null;
    latest: Date | null;
  } {
    if (memories.length === 0) {
      return { earliest: null, latest: null };
    }

    const timestamps = memories
      .map((m) => m.metadata.created_at)
      .filter((t) => t > 0)
      .sort((a, b) => a - b);

    if (timestamps.length === 0) {
      return { earliest: null, latest: null };
    }

    return {
      earliest: new Date(timestamps[0] * 1000),
      latest: new Date(timestamps[timestamps.length - 1] * 1000),
    };
  }

  /**
   * Get unique senders from memories
   */
  static getUniqueSenders(memories: ShapesIncMemory[]): string[] {
    const senders = new Set<string>();

    for (const memory of memories) {
      for (const sender of memory.senders) {
        senders.add(sender);
      }
    }

    return Array.from(senders);
  }
}
