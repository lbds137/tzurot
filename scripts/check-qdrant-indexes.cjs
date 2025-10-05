/**
 * Check if Qdrant indexes exist and work
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const PERSONALITY_ID = 'c296b337-4e67-5337-99a3-4ca105cbbd68';

async function checkIndexes() {
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  const collectionName = `personality-${PERSONALITY_ID}`;

  console.log('🔍 Checking Qdrant collection and indexes\n');

  // Get collection info
  const collection = await qdrant.getCollection(collectionName);
  console.log('Collection info:');
  console.log('  Name:', collection.name);
  console.log('  Points count:', collection.points_count);
  console.log('  Indexed payload fields:', JSON.stringify(collection.payload_schema, null, 2));

  console.log('\n='.repeat(80));
  console.log('Testing createdAt index with range filter');
  console.log('='.repeat(80));

  // Test createdAt index with the Aug 24 memory
  const aug24Start = new Date('2025-08-24').getTime();
  const aug24End = new Date('2025-08-25').getTime();

  console.log('\nSearching for Aug 24 memories using createdAt range filter:');
  console.log(`  Range: ${aug24Start} to ${aug24End}`);
  console.log(`  Range ISO: ${new Date(aug24Start).toISOString()} to ${new Date(aug24End).toISOString()}`);

  const result = await qdrant.scroll(collectionName, {
    limit: 10,
    filter: {
      must: [
        {
          key: 'createdAt',
          range: {
            gte: aug24Start,
            lt: aug24End,
          }
        }
      ]
    },
    with_payload: ['createdAt', 'summaryType'],
    with_vector: false,
  });

  console.log(`\n  Found: ${result.points.length} memories`);
  result.points.forEach(point => {
    console.log(`    - createdAt: ${new Date(point.payload.createdAt).toISOString()} (summaryType: ${point.payload.summaryType})`);
  });

  if (result.points.length === 0) {
    console.log('\n  ❌ NO RESULTS - Index might not be working!');
    console.log('     The Aug 24 memory exists (we found it earlier) but range filter returned nothing.');
    console.log('     This suggests the createdAt index is not functioning correctly.');
  } else {
    console.log('\n  ✅ Index is working!');
  }
}

checkIndexes()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
