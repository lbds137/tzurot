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

import { UUIDMapper, type UserResolutionResult } from './UUIDMapper.js';
import type {
  ShapesIncMemory,
  V3MemoryMetadata,
  MemoryImportResult,
} from './types.js';

export interface MemoryImportOptions {
  personalityId: string; // V3 personality UUID
  personalityName: string;
  uuidMapper: UUIDMapper;
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
   */
  private async importSingleMemory(memory: ShapesIncMemory): Promise<void> {
    // Resolve all senders to v3 personas
    const senderResolutions = await this.resolveSenders(memory.senders);

    // Determine which persona this memory belongs to
    // For now, we use the first sender's persona (or orphaned if none resolved)
    const primarySender = senderResolutions[0];
    if (!primarySender) {
      throw new Error('No senders found in memory');
    }

    if (primarySender.isOrphaned) {
      this.stats.orphaned++;
    }

    // Build v3 Qdrant metadata
    const v3Metadata = this.buildV3Metadata(memory, primarySender);

    // Extract summary text
    const summaryText = memory.result;

    if (this.options.dryRun) {
      console.log(`  🔍 [DRY RUN] Would import memory ${memory.id}`);
      console.log(`     Persona: ${v3Metadata.personaId} (orphaned: ${primarySender.isOrphaned})`);
      console.log(`     Text length: ${summaryText.length} chars`);
      this.stats.imported++;
      return;
    }

    // TODO: Generate embedding and store in Qdrant
    // For now, just log what we would do
    console.log(`  ✅ Memory ${memory.id} ready for import`);
    console.log(`     Persona: ${v3Metadata.personaId} (orphaned: ${primarySender.isOrphaned})`);
    this.stats.imported++;

    // NOTE: Actual Qdrant import will be implemented in the full CLI tool
    // This requires:
    // 1. OpenAI embedding generation
    // 2. Qdrant client initialization
    // 3. Point insertion with vector + metadata
  }

  /**
   * Resolve sender UUIDs to v3 personas
   */
  private async resolveSenders(
    shapesUserIds: string[]
  ): Promise<UserResolutionResult[]> {
    const resolutions: UserResolutionResult[] = [];

    for (const shapesUserId of shapesUserIds) {
      const resolution = await this.options.uuidMapper.resolveUser(shapesUserId);
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
