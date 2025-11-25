#!/usr/bin/env tsx
/**
 * Fix Misclassified Legacy Collections
 *
 * Some memories were incorrectly placed in persona-legacy-{userId} collections
 * when the userId is actually a valid current v3 user, not an orphaned shapes.inc UUID.
 *
 * This script:
 * 1. Identifies legacy collections where the UUID is a current v3 user
 * 2. Moves memories to the correct persona-{userId} collection
 * 3. Avoids duplicates by checking existing IDs
 * 4. Deletes the misclassified legacy collection
 */

import { getPrismaClient } from '@tzurot/common-types';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config as loadEnv } from 'dotenv';

loadEnv();

const prisma = getPrismaClient();
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});

interface MisclassifiedCollection {
  legacyName: string;
  correctName: string;
  userId: string;
  username: string;
  pointCount: number;
}

async function findMisclassifiedCollections(): Promise<MisclassifiedCollection[]> {
  console.log('🔍 Scanning for misclassified legacy collections...\n');

  // Get all legacy collections
  const response = await qdrant.getCollections();
  const legacyCollections = response.collections.filter(c => c.name.startsWith('persona-legacy-'));

  console.log(`Found ${legacyCollections.length} legacy collections\n`);

  const misclassified: MisclassifiedCollection[] = [];

  for (const collection of legacyCollections) {
    // Extract the UUID from persona-legacy-{uuid}
    const userId = collection.name.replace('persona-legacy-', '');

    // Check if this UUID is actually a current v3 user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });

    if (user) {
      const collectionInfo = await qdrant.getCollection(collection.name);
      misclassified.push({
        legacyName: collection.name,
        correctName: `persona-${userId}`,
        userId: userId,
        username: user.username,
        pointCount: collectionInfo.points_count,
      });

      console.log(`❌ MISCLASSIFIED: ${collection.name}`);
      console.log(`   User: ${user.username} (${userId})`);
      console.log(`   Points: ${collectionInfo.points_count}`);
      console.log(`   Should be: persona-${userId}\n`);
    }
  }

  return misclassified;
}

async function fixCollection(
  misclassified: MisclassifiedCollection,
  dryRun: boolean
): Promise<{ moved: number; skipped: number }> {
  console.log(`\n📦 Fixing ${misclassified.legacyName}...`);
  console.log(`   Target: ${misclassified.correctName}`);

  let moved = 0;
  let skipped = 0;

  // Get all existing IDs in the target collection to avoid duplicates
  const existingIds = new Set<string>();
  let offset: string | number | null = null;

  try {
    // Check if target collection exists
    await qdrant.getCollection(misclassified.correctName);

    console.log(`   Fetching existing IDs from target collection...`);
    while (true) {
      const response = await qdrant.scroll(misclassified.correctName, {
        limit: 100,
        offset,
        with_payload: false,
        with_vector: false,
      });

      for (const point of response.points) {
        existingIds.add(String(point.id));
      }

      offset = response.next_page_offset;
      if (!offset) {
        break;
      }
    }

    console.log(`   Found ${existingIds.size} existing memories in target`);
  } catch (error) {
    console.log(`   Target collection doesn't exist yet (will be created)`);
  }

  // Get all points from misclassified collection
  offset = null;
  const pointsToMove: any[] = [];

  console.log(`   Fetching memories from legacy collection...`);
  while (true) {
    const response = await qdrant.scroll(misclassified.legacyName, {
      limit: 100,
      offset,
      with_payload: true,
      with_vector: true,
    });

    for (const point of response.points) {
      const pointId = String(point.id);

      if (existingIds.has(pointId)) {
        skipped++;
        console.log(`   ⏭️  Skipping duplicate: ${pointId}`);
      } else {
        pointsToMove.push(point);
      }
    }

    offset = response.next_page_offset;
    if (!offset) {
      break;
    }
  }

  console.log(`   Memories to move: ${pointsToMove.length}`);
  console.log(`   Duplicates skipped: ${skipped}`);

  if (dryRun) {
    console.log(`   [DRY RUN] Would move ${pointsToMove.length} memories`);
    return { moved: pointsToMove.length, skipped };
  }

  // Move points in batches
  const batchSize = 100;
  for (let i = 0; i < pointsToMove.length; i += batchSize) {
    const batch = pointsToMove.slice(i, Math.min(i + batchSize, pointsToMove.length));

    // Update metadata: change personaId and canonScope
    const transformedBatch = batch.map(point => ({
      id: point.id,
      vector: point.vector,
      payload: {
        ...point.payload,
        personaId: misclassified.userId,
        canonScope: 'personal',
      },
    }));

    // Ensure target collection exists
    if (i === 0) {
      try {
        await qdrant.getCollection(misclassified.correctName);
      } catch (error) {
        console.log(`   Creating target collection...`);
        await qdrant.createCollection(misclassified.correctName, {
          vectors: {
            size: batch[0].vector.length,
            distance: 'Cosine',
          },
        });

        // Create indexes
        await qdrant.createPayloadIndex(misclassified.correctName, {
          field_name: 'personalityId',
          field_schema: 'keyword',
        });
        await qdrant.createPayloadIndex(misclassified.correctName, {
          field_name: 'createdAt',
          field_schema: 'integer',
        });
      }
    }

    // Insert into target collection
    await qdrant.upsert(misclassified.correctName, {
      points: transformedBatch,
    });

    moved += batch.length;
    console.log(
      `   ✅ Moved batch ${Math.floor(i / batchSize) + 1}: ${batch.length} memories (${moved}/${pointsToMove.length})`
    );

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (!dryRun && pointsToMove.length > 0) {
    // Delete the misclassified legacy collection
    console.log(`   🗑️  Deleting misclassified legacy collection...`);
    await qdrant.deleteCollection(misclassified.legacyName);
    console.log(`   ✅ Deleted ${misclassified.legacyName}`);
  }

  return { moved, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('\n🔧 Fix Misclassified Legacy Collections');
  console.log('═'.repeat(80));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE FIX'}\n`);

  // Find misclassified collections
  const misclassified = await findMisclassifiedCollections();

  if (misclassified.length === 0) {
    console.log('✅ No misclassified collections found!');
    await prisma.$disconnect();
    return;
  }

  console.log('═'.repeat(80));
  console.log(`Found ${misclassified.length} misclassified collections\n`);

  let totalMoved = 0;
  let totalSkipped = 0;

  for (const collection of misclassified) {
    const { moved, skipped } = await fixCollection(collection, dryRun);
    totalMoved += moved;
    totalSkipped += skipped;
  }

  console.log('\n═'.repeat(80));
  console.log('📊 Summary:');
  console.log('═'.repeat(80));
  console.log(`  Misclassified collections: ${misclassified.length}`);
  console.log(`  Memories moved: ${totalMoved}`);
  console.log(`  Duplicates skipped: ${totalSkipped}`);
  console.log('═'.repeat(80));

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made');
    console.log('Run without --dry-run to apply fixes');
  } else {
    console.log('\n✅ All misclassified collections fixed!');
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
