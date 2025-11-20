#!/usr/bin/env tsx
/**
 * Migrate Orphaned Memories
 *
 * Migrates remaining orphaned memories from old personality-scoped collection
 * to new persona-legacy-{userId} collections.
 *
 * Usage:
 *   tsx scripts/import-personality/migrate-orphaned-memories.ts --dry-run
 *   tsx scripts/import-personality/migrate-orphaned-memories.ts
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { config as loadEnv } from 'dotenv';

loadEnv();

if (!process.env.QDRANT_URL || !process.env.QDRANT_API_KEY) {
  console.error('❌ Missing QDRANT_URL or QDRANT_API_KEY environment variables');
  process.exit(1);
}

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const LILITH_OLD_COLLECTION = 'personality-c296b337-4e67-5337-99a3-4ca105cbbd68';
const LILITH_PERSONALITY_ID = 'c296b337-4e67-5337-99a3-4ca105cbbd68';
const LILITH_NAME = 'Lilith';

interface MemoryPoint {
  id: string | number;
  vector: number[];
  payload: {
    userId?: string;
    personalityId?: string;
    content?: string;
    createdAt?: number;
    timestamp?: number;
    sessionId?: string | null;
    contextType?: string;
    channelId?: string;
    guildId?: string;
    serverId?: string;
    [key: string]: any;
  };
}

interface MigrationStats {
  total: number;
  migrated: number;
  failed: number;
  legacyCollectionsCreated: number;
  errors: { memoryId: string | number; error: string }[];
}

async function ensureCollection(collectionName: string, vectorSize: number): Promise<void> {
  try {
    await qdrant.getCollection(collectionName);
    console.log(`  ℹ️  Collection ${collectionName} already exists`);
  } catch (error) {
    console.log(`  ➕ Creating collection ${collectionName}...`);
    await qdrant.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
    });

    // Create payload indexes
    await qdrant.createPayloadIndex(collectionName, {
      field_name: 'personalityId',
      field_schema: 'keyword',
    });

    await qdrant.createPayloadIndex(collectionName, {
      field_name: 'createdAt',
      field_schema: 'integer',
    });

    await qdrant.createPayloadIndex(collectionName, {
      field_name: 'sessionId',
      field_schema: 'keyword',
    });

    console.log(`  ✅ Collection created with indexes`);
  }
}

async function migrateOrphanedMemories(dryRun: boolean): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    failed: 0,
    legacyCollectionsCreated: 0,
    errors: [],
  };

  const createdCollections = new Set<string>();
  let offset: string | number | null = null;
  let batchCount = 0;

  console.log(`📦 Fetching orphaned memories from ${LILITH_OLD_COLLECTION}...\n`);

  while (true) {
    const response = await qdrant.scroll(LILITH_OLD_COLLECTION, {
      limit: 100,
      offset,
      with_payload: true,
      with_vector: true,
    });

    if (response.points.length === 0) {
      break;
    }

    batchCount++;
    console.log(`Processing batch ${batchCount} (${response.points.length} memories)...`);

    for (const point of response.points) {
      stats.total++;

      try {
        const memory = point as unknown as MemoryPoint;
        const userId = memory.payload.userId || 'unknown';
        const legacyPersonaId = `legacy-${userId}`;
        const legacyCollectionName = `persona-${legacyPersonaId}`;

        // Ensure collection exists (only once per userId)
        if (!createdCollections.has(legacyCollectionName)) {
          if (!dryRun && memory.vector) {
            await ensureCollection(legacyCollectionName, memory.vector.length);
          }
          createdCollections.add(legacyCollectionName);
          stats.legacyCollectionsCreated++;
        }

        // Transform metadata to v3 format
        const transformedPayload = {
          content: memory.payload.content,
          personaId: legacyPersonaId,
          personalityId: LILITH_PERSONALITY_ID,
          personalityName: LILITH_NAME,
          sessionId: memory.payload.sessionId || null,
          canonScope: 'legacy',
          createdAt: memory.payload.createdAt || memory.payload.timestamp || Date.now(),
          summaryType: 'conversation',
          contextType: memory.payload.contextType || (memory.payload.guildId ? 'guild' : 'dm'),
          channelId: memory.payload.channelId,
          guildId: memory.payload.guildId,
          serverId: memory.payload.serverId || memory.payload.guildId,
        };

        if (dryRun) {
          if (stats.migrated < 5) {
            console.log(`  [DRY RUN] Would migrate memory ${memory.id}:`);
            console.log(`    From: ${LILITH_OLD_COLLECTION}`);
            console.log(`    To: ${legacyCollectionName}`);
            console.log(`    User: ${userId}`);
          }
        } else {
          // Insert into new collection
          await qdrant.upsert(legacyCollectionName, {
            points: [
              {
                id: memory.id,
                vector: memory.vector,
                payload: transformedPayload,
              },
            ],
          });

          // Delete from old collection
          await qdrant.delete(LILITH_OLD_COLLECTION, {
            points: [String(memory.id)],
          });
        }

        stats.migrated++;

        if (!dryRun && stats.migrated % 50 === 0) {
          console.log(`  ✅ Migrated ${stats.migrated}/${stats.total} memories...`);
        }
      } catch (error) {
        stats.failed++;
        stats.errors.push({
          memoryId: point.id,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`  ❌ Failed to migrate memory ${point.id}:`, error);
      }
    }

    offset = response.next_page_offset;
    if (!offset) {
      break;
    }

    // Small delay between batches
    if (!dryRun) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('\n🚚 Migrate Orphaned Memories');
  console.log('═'.repeat(80));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`);
  console.log('');

  // Step 1: Migrate memories
  console.log('Step 1: Migrating orphaned memories\n');

  const stats = await migrateOrphanedMemories(dryRun);

  console.log('');
  console.log('═'.repeat(80));
  console.log('📊 Migration Results:');
  console.log('═'.repeat(80));
  console.log(`  Total memories: ${stats.total}`);
  console.log(`  Successfully migrated: ${stats.migrated}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Legacy collections created: ${stats.legacyCollectionsCreated}`);

  if (stats.errors.length > 0) {
    console.log('');
    console.log('❌ Errors:');
    stats.errors.slice(0, 10).forEach(e => {
      console.log(`  - Memory ${e.memoryId}: ${e.error}`);
    });
    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more errors`);
    }
  }

  // Step 2: Verify old collection is empty
  if (!dryRun && stats.migrated > 0) {
    console.log('');
    console.log('Step 2: Verifying old collection is empty\n');

    const remainingResponse = await qdrant.scroll(LILITH_OLD_COLLECTION, {
      limit: 1,
      with_payload: false,
      with_vector: false,
    });

    const remainingCount = remainingResponse.points.length;

    if (remainingCount === 0) {
      console.log('✅ Old collection is now empty!');
      console.log('');
      console.log('🗑️  You can now delete the old collection with:');
      console.log(`  pnpm qdrant delete ${LILITH_OLD_COLLECTION}`);
    } else {
      console.log(`⚠️  Old collection still has ${remainingCount} memories`);
    }
  }

  console.log('');
  console.log('═'.repeat(80));
  if (dryRun) {
    console.log('[DRY RUN] Complete - no changes made');
    console.log('');
    console.log('To run for real, execute:');
    console.log('  tsx scripts/import-personality/migrate-orphaned-memories.ts');
  } else {
    console.log('✅ Migration Complete');
  }
  console.log('═'.repeat(80));
  console.log('');
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
