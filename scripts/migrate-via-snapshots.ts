#!/usr/bin/env tsx
/**
 * Migrate remaining collections from Qdrant Cloud to Railway using snapshots
 *
 * This bypasses all TCP proxy networking issues by using Qdrant's native snapshot mechanism.
 * Snapshots are the fastest and most reliable way to migrate entire collections.
 *
 * Usage:
 *   tsx scripts/migrate-via-snapshots.ts
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import * as fs from 'fs';
import * as path from 'path';

const CLOUD_URL = 'https://01b8a4c0-61e2-412c-980c-709e41b1ce3e.us-east-1-1.aws.cloud.qdrant.io:6333';
const CLOUD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.ikmX5o0M6d6T5ZCIAViooAwRBYJRMN44-da13B8ra4A';
const RAILWAY_URL = process.env.DEV_QDRANT_URL || 'http://mainline.proxy.rlwy.net:44916';

// The 36 collections that failed to sync
const COLLECTIONS_TO_MIGRATE = [
  'persona-legacy-923aee71-c4cd-4042-a574-8bf43c22a87a',
  'persona-legacy-fcf112f6-85d9-4188-935f-d834f5bc2bf2',
  'persona-legacy-3bb6549d-ba87-4fbf-8934-2d96d0e2ca8b',
  'persona-legacy-95b8b9e7-9288-431e-bba8-a248fc41bb7b',
  'persona-legacy-6fb0f4bd-bbca-4127-9490-8d0c22891e41',
  'persona-legacy-a8a564a6-327d-4903-bb1b-4b0ed5e87365',
  'persona-legacy-5d25ad6d-6111-4786-bfd3-37959b5e01e5',
  'persona-legacy-ed45b25a-1fd7-4509-a050-53ae310a0c9d',
  'persona-legacy-bf5adfc5-8438-4b39-a973-681b89f4a8c5',
  'persona-legacy-a113afbe-1bd4-4709-8ed6-736d3ed20d8c',
  'persona-legacy-5cb86a16-c716-412a-9c62-d55c160d3191',
  'persona-legacy-f31c87c8-ab89-43e3-b3d1-a562e6e273dc',
  'persona-legacy-c7f6c212-0632-43c9-abbe-0ccb821e11d1',
  'persona-7db1dd4e-0e24-55b8-8578-f2b5cac26db8',
  'persona-legacy-c68c2de2-2240-4391-90cf-0cc89a278a35',
  'persona-legacy-9bafe4bb-fdb9-4206-a40e-44d5363e023a',
  'persona-legacy-1aada578-c4a6-4156-a420-135f3881f005',
  'persona-legacy-08934701-3fe6-4eee-853c-a53b4c901196',
  'persona-legacy-00cc1c0a-c45e-4103-bbd3-ab7b7530d7de',
  'persona-legacy-1cb610a2-b416-4bef-9f57-f5f0fa3dfc6e',
  'persona-legacy-768a2387-b390-4c0a-82ac-fa17ad8ca099',
  'persona-legacy-896d32ce-3c31-4677-b815-36140f06fc3a',
  'persona-legacy-ce22b8f7-67c2-4cc1-9d4e-e72c2936754e',
  'persona-legacy-5baa7953-5a23-452c-b84b-1f9da301a402',
  'persona-legacy-c48973ac-268c-4286-99a4-0cfbfff500b5',
  'persona-legacy-950a527d-7fc0-4762-8fb3-34a8f30a9b66',
  'persona-legacy-6c795325-67a7-411d-855a-4489291a0dab',
  'persona-legacy-d1301774-70b0-4cc1-a64e-05f9d82c42d9',
  'persona-legacy-3b7601be-2e85-41a3-9b71-dc8e7a3c8a86',
  'persona-legacy-ff03937b-1a64-4fe9-8b06-fb29ba66968f',
  'persona-legacy-b37c5743-6a0f-4c7a-bb12-64abb50355e1',
  'persona-legacy-fdd437fd-9ec3-420f-8a49-35016d25c469',
  'persona-legacy-86d45f3d-d97e-40c0-a969-344cc6d1b9e0',
  'persona-legacy-10376d52-ca1c-405e-b9ee-dd8718000a06',
  'persona-legacy-7171a917-5172-474e-9048-7e3937220ae1',
  'persona-legacy-a6978370-0286-4b4c-86e3-fcd69fb1e644',
];

const SNAPSHOT_DIR = '/tmp/qdrant-snapshots';

async function main() {
  console.log('===========================================');
  console.log('Qdrant Snapshot Migration');
  console.log('Collections to migrate:', COLLECTIONS_TO_MIGRATE.length);
  console.log('===========================================\n');

  // Create snapshot directory
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  const cloudClient = new QdrantClient({
    url: CLOUD_URL,
    apiKey: CLOUD_KEY,
    timeout: 60000,
  });

  const railwayClient = new QdrantClient({
    url: RAILWAY_URL,
    timeout: 300000, // 5 minutes for snapshot restore
  });

  let successCount = 0;
  let failCount = 0;

  for (const collection of COLLECTIONS_TO_MIGRATE) {
    console.log(`\n📦 Processing: ${collection}`);

    try {
      // Use robust scroll + upsert with retry logic
      // This is more reliable than snapshots for cross-cloud migration
      console.log('  Using scroll + upsert with retry logic...');
      await robustMigrate(cloudClient, railwayClient, collection);

      console.log(`  ✅ Migration complete`);
      successCount++;

    } catch (error) {
      console.error(`  ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }
  }

  console.log('\n===========================================');
  console.log('Migration Summary:');
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log('===========================================');
}

/**
 * Robust migration using scroll + upsert with retry logic
 * This is Gemini's recommended approach when snapshots aren't accessible
 */
async function robustMigrate(
  sourceClient: QdrantClient,
  destClient: QdrantClient,
  collectionName: string
) {
  const BATCH_SIZE = 100;
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 5000; // 5 seconds

  async function retryWrapper<T>(fn: () => Promise<T>, operation: string): Promise<T> {
    let attempts = 0;
    while (attempts < MAX_RETRIES) {
      try {
        return await fn();
      } catch (error) {
        attempts++;
        if (attempts >= MAX_RETRIES) {
          throw new Error(`Failed after ${MAX_RETRIES} attempts: ${operation}`);
        }
        console.log(`    ⚠️  ${operation} failed (attempt ${attempts}/${MAX_RETRIES}), retrying in 5s...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
    throw new Error('Unreachable');
  }

  // Get source collection config from cloud (this works fine)
  console.log('    Getting source collection config...');
  const sourceConfig = await retryWrapper(
    () => sourceClient.getCollection(collectionName),
    'Get collection config'
  );
  console.log('    ✅ Got source config');

  // Try to create collection - if it exists, catch error and skip to migration
  console.log('    Creating collection on destination...');
  try {
    await destClient.createCollection(collectionName, {
      vectors: sourceConfig.config.params.vectors,
      hnsw_config: {
        on_disk: false, // Use RAM for better performance (Gemini's recommendation)
      },
    });
    console.log('    ✅ Collection created (was empty or didn\'t exist)');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('already exists') || errorMsg.includes('conflict')) {
      console.log('    ⚠️  Collection already exists, will migrate points anyway');
    } else {
      console.error(`    ❌ Unexpected create error: ${errorMsg}`);
      throw error;
    }
  }

  // Scroll and upsert in batches
  let offset: string | number | null = null;
  let totalMigrated = 0;

  while (true) {
    const response = await retryWrapper(
      () => sourceClient.scroll(collectionName, {
        limit: BATCH_SIZE,
        offset: offset as any,
        with_payload: true,
        with_vector: true,
      }),
      `Scroll batch (offset: ${offset})`
    );

    if (!response.points || response.points.length === 0) {
      break;
    }

    await retryWrapper(
      () => destClient.upsert(collectionName, {
        points: response.points as any,
        wait: true,
      }),
      `Upsert ${response.points.length} points`
    );

    totalMigrated += response.points.length;
    console.log(`    Migrated ${totalMigrated} points...`);

    if (!response.next_page_offset) {
      break;
    }

    offset = response.next_page_offset;
  }

  console.log(`    ✅ Total migrated: ${totalMigrated} points`);
}

main().catch(console.error);
