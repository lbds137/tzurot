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
import type { PrismaClient } from '@prisma/client';
import type { ShapesIncMemory, V3MemoryMetadata, MemoryImportResult } from './types.js';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';

// UUID namespace for generating deterministic memory copy IDs
const MEMORY_NAMESPACE = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

interface UUIDMappingData {
  discordId: string;
  newUserId?: string;
  note?: string;
}

export interface MemoryImportOptions {
  personalityId: string; // V3 personality UUID
  personalityName: string;
  prisma: PrismaClient; // Required for user resolution
  uuidMappings?: Map<string, UUIDMappingData>; // Shapes UUID → Discord ID mappings
  qdrant?: QdrantClient; // Required for actual writes
  openai?: OpenAI; // Required for embeddings
  skipExisting?: boolean; // Don't re-import existing memories
  dryRun?: boolean; // Parse but don't write to Qdrant
  memoryDelayMs?: number; // Delay between individual memory imports (default: 200ms)
}

export class MemoryImporter {
  private options: MemoryImportOptions;
  private stats: MemoryImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    migratedToV3: 0,
    legacyPersonasCreated: 0,
    errors: [],
  };
  private legacyPersonas = new Set<string>(); // Track unique legacy persona IDs
  private v3Personas = new Set<string>(); // Track unique v3 persona IDs
  private personaCache = new Map<string, string | null>(); // Discord ID → persona ID cache
  private ensuredCollections = new Set<string>(); // Track collections already created/verified

  constructor(options: MemoryImportOptions) {
    this.options = options;
  }

  /**
   * Import memories from shapes.inc format
   * NEW: Batched approach to avoid HTTP overhead - collect all points, then batch upsert
   */
  async importMemories(shapesMemories: ShapesIncMemory[]): Promise<MemoryImportResult> {
    console.log(`\n📦 Importing ${shapesMemories.length} memories...`);

    // Phase 1: Collect all points to insert (grouped by collection)
    console.log('  Phase 1: Preparing memory points...');
    const pointsByCollection = new Map<
      string,
      Array<{
        id: string;
        vector: number[];
        payload: Record<string, any>;
        memoryId: string;
        shapesUserId: string;
      }>
    >();

    for (const memory of shapesMemories) {
      try {
        const points = await this.prepareMemoryPoints(memory);

        // Group points by collection
        for (const point of points) {
          const collectionName = `persona-${point.payload.personaId}`;
          if (!pointsByCollection.has(collectionName)) {
            pointsByCollection.set(collectionName, []);
          }
          pointsByCollection.get(collectionName)!.push(point);
        }
      } catch (error) {
        this.stats.failed++;
        this.stats.errors.push({
          memoryId: memory.id,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`  ❌ Failed to prepare memory ${memory.id}:`, error);
      }
    }

    // Phase 2: Batch upsert points by collection
    console.log(`  Phase 2: Batch upserting to ${pointsByCollection.size} collections...`);
    for (const [collectionName, points] of pointsByCollection.entries()) {
      await this.batchUpsertPoints(collectionName, points);
    }

    return this.stats;
  }

  /**
   * Prepare memory points for batched insert (doesn't actually upsert)
   * Returns array of points ready to be batched
   */
  private async prepareMemoryPoints(memory: ShapesIncMemory): Promise<
    Array<{
      id: string;
      vector: number[];
      payload: Record<string, any>;
      memoryId: string;
      shapesUserId: string;
    }>
  > {
    if (!memory.senders || memory.senders.length === 0) {
      throw new Error('No senders found in memory');
    }

    const summaryText = memory.result;

    // Generate embedding ONCE for the memory (shared across all sender copies)
    let embedding: number[] | null = null;
    if (!this.options.dryRun) {
      if (!this.options.openai) {
        throw new Error('OpenAI client required for embedding generation');
      }
      embedding = await this.generateEmbedding(summaryText);
    }

    const points: Array<{
      id: string;
      vector: number[];
      payload: Record<string, any>;
      memoryId: string;
      shapesUserId: string;
    }> = [];

    // Create a separate memory entry for each sender
    for (const shapesUserId of memory.senders) {
      // Try to resolve to v3 persona using mappings
      const resolution = await this.resolveShapesUser(shapesUserId);

      // Build v3 Qdrant metadata
      const v3Metadata = this.buildV3Metadata(memory, shapesUserId, resolution);

      // Generate unique memory ID for this sender's copy
      const baseMemoryId = memory.id.split('/')[0];
      const memoryCopyId =
        memory.senders.length > 1
          ? uuidv5(`${baseMemoryId}:${shapesUserId}`, MEMORY_NAMESPACE)
          : baseMemoryId;

      // Check if skipExisting is enabled and memory already exists
      if (this.options.skipExisting && !this.options.dryRun) {
        const exists = await this.checkMemoryExists(memoryCopyId, v3Metadata.personaId);
        if (exists) {
          console.log(`  ⏭️  Skipping existing memory ${memoryCopyId}`);
          this.stats.skipped++;
          continue;
        }
      }

      if (this.options.dryRun || !embedding) {
        console.log(`  🔍 [DRY RUN] Would import memory ${memoryCopyId}`);
        if (resolution.v3PersonaId) {
          console.log(`     ✅ V3 Persona: ${resolution.v3PersonaId} (known user)`);
        } else {
          console.log(`     📦 Legacy Persona: legacy-${shapesUserId} (unknown user)`);
        }
        continue;
      }

      // Add point to collection
      points.push({
        id: memoryCopyId,
        vector: embedding,
        payload: {
          content: summaryText,
          personaId: v3Metadata.personaId,
          personalityId: v3Metadata.personalityId,
          personalityName: v3Metadata.personalityName,
          sessionId: v3Metadata.sessionId,
          canonScope: v3Metadata.canonScope,
          createdAt: v3Metadata.timestamp,
          summaryType: v3Metadata.summaryType,
          contextType: v3Metadata.contextType,
          channelId: v3Metadata.channelId,
          guildId: v3Metadata.guildId,
          serverId: v3Metadata.serverId,
        },
        memoryId: memoryCopyId,
        shapesUserId,
      });

      // Track stats (we'll log after batching)
      this.stats.imported++;
      if (resolution.v3PersonaId) {
        this.stats.migratedToV3++;
        if (!this.v3Personas.has(resolution.v3PersonaId)) {
          this.v3Personas.add(resolution.v3PersonaId);
        }
      } else {
        const legacyPersonaId = `legacy-${shapesUserId}`;
        if (!this.legacyPersonas.has(legacyPersonaId)) {
          this.legacyPersonas.add(legacyPersonaId);
          this.stats.legacyPersonasCreated++;
        }
      }
    }

    return points;
  }

  /**
   * Batch upsert points to a single collection
   * Splits into batches of 100 points to avoid overwhelming Qdrant
   */
  private async batchUpsertPoints(
    collectionName: string,
    points: Array<{
      id: string;
      vector: number[];
      payload: Record<string, any>;
      memoryId: string;
      shapesUserId: string;
    }>
  ): Promise<void> {
    if (!this.options.qdrant || this.options.dryRun) {
      return;
    }

    // Ensure collection exists (get vector size from first point)
    if (points.length > 0) {
      await this.ensureCollection(collectionName, points[0].vector.length);
    }

    // Batch size: 250 points (Gemini recommended 50-1024, balancing throughput vs. request size)
    const BATCH_SIZE = 250;
    const batches: (typeof points)[] = [];

    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      batches.push(points.slice(i, i + BATCH_SIZE));
    }

    console.log(
      `  📤 Upserting ${points.length} points to ${collectionName} in ${batches.length} batches...`
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const isLastBatch = i === batches.length - 1;

      try {
        // Strategy: Use wait=false for ALL batches during bulk import
        // Qdrant will process indexing in background, preventing resource exhaustion
        // (Gemini recommendation: Never block on indexing during bulk operations)
        const shouldWait = false;

        // Timeout: 30s for all batches (no indexing wait)
        const timeoutMs = 30000;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Batch upsert timed out after ${timeoutMs / 1000}s`)),
            timeoutMs
          )
        );

        await Promise.race([
          this.options.qdrant.upsert(collectionName, {
            wait: shouldWait, // Only wait on last batch to verify completion
            points: batch.map(p => ({
              id: p.id,
              vector: p.vector,
              payload: p.payload,
            })),
          }),
          timeoutPromise,
        ]);

        console.log(
          `     ✅ Batch ${i + 1}/${batches.length} ${shouldWait ? '(verified)' : '(sent)'} (${batch.length} points)`
        );

        // Add small delay between batches (skip after last batch)
        if (!isLastBatch) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(`     ❌ Batch ${i + 1}/${batches.length} failed:`, error);
        // Mark all points in failed batch as failed
        for (const point of batch) {
          this.stats.failed++;
          this.stats.imported--; // Undo the optimistic increment
          this.stats.errors.push({
            memoryId: point.memoryId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  /**
   * DEPRECATED: Import a single memory (old single-point upsert approach)
   *
   * HYBRID APPROACH:
   * - Known users (in uuid-mappings.json) → Auto-migrate to v3 persona
   * - Unknown users → Store in legacy-{shapesUserId} collection
   *
   * For memories with multiple senders (group conversations), creates a separate
   * entry in each sender's collection.
   */
  private async importSingleMemory(memory: ShapesIncMemory): Promise<void> {
    if (!memory.senders || memory.senders.length === 0) {
      throw new Error('No senders found in memory');
    }

    // Extract summary text (shared across all sender copies)
    const summaryText = memory.result;

    // Generate embedding ONCE for the memory (shared across all sender copies)
    let embedding: number[] | null = null;
    if (!this.options.dryRun) {
      if (!this.options.openai) {
        throw new Error('OpenAI client required for embedding generation');
      }
      embedding = await this.generateEmbedding(summaryText);
    }

    // Create a separate memory entry for each sender
    const delayMs = this.options.memoryDelayMs ?? 200;
    for (let i = 0; i < memory.senders.length; i++) {
      const shapesUserId = memory.senders[i];

      // Try to resolve to v3 persona using mappings
      const resolution = await this.resolveShapesUser(shapesUserId);

      // Build v3 Qdrant metadata
      const v3Metadata = this.buildV3Metadata(memory, shapesUserId, resolution);

      // Generate unique memory ID for this sender's copy
      // Shapes.inc memory IDs have format: {uuid}/{uuid} or {uuid}/{uuid}/sender-{uuid}
      // Extract the first UUID as the base, then create deterministic IDs for each sender
      const baseMemoryId = memory.id.split('/')[0];
      const memoryCopyId =
        memory.senders.length > 1
          ? uuidv5(`${baseMemoryId}:${shapesUserId}`, MEMORY_NAMESPACE)
          : baseMemoryId;

      // Check if skipExisting is enabled and memory already exists
      if (this.options.skipExisting && !this.options.dryRun) {
        const exists = await this.checkMemoryExists(memoryCopyId, v3Metadata.personaId);
        if (exists) {
          console.log(`  ⏭️  Skipping existing memory ${memoryCopyId}`);
          this.stats.skipped++;
          continue;
        }
      }

      if (this.options.dryRun) {
        console.log(`  🔍 [DRY RUN] Would import memory ${memoryCopyId}`);
        if (resolution.v3PersonaId) {
          console.log(`     ✅ V3 Persona: ${resolution.v3PersonaId} (known user)`);
        } else {
          console.log(`     📦 Legacy Persona: legacy-${shapesUserId} (unknown user)`);
        }
        console.log(`     Text length: ${summaryText.length} chars`);
        if (memory.senders.length > 1) {
          console.log(`     [Group conversation: ${memory.senders.length} participants]`);
        }
      } else {
        // Store in Qdrant
        if (!this.options.qdrant || !embedding) {
          throw new Error('Qdrant client and embedding required for memory storage');
        }

        // Wrap Qdrant operation with timeout (30 seconds)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Qdrant operation timed out after 30s')), 30000)
        );

        try {
          await Promise.race([
            this.storeInQdrant(memoryCopyId, summaryText, embedding, v3Metadata),
            timeoutPromise,
          ]);

          if (resolution.v3PersonaId) {
            console.log(`  ✅ Imported memory ${memoryCopyId}`);
            console.log(`     V3 Persona: ${resolution.v3PersonaId} (known user)`);
          } else {
            console.log(`  ✅ Imported memory ${memoryCopyId}`);
            console.log(`     Legacy Persona: legacy-${shapesUserId} (unknown user)`);
          }
          if (memory.senders.length > 1) {
            console.log(`     [Group conversation: ${memory.senders.length} participants]`);
          }

          // Track success statistics
          this.stats.imported++;
          if (resolution.v3PersonaId) {
            this.stats.migratedToV3++;
            if (!this.v3Personas.has(resolution.v3PersonaId)) {
              this.v3Personas.add(resolution.v3PersonaId);
            }
          } else {
            const legacyPersonaId = `legacy-${shapesUserId}`;
            if (!this.legacyPersonas.has(legacyPersonaId)) {
              this.legacyPersonas.add(legacyPersonaId);
              this.stats.legacyPersonasCreated++;
            }
          }
        } catch (error) {
          // If Qdrant times out or fails, log and skip this sender's copy
          console.error(
            `  ⚠️  Failed to import memory ${memoryCopyId} for sender ${shapesUserId}:`
          );
          console.error(`     ${error instanceof Error ? error.message : String(error)}`);
          this.stats.failed++;
          this.stats.errors.push({
            memoryId: `${memoryCopyId} (sender: ${shapesUserId})`,
            error: error instanceof Error ? error.message : String(error),
          });
          continue; // Skip to next sender
        }
      }

      // Add delay between sender copies in group conversations (except after the last one)
      // Use 2x the normal delay for group conversations to give Qdrant more breathing room
      if (memory.senders.length > 1 && i < memory.senders.length - 1 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs * 2));
      }
    }
  }

  /**
   * Check if a memory already exists in Qdrant
   */
  private async checkMemoryExists(memoryId: string, personaId: string): Promise<boolean> {
    if (!this.options.qdrant) {
      return false;
    }

    try {
      const collectionName = `persona-${personaId}`;

      // Check if collection exists
      try {
        await this.options.qdrant.getCollection(collectionName);
      } catch {
        // Collection doesn't exist, so memory doesn't exist
        return false;
      }

      // Try to retrieve the specific point
      const result = await this.options.qdrant.retrieve(collectionName, {
        ids: [memoryId],
      });

      return result.length > 0;
    } catch (error) {
      // If any error occurs, assume memory doesn't exist
      return false;
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

    // Store point with vector and metadata (wait=false for async processing)
    await this.options.qdrant.upsert(collectionName, {
      wait: false,
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
  private async ensureCollection(collectionName: string, vectorSize: number): Promise<void> {
    if (!this.options.qdrant) {
      throw new Error('Qdrant client not configured');
    }

    // Check cache first to avoid redundant API calls
    if (this.ensuredCollections.has(collectionName)) {
      return;
    }

    try {
      // Check if collection exists
      await this.options.qdrant.getCollection(collectionName);
      // Collection exists, add to cache
      this.ensuredCollections.add(collectionName);
    } catch (error) {
      // Collection doesn't exist, create it with disk storage for vectors and HNSW index
      await this.options.qdrant.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
          on_disk: true, // Store vectors on disk to avoid RAM exhaustion
        },
        hnsw_config: {
          on_disk: true, // Store HNSW index on disk to avoid RAM exhaustion
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

      // Add to cache after successful creation
      this.ensuredCollections.add(collectionName);
    }
  }

  /**
   * Resolve shapes.inc user to v3 persona (if known)
   */
  private async resolveShapesUser(shapesUserId: string): Promise<{
    v3PersonaId: string | null;
    discordId: string | null;
  }> {
    // Check if we have a mapping for this shapes user
    const mapping = this.options.uuidMappings?.get(shapesUserId);
    if (!mapping) {
      return { v3PersonaId: null, discordId: null };
    }

    const discordId = mapping.discordId;

    // Check cache
    if (this.personaCache.has(discordId)) {
      const personaId = this.personaCache.get(discordId);
      return { v3PersonaId: personaId || null, discordId };
    }

    // Look up v3 user by Discord ID
    const user = await this.options.prisma.user.findUnique({
      where: { discordId },
      include: {
        defaultPersonaLink: {
          select: { personaId: true },
        },
      },
    });

    const personaId = user?.defaultPersonaLink?.personaId || null;
    this.personaCache.set(discordId, personaId);

    return { v3PersonaId: personaId, discordId };
  }

  /**
   * Build v3 Qdrant metadata from shapes.inc memory
   */
  private buildV3Metadata(
    memory: ShapesIncMemory,
    shapesUserId: string,
    resolution: { v3PersonaId: string | null; discordId: string | null }
  ): V3MemoryMetadata {
    return {
      personaId: resolution.v3PersonaId || `legacy-${shapesUserId}`,
      personalityId: this.options.personalityId,
      personalityName: this.options.personalityName,
      sessionId: null, // Shapes.inc didn't have sessions
      canonScope: resolution.v3PersonaId ? 'personal' : 'legacy',
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
      .map(m => m.metadata.created_at)
      .filter(t => t > 0)
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
