/**
 * Check Qdrant collection status to see if indexing is in progress
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const PERSONALITY_ID = 'c296b337-4e67-5337-99a3-4ca105cbbd68';

async function checkCollectionStatus() {
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  const collectionName = `personality-${PERSONALITY_ID}`;

  console.log('🔍 Checking collection status for ongoing indexing operations\n');

  const collection = await qdrant.getCollection(collectionName);

  console.log('='.repeat(80));
  console.log('COLLECTION STATUS:');
  console.log('='.repeat(80));
  console.log('Name:', collection.name);
  console.log('Status:', collection.status);
  console.log('Optimizer Status:', collection.optimizer_status);
  console.log('\nPoints:');
  console.log('  Total:', collection.points_count);
  console.log('  Indexed vectors:', collection.indexed_vectors_count);

  console.log('\nPayload Schema (indexes):');
  if (collection.payload_schema) {
    Object.entries(collection.payload_schema).forEach(([field, schema]) => {
      console.log(`  ${field}:`);
      console.log(`    Type: ${schema.data_type}`);
      console.log(`    Indexed points: ${schema.points || 0}`);
      const percentage = (((schema.points || 0) / collection.points_count) * 100).toFixed(1);
      console.log(`    Coverage: ${percentage}%`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS:');
  console.log('='.repeat(80));

  if (collection.status !== 'green') {
    console.log(`⚠️  Collection status is "${collection.status}" (not "green")`);
    console.log('   This may indicate ongoing operations or issues.');
  } else {
    console.log(`✅ Collection status is "green"`);
  }

  if (collection.optimizer_status !== 'ok') {
    console.log(`⚠️  Optimizer status is "${collection.optimizer_status}" (not "ok")`);
    console.log('   This may indicate ongoing optimization/indexing.');
  } else {
    console.log(`✅ Optimizer status is "ok"`);
  }

  const createdAtPoints = collection.payload_schema?.createdAt?.points || 0;
  const userIdPoints = collection.payload_schema?.userId?.points || 0;

  if (createdAtPoints < collection.points_count) {
    console.log(`\n❌ createdAt index is INCOMPLETE:`);
    console.log(`   Indexed: ${createdAtPoints} / ${collection.points_count} points`);
    console.log(`   Missing: ${collection.points_count - createdAtPoints} points`);

    if (collection.status === 'green' && collection.optimizer_status === 'ok') {
      console.log('\n   🤔 But status shows "green" and optimizer "ok"...');
      console.log('   This suggests the index is NOT currently building.');
      console.log('   The index may have failed or been interrupted during creation.');
    }
  }

  if (userIdPoints === collection.points_count) {
    console.log(
      `\n✅ userId index is COMPLETE: ${userIdPoints} / ${collection.points_count} points`
    );
  }

  // Show full collection object for debugging
  console.log('\n' + '='.repeat(80));
  console.log('FULL COLLECTION INFO:');
  console.log('='.repeat(80));
  console.log(JSON.stringify(collection, null, 2));
}

checkCollectionStatus()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Failed:', error);
    process.exit(1);
  });
