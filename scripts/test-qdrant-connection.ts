#!/usr/bin/env tsx
/**
 * Test Qdrant connectivity to diagnose where migration is failing
 */

import { QdrantClient } from '@qdrant/js-client-rest';

const CLOUD_URL = 'https://01b8a4c0-61e2-412c-980c-709e41b1ce3e.us-east-1-1.aws.cloud.qdrant.io:6333';
const CLOUD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.ikmX5o0M6d6T5ZCIAViooAwRBYJRMN44-da13B8ra4A';
const RAILWAY_URL = process.env.DEV_QDRANT_URL || 'http://mainline.proxy.rlwy.net:44916';
const TEST_COLLECTION = 'persona-legacy-923aee71-c4cd-4042-a574-8bf43c22a87a';

async function main() {
  console.log('Testing Qdrant connectivity...\n');

  // Test 1: Connect to cloud
  console.log('1. Connecting to qdrant.io cloud...');
  const cloudClient = new QdrantClient({
    url: CLOUD_URL,
    apiKey: CLOUD_KEY,
    timeout: 60000,
  });

  try {
    console.log('   Getting collection info...');
    const cloudInfo = await cloudClient.getCollection(TEST_COLLECTION);
    console.log(`   ✅ Cloud connected! Points: ${cloudInfo.points_count}`);
  } catch (error) {
    console.error(`   ❌ Cloud failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Test 2: Connect to Railway
  console.log('\n2. Connecting to Railway Qdrant...');
  const railwayClient = new QdrantClient({
    url: RAILWAY_URL,
    timeout: 60000,
  });

  try {
    console.log('   Listing collections...');
    const collections = await railwayClient.getCollections();
    console.log(`   ✅ Railway connected! Collections: ${collections.collections.length}`);
  } catch (error) {
    console.error(`   ❌ Railway failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Test 3: Check if collection exists on Railway
  console.log('\n3. Checking if test collection exists on Railway...');
  try {
    const railwayInfo = await railwayClient.getCollection(TEST_COLLECTION);
    console.log(`   ✅ Collection exists! Points: ${railwayInfo.points_count}`);

    // Test 4: Try to delete it
    console.log('\n4. Trying to delete collection...');
    await railwayClient.deleteCollection(TEST_COLLECTION);
    console.log('   ✅ Collection deleted!');
  } catch (error) {
    console.log(`   Collection doesn't exist (expected): ${error instanceof Error ? error.message : String(error)}`);
  }

  // Test 5: Get source collection config
  console.log('\n5. Getting source collection config...');
  try {
    const sourceConfig = await cloudClient.getCollection(TEST_COLLECTION);
    console.log('   ✅ Got source config!');
    console.log(`   Vector config:`, JSON.stringify(sourceConfig.config.params.vectors, null, 2));
  } catch (error) {
    console.error(`   ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Test 6: Create collection on Railway
  console.log('\n6. Creating collection on Railway...');
  try {
    const sourceConfig = await cloudClient.getCollection(TEST_COLLECTION);
    await railwayClient.createCollection(TEST_COLLECTION, {
      vectors: sourceConfig.config.params.vectors,
      hnsw_config: {
        on_disk: false,
      },
    });
    console.log('   ✅ Collection created!');
  } catch (error) {
    console.error(`   ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Test 7: Try a small scroll from cloud
  console.log('\n7. Testing scroll from cloud (limit 1)...');
  try {
    const response = await cloudClient.scroll(TEST_COLLECTION, {
      limit: 1,
      with_payload: true,
      with_vector: true,
    });
    console.log(`   ✅ Scroll worked! Points: ${response.points?.length || 0}`);
  } catch (error) {
    console.error(`   ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log('\n✅ All tests passed!');
}

main().catch(console.error);
