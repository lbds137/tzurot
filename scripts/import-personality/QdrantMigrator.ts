/**
 * QdrantMigrator - Cleanup and standardize existing Qdrant memories
 *
 * Problem: Lilith and other personalities have memories in old/inconsistent formats
 * - Some missing personaId
 * - Some with old metadata structure
 * - Some orphaned entries without proper persona assignment
 *
 * This tool:
 * 1. Finds memories with old/incomplete metadata
 * 2. Updates to v3 standard format
 * 3. Assigns personas for orphaned entries
 * 4. Validates and reports on migration
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import type { PrismaClient } from '@prisma/client';

export interface MigrationOptions {
  qdrant: QdrantClient;
  prisma: PrismaClient;
  orphanedPersonaId: string; // Where to assign orphaned memories
  dryRun?: boolean; // Parse and report without making changes
}

export interface MigrationResult {
  totalScanned: number;
  needsMigration: number;
  migrated: number;
  failed: number;
  skipped: number;
  errors: Array<{ memoryId: string; error: string }>;
}

export interface MemoryIssue {
  memoryId: string;
  collectionName: string;
  issues: string[];
  currentMetadata: Record<string, any>;
  suggestedFix: Record<string, any>;
}

export class QdrantMigrator {
  private options: MigrationOptions;
  private stats: MigrationResult = {
    totalScanned: 0,
    needsMigration: 0,
    migrated: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  constructor(options: MigrationOptions) {
    this.options = options;
  }

  /**
   * Scan all Qdrant collections for migration issues
   */
  async scan(): Promise<MemoryIssue[]> {
    console.log('\n🔍 Scanning Qdrant collections for migration issues...\n');

    const issues: MemoryIssue[] = [];

    try {
      // Get all collections
      const collections = await this.options.qdrant.getCollections();
      console.log(`Found ${collections.collections.length} collections\n`);

      for (const collection of collections.collections) {
        const collectionName = collection.name;
        console.log(`📂 Scanning collection: ${collectionName}`);

        const collectionIssues = await this.scanCollection(collectionName);
        issues.push(...collectionIssues);

        console.log(`   Found ${collectionIssues.length} memories needing migration\n`);
      }

      this.stats.needsMigration = issues.length;
      return issues;

    } catch (error) {
      console.error('❌ Failed to scan collections:', error);
      throw error;
    }
  }

  /**
   * Scan a single collection for issues
   */
  private async scanCollection(collectionName: string): Promise<MemoryIssue[]> {
    const issues: MemoryIssue[] = [];

    try {
      // Scroll through all points in the collection
      let offset: string | number | null = null;
      let hasMore = true;

      while (hasMore) {
        const response = await this.options.qdrant.scroll(collectionName, {
          limit: 100,
          offset: offset || undefined,
          with_payload: true,
          with_vector: false, // We don't need vectors for scanning
        });

        this.stats.totalScanned += response.points.length;

        for (const point of response.points) {
          const memoryIssues = this.checkMemory(
            point.id.toString(),
            collectionName,
            point.payload || {}
          );

          if (memoryIssues.issues.length > 0) {
            issues.push(memoryIssues);
          }
        }

        // Check if there are more points
        offset = response.next_page_offset || null;
        hasMore = offset !== null;
      }

      return issues;

    } catch (error) {
      console.error(`   ❌ Failed to scan collection ${collectionName}:`, error);
      return [];
    }
  }

  /**
   * Check a single memory for issues
   */
  private checkMemory(
    memoryId: string,
    collectionName: string,
    payload: Record<string, any>
  ): MemoryIssue {
    const issues: string[] = [];
    const suggestedFix: Record<string, any> = {};

    // Check for missing required fields
    if (!payload.personaId) {
      issues.push('Missing personaId');
      suggestedFix.personaId = this.options.orphanedPersonaId;
    }

    if (!payload.personalityId) {
      issues.push('Missing personalityId');
      // Try to extract from collection name
      if (collectionName.startsWith('persona-')) {
        // Can't infer personality ID from persona collection
        suggestedFix.personalityId = '(needs manual assignment)';
      }
    }

    if (!payload.personalityName) {
      issues.push('Missing personalityName');
      suggestedFix.personalityName = '(needs lookup from personalityId)';
    }

    // Check for old field names (if any were used before)
    if (payload.timestamp && !payload.createdAt) {
      issues.push('Using old timestamp field instead of createdAt');
      suggestedFix.createdAt = payload.timestamp;
    }

    // Check canonScope
    if (!payload.canonScope) {
      issues.push('Missing canonScope');
      // If no personaId, it's shared; otherwise personal
      suggestedFix.canonScope = payload.personaId ? 'personal' : 'shared';
    }

    // Check timestamp format (should be milliseconds)
    if (payload.createdAt && payload.createdAt < 1000000000000) {
      issues.push('Timestamp appears to be in seconds instead of milliseconds');
      suggestedFix.createdAt = payload.createdAt * 1000;
    }

    return {
      memoryId,
      collectionName,
      issues,
      currentMetadata: payload,
      suggestedFix,
    };
  }

  /**
   * Migrate all identified issues
   */
  async migrate(issues: MemoryIssue[]): Promise<MigrationResult> {
    console.log(`\n🔧 Migrating ${issues.length} memories...\n`);

    for (const issue of issues) {
      try {
        if (this.options.dryRun) {
          console.log(`[DRY RUN] Would migrate memory ${issue.memoryId} in ${issue.collectionName}`);
          console.log(`  Issues: ${issue.issues.join(', ')}`);
          console.log(`  Suggested fixes: ${JSON.stringify(issue.suggestedFix, null, 2)}`);
          this.stats.migrated++;
        } else {
          await this.migrateMemory(issue);
          this.stats.migrated++;
          console.log(`✅ Migrated memory ${issue.memoryId}`);
        }
      } catch (error) {
        this.stats.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.stats.errors.push({
          memoryId: issue.memoryId,
          error: errorMsg,
        });
        console.error(`❌ Failed to migrate memory ${issue.memoryId}:`, error);
      }
    }

    return this.stats;
  }

  /**
   * Migrate a single memory
   */
  private async migrateMemory(issue: MemoryIssue): Promise<void> {
    // Build updated payload
    const updatedPayload = {
      ...issue.currentMetadata,
      ...issue.suggestedFix,
    };

    // If personalityName needs lookup, fetch it
    if (updatedPayload.personalityName === '(needs lookup from personalityId)') {
      const personality = await this.options.prisma.personality.findUnique({
        where: { id: updatedPayload.personalityId },
        select: { name: true },
      });
      updatedPayload.personalityName = personality?.name || 'Unknown';
    }

    // Update the point in Qdrant
    await this.options.qdrant.setPayload(issue.collectionName, {
      points: [issue.memoryId],
      payload: updatedPayload,
    });
  }

  /**
   * Generate migration report
   */
  generateReport(issues: MemoryIssue[]): string {
    const lines: string[] = [];

    lines.push('═'.repeat(80));
    lines.push('Qdrant Migration Report');
    lines.push('═'.repeat(80));
    lines.push('');

    // Summary
    lines.push('📊 Summary:');
    lines.push(`  Total memories scanned: ${this.stats.totalScanned}`);
    lines.push(`  Memories needing migration: ${this.stats.needsMigration}`);
    lines.push(`  Migrated: ${this.stats.migrated}`);
    lines.push(`  Failed: ${this.stats.failed}`);
    lines.push(`  Skipped: ${this.stats.skipped}`);
    lines.push('');

    // Issue breakdown
    const issueTypes = new Map<string, number>();
    for (const issue of issues) {
      for (const issueText of issue.issues) {
        issueTypes.set(issueText, (issueTypes.get(issueText) || 0) + 1);
      }
    }

    lines.push('🔍 Issue Breakdown:');
    for (const [issueType, count] of issueTypes.entries()) {
      lines.push(`  ${issueType}: ${count}`);
    }
    lines.push('');

    // Errors
    if (this.stats.errors.length > 0) {
      lines.push('❌ Errors:');
      for (const error of this.stats.errors) {
        lines.push(`  ${error.memoryId}: ${error.error}`);
      }
      lines.push('');
    }

    // Collections affected
    const collections = new Set(issues.map(i => i.collectionName));
    lines.push('📂 Collections Affected:');
    for (const collection of collections) {
      const collectionIssues = issues.filter(i => i.collectionName === collection);
      lines.push(`  ${collection}: ${collectionIssues.length} memories`);
    }
    lines.push('');

    lines.push('═'.repeat(80));

    return lines.join('\n');
  }

  /**
   * Get statistics
   */
  getStats(): MigrationResult {
    return this.stats;
  }
}
