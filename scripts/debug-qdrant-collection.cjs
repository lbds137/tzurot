#!/usr/bin/env node
/**
 * Debug Qdrant Collection Status
 *
 * Checks if a Qdrant collection exists and shows its contents.
 * Useful for debugging memory retrieval issues.
 */

require('dotenv').config();
const { createQdrantClient } = require('./lib/qdrant.cjs');

async function debugCollection(collectionName) {
  const client = createQdrantClient();

  console.log(`\n🔍 Checking collection: ${collectionName}\n`);

  try {
    // Get collection info
    const collection = await client.getCollection(collectionName);
    console.log('✓ Collection exists!');
    console.log(`  - Points count: ${collection.points_count}`);
    console.log(`  - Vector size: ${collection.config.params.vectors.size}`);
    console.log(`  - Distance: ${collection.config.params.vectors.distance}`);

    if (collection.points_count > 0) {
      // Retrieve a sample point to verify structure
      console.log('\n📋 Sample point:');
      const sample = await client.scroll(collectionName, {
        limit: 1,
        with_payload: true,
        with_vector: false,
      });

      if (sample.points && sample.points.length > 0) {
        const point = sample.points[0];
        console.log(`  - ID: ${point.id}`);
        console.log(`  - Payload keys: ${Object.keys(point.payload || {}).join(', ')}`);
        console.log(`  - Sample payload:`, JSON.stringify(point.payload, null, 2));
      }

      // Try a simple search to verify queries work
      console.log('\n🔎 Testing search capability...');
      const { OpenAI } = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'test query',
      });

      const queryVector = response.data[0].embedding;
      const results = await client.search(collectionName, {
        vector: queryVector,
        limit: 3,
        with_payload: true,
      });

      console.log(`✓ Search returned ${results.length} results`);
      if (results.length > 0) {
        console.log(`  - Top result score: ${results[0].score}`);
        console.log(`  - Top result content: ${results[0].payload?.content?.substring(0, 100)}...`);
      }
    } else {
      console.log('\n⚠ Collection is empty (no points)');
    }

  } catch (error) {
    if (error.status === 404) {
      console.log('❌ Collection not found!');
      console.log('\nTrying to list all collections...');

      try {
        const collections = await client.getCollections();
        console.log(`\n📚 Available collections (${collections.collections.length}):`);
        collections.collections.forEach(c => {
          console.log(`  - ${c.name}`);
        });
      } catch (listError) {
        console.error('Failed to list collections:', listError.message);
      }
    } else {
      console.error('❌ Error:', error.message);
      throw error;
    }
  }
}

async function main() {
  const personalityId = process.argv[2] || '1fed013b-053a-4bc8-bc09-7da5c44297d6';
  const collectionName = `personality-${personalityId}`;

  await debugCollection(collectionName);
}

main()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
