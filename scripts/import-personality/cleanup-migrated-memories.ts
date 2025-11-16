#!/usr/bin/env tsx
/**
 * Cleanup Migrated Memories
 *
 * Deletes memories from old personality-scoped collection that were already
 * migrated to new persona-scoped collection.
 *
 * Usage:
 *   tsx scripts/import-personality/cleanup-migrated-memories.ts --dry-run
 *   tsx scripts/import-personality/cleanup-migrated-memories.ts
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
const USER_PERSONA_COLLECTION = 'persona-3bd86394-20d8-5992-8201-e621856e9087';

async function getAllPointIds(collectionName: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset: string | number | null = null;

  console.log(`📦 Fetching all point IDs from ${collectionName}...`);

  while (true) {
    const response = await qdrant.scroll(collectionName, {
      limit: 100,
      offset,
      with_payload: false,
      with_vector: false,
    });

    for (const point of response.points) {
      ids.add(String(point.id));
    }

    offset = response.next_page_offset;
    if (!offset) {break;}

    if (ids.size % 500 === 0) {
      console.log(`  Fetched ${ids.size} IDs...`);
    }
  }

  console.log(`✅ Found ${ids.size} total points\n`);
  return ids;
}

async function deleteMigratedMemories(migratedIds: Set<string>, dryRun: boolean): Promise<void> {
  const idsArray = Array.from(migratedIds);
  const batchSize = 100;
  let deleted = 0;

  console.log(
    `🗑️  ${dryRun ? '[DRY RUN] Would delete' : 'Deleting'} ${idsArray.length} memories in batches of ${batchSize}...\n`
  );

  for (let i = 0; i < idsArray.length; i += batchSize) {
    const batch = idsArray.slice(i, Math.min(i + batchSize, idsArray.length));

    if (dryRun) {
      console.log(
        `  [DRY RUN] Would delete batch ${Math.floor(i / batchSize) + 1}: ${batch.length} memories`
      );
    } else {
      try {
        await qdrant.delete(LILITH_OLD_COLLECTION, {
          points: batch,
        });
        deleted += batch.length;
        console.log(
          `  ✅ Deleted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} memories (${deleted}/${idsArray.length} total)`
        );
      } catch (error) {
        console.error(`  ❌ Failed to delete batch ${Math.floor(i / batchSize) + 1}:`, error);
        throw error;
      }
    }

    // Small delay between batches to avoid overwhelming Qdrant
    if (!dryRun && i + batchSize < idsArray.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log('');
  if (dryRun) {
    console.log(`[DRY RUN] Would have deleted ${idsArray.length} memories`);
  } else {
    console.log(`✅ Successfully deleted ${deleted} memories`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('\n🧹 Cleanup Migrated Memories');
  console.log('═'.repeat(80));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE DELETION'}`);
  console.log('');

  // Step 1: Get IDs from both collections
  console.log('Step 1: Fetching point IDs\n');

  const oldCollectionIds = await getAllPointIds(LILITH_OLD_COLLECTION);
  const newCollectionIds = await getAllPointIds(USER_PERSONA_COLLECTION);

  // Step 2: Identify migrated memories
  console.log('Step 2: Identifying migrated memories\n');

  const migratedIds = new Set<string>();

  for (const id of oldCollectionIds) {
    if (newCollectionIds.has(id)) {
      migratedIds.add(id);
    }
  }

  console.log(`Found ${migratedIds.size} migrated memories to delete\n`);

  if (migratedIds.size === 0) {
    console.log('✅ No migrated memories to delete!');
    return;
  }

  // Step 3: Delete migrated memories
  console.log('Step 3: Deleting migrated memories\n');

  await deleteMigratedMemories(migratedIds, dryRun);

  // Step 4: Verify
  if (!dryRun) {
    console.log('\nStep 4: Verifying deletion\n');

    const remainingIds = await getAllPointIds(LILITH_OLD_COLLECTION);
    const orphanedCount = remainingIds.size;

    console.log('═'.repeat(80));
    console.log('✅ Cleanup Complete');
    console.log('');
    console.log(`Old collection now has ${orphanedCount} memories (should be ~1071 orphaned)`);
    console.log('═'.repeat(80));
    console.log('');
  } else {
    console.log('═'.repeat(80));
    console.log('[DRY RUN] Complete - no changes made');
    console.log('');
    console.log('To run for real, execute:');
    console.log('  tsx scripts/import-personality/cleanup-migrated-memories.ts');
    console.log('═'.repeat(80));
    console.log('');
  }
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
