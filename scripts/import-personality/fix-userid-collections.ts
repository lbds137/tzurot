#!/usr/bin/env tsx
/**
 * Fix User ID Collections
 *
 * Some collections were incorrectly created with user IDs instead of persona IDs.
 * This happens when old migration code used user.id instead of persona.id.
 *
 * This script:
 * 1. Identifies collections named persona-{userId}
 * 2. Looks up the user's default persona ID
 * 3. Merges memories into the correct persona-{personaId} collection
 * 4. Updates metadata (personaId field)
 * 5. Deletes the incorrect user-ID collection
 */

import { PrismaClient } from '@prisma/client';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config as loadEnv } from 'dotenv';

loadEnv();

const prisma = new PrismaClient();
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});

interface MisnamedCollection {
  userIdCollectionName: string;
  personaIdCollectionName: string;
  userId: string;
  personaId: string;
  username: string;
  userIdPoints: number;
  personaIdPoints: number;
}

async function findMisnamedCollections(): Promise<MisnamedCollection[]> {
  console.log('🔍 Scanning for user-ID collections...\\n');

  // Get all persona collections
  const response = await qdrant.getCollections();
  const personaCollections = response.collections.filter(
    c => c.name.startsWith('persona-') && !c.name.startsWith('persona-legacy-')
  );

  console.log(`Found ${personaCollections.length} persona collections\\n`);

  const misnamed: MisnamedCollection[] = [];

  for (const collection of personaCollections) {
    // Extract the ID from persona-{id}
    const id = collection.name.replace('persona-', '');

    // Check if this ID is a user ID (not a persona ID)
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        defaultPersonaLink: {
          select: { personaId: true },
        },
      },
    });

    if (user?.defaultPersonaLink?.personaId) {
      const personaId = user.defaultPersonaLink.personaId;
      const correctCollectionName = `persona-${personaId}`;

      // Check if the correct collection exists
      let correctCollection;
      try {
        correctCollection = await qdrant.getCollection(correctCollectionName);
      } catch (error) {
        // Correct collection doesn't exist yet - we'll create it during merge
        console.log(
          `⚠️  User ${user.username} has user-ID collection but no persona-ID collection yet`
        );
      }

      const userIdCollection = await qdrant.getCollection(collection.name);

      misnamed.push({
        userIdCollectionName: collection.name,
        personaIdCollectionName: correctCollectionName,
        userId: user.id,
        personaId,
        username: user.username,
        userIdPoints: userIdCollection.points_count,
        personaIdPoints: correctCollection?.points_count || 0,
      });

      console.log(`❌ MISNAMED: ${collection.name}`);
      console.log(`   User: ${user.username} (${user.id})`);
      console.log(`   Correct persona ID: ${personaId}`);
      console.log(`   User-ID collection points: ${userIdCollection.points_count}`);
      console.log(`   Persona-ID collection points: ${correctCollection?.points_count || 0}`);
      console.log(`   Should be: ${correctCollectionName}\\n`);
    }
  }

  return misnamed;
}

async function fixCollection(
  misnamed: MisnamedCollection,
  dryRun: boolean
): Promise<{ moved: number; skipped: number }> {
  console.log(`\\n📦 Fixing ${misnamed.userIdCollectionName}...`);
  console.log(`   Target: ${misnamed.personaIdCollectionName}`);

  let moved = 0;
  let skipped = 0;

  // Get all existing IDs in the target collection to avoid duplicates
  const existingIds = new Set<string>();
  let offset: string | number | null = null;

  try {
    // Check if target collection exists
    await qdrant.getCollection(misnamed.personaIdCollectionName);

    console.log(`   Fetching existing IDs from target collection...`);
    while (true) {
      const response = await qdrant.scroll(misnamed.personaIdCollectionName, {
        limit: 100,
        offset,
        with_payload: false,
        with_vector: false,
      });

      for (const point of response.points) {
        existingIds.add(String(point.id));
      }

      offset = response.next_page_offset;
      if (!offset) {break;}
    }

    console.log(`   Found ${existingIds.size} existing memories in target`);
  } catch (error) {
    console.log(`   Target collection doesn't exist yet (will be created)`);
  }

  // Get all points from user-ID collection
  offset = null;
  const pointsToMove: any[] = [];

  console.log(`   Fetching memories from user-ID collection...`);
  while (true) {
    const response = await qdrant.scroll(misnamed.userIdCollectionName, {
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
    if (!offset) {break;}
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

    // Update metadata: change personaId to correct persona ID
    const transformedBatch = batch.map(point => ({
      id: point.id,
      vector: point.vector,
      payload: {
        ...point.payload,
        personaId: misnamed.personaId,
      },
    }));

    // Ensure target collection exists
    if (i === 0) {
      try {
        await qdrant.getCollection(misnamed.personaIdCollectionName);
      } catch (error) {
        console.log(`   Creating target collection...`);
        await qdrant.createCollection(misnamed.personaIdCollectionName, {
          vectors: {
            size: batch[0].vector.length,
            distance: 'Cosine',
          },
        });

        // Create indexes
        await qdrant.createPayloadIndex(misnamed.personaIdCollectionName, {
          field_name: 'personalityId',
          field_schema: 'keyword',
        });
        await qdrant.createPayloadIndex(misnamed.personaIdCollectionName, {
          field_name: 'createdAt',
          field_schema: 'integer',
        });
        await qdrant.createPayloadIndex(misnamed.personaIdCollectionName, {
          field_name: 'sessionId',
          field_schema: 'keyword',
        });
      }
    }

    // Insert into target collection
    await qdrant.upsert(misnamed.personaIdCollectionName, {
      points: transformedBatch,
    });

    moved += batch.length;
    console.log(
      `   ✅ Moved batch ${Math.floor(i / batchSize) + 1}: ${batch.length} memories (${moved}/${pointsToMove.length})`
    );

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (!dryRun) {
    // Delete the user-ID collection (even if all were duplicates)
    console.log(`   🗑️  Deleting user-ID collection...`);
    await qdrant.deleteCollection(misnamed.userIdCollectionName);
    console.log(`   ✅ Deleted ${misnamed.userIdCollectionName}`);
  }

  return { moved, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('\\n🔧 Fix User-ID Collections');
  console.log('═'.repeat(80));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE FIX'}\\n`);

  // Find misnamed collections
  const misnamed = await findMisnamedCollections();

  if (misnamed.length === 0) {
    console.log('✅ No misnamed collections found!');
    await prisma.$disconnect();
    return;
  }

  console.log('═'.repeat(80));
  console.log(`Found ${misnamed.length} misnamed collections\\n`);

  let totalMoved = 0;
  let totalSkipped = 0;

  for (const collection of misnamed) {
    const { moved, skipped } = await fixCollection(collection, dryRun);
    totalMoved += moved;
    totalSkipped += skipped;
  }

  console.log('\\n═'.repeat(80));
  console.log('📊 Summary:');
  console.log('═'.repeat(80));
  console.log(`  Misnamed collections: ${misnamed.length}`);
  console.log(`  Memories moved: ${totalMoved}`);
  console.log(`  Duplicates skipped: ${totalSkipped}`);
  console.log('═'.repeat(80));

  if (dryRun) {
    console.log('\\n[DRY RUN] No changes made');
    console.log('Run without --dry-run to apply fixes');
  } else {
    console.log('\\n✅ All misnamed collections fixed!');
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
