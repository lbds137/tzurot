#!/usr/bin/env tsx
/**
 * Analyze Lilith Migration Status
 *
 * Compares memories in old personality-scoped collection vs new persona-scoped collection
 * to identify:
 * - Which memories were already migrated (exist in both)
 * - Which memories are orphaned (only in old collection)
 *
 * Usage:
 *   tsx scripts/import-personality/analyze-lilith-migration.ts
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

interface MemoryPoint {
  id: string | number;
  payload: {
    userId?: string;
    personaId?: string;
    personalityId?: string;
    content?: string;
    createdAt?: number;
    timestamp?: number;
  };
}

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
    if (!offset) break;

    // Progress indicator
    if (ids.size % 500 === 0) {
      console.log(`  Fetched ${ids.size} IDs...`);
    }
  }

  console.log(`✅ Found ${ids.size} total points\n`);
  return ids;
}

async function getOrphanedMemories(collectionName: string): Promise<MemoryPoint[]> {
  const orphaned: MemoryPoint[] = [];
  let offset: string | number | null = null;

  console.log(`📦 Fetching orphaned memories from ${collectionName}...`);

  while (true) {
    const response = await qdrant.scroll(collectionName, {
      limit: 100,
      offset,
      with_payload: true,
      with_vector: false,
    });

    for (const point of response.points) {
      orphaned.push({
        id: point.id,
        payload: point.payload || {},
      });
    }

    offset = response.next_page_offset;
    if (!offset) break;
  }

  console.log(`✅ Found ${orphaned.length} memories\n`);
  return orphaned;
}

async function analyzeUserDistribution(memories: MemoryPoint[]): Promise<void> {
  const userCounts = new Map<string, number>();
  const migratedCount = new Map<string, number>();
  const orphanedCount = new Map<string, number>();

  for (const memory of memories) {
    const userId = memory.payload.userId || 'unknown';
    userCounts.set(userId, (userCounts.get(userId) || 0) + 1);
  }

  console.log('👥 User Distribution in Old Collection:');
  console.log('═'.repeat(80));

  const sortedUsers = Array.from(userCounts.entries()).sort((a, b) => b[1] - a[1]);

  for (const [userId, count] of sortedUsers) {
    console.log(`  ${userId}: ${count} memories`);
  }

  console.log('');
}

async function main() {
  console.log('\n🔍 Analyzing Lilith Migration Status');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Get all IDs from both collections
  console.log('Step 1: Fetching point IDs from both collections\n');

  const oldCollectionIds = await getAllPointIds(LILITH_OLD_COLLECTION);
  const newCollectionIds = await getAllPointIds(USER_PERSONA_COLLECTION);

  // Step 2: Identify migrated vs orphaned
  console.log('Step 2: Identifying migrated vs orphaned memories\n');

  const migratedIds = new Set<string>();
  const orphanedIds = new Set<string>();

  for (const id of oldCollectionIds) {
    if (newCollectionIds.has(id)) {
      migratedIds.add(id);
    } else {
      orphanedIds.add(id);
    }
  }

  console.log('📊 Migration Status:');
  console.log('═'.repeat(80));
  console.log(`  Old Collection: ${oldCollectionIds.size} memories`);
  console.log(`  New Collection: ${newCollectionIds.size} memories`);
  console.log(`  Already Migrated: ${migratedIds.size} memories (can be deleted from old)`);
  console.log(`  Orphaned: ${orphanedIds.size} memories (need migration to persona-legacy)`);
  console.log('');

  // Step 3: Analyze orphaned memories by user
  if (orphanedIds.size > 0) {
    console.log('Step 3: Analyzing orphaned memories\n');

    const orphanedMemories: MemoryPoint[] = [];
    let offset: string | number | null = null;

    while (true) {
      const response = await qdrant.scroll(LILITH_OLD_COLLECTION, {
        limit: 100,
        offset,
        with_payload: true,
        with_vector: false,
      });

      for (const point of response.points) {
        if (orphanedIds.has(String(point.id))) {
          orphanedMemories.push({
            id: point.id,
            payload: point.payload || {},
          });
        }
      }

      offset = response.next_page_offset;
      if (!offset) break;
    }

    await analyzeUserDistribution(orphanedMemories);

    // Sample a few orphaned memories
    console.log('📋 Sample Orphaned Memories:');
    console.log('═'.repeat(80));

    const samples = orphanedMemories.slice(0, 3);
    for (let i = 0; i < samples.length; i++) {
      const memory = samples[i];
      console.log(`${i + 1}. ID: ${memory.id}`);
      console.log(`   User ID: ${memory.payload.userId || 'N/A'}`);
      console.log(`   Personality ID: ${memory.payload.personalityId || 'N/A'}`);
      console.log(`   Created: ${memory.payload.createdAt || memory.payload.timestamp || 'N/A'}`);
      const content = (memory.payload.content || '') as string;
      const preview = content.substring(0, 100).replace(/\n/g, ' ');
      console.log(`   Content: ${preview}${content.length > 100 ? '...' : ''}`);
      console.log('');
    }
  }

  // Summary
  console.log('═'.repeat(80));
  console.log('✅ Analysis Complete');
  console.log('');
  console.log('Next Steps:');
  console.log(`  1. Delete ${migratedIds.size} migrated memories from old collection`);
  console.log(`  2. Migrate ${orphanedIds.size} orphaned memories to persona-legacy format`);
  console.log(`  3. Verify old collection is empty`);
  console.log(`  4. Delete old collection`);
  console.log('═'.repeat(80));
  console.log('');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
