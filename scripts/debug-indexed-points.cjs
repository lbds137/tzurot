/**
 * Debug: Compare indexed vs unindexed points to find the difference
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');
const fs = require('fs');

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const PERSONALITY_ID = 'c296b337-4e67-5337-99a3-4ca105cbbd68';
const BACKUP_FILE = '/home/deck/WebstormProjects/tzurot/scripts/backup-c296b337-4e67-5337-99a3-4ca105cbbd68-1759639408048.json';

async function debugIndexedPoints() {
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  const collectionName = `personality-${PERSONALITY_ID}`;

  console.log('🔍 Debugging indexed vs unindexed points\n');

  // Get indexed points
  const indexed = await qdrant.scroll(collectionName, {
    limit: 100,
    filter: {
      must: [{
        key: 'createdAt',
        range: { gte: 0 }
      }]
    },
    with_payload: true,
    with_vector: false,
  });

  console.log(`Indexed points: ${indexed.points.length}`);

  // Load backup to compare
  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));

  // Find one indexed and one unindexed point from backup
  const indexedIds = new Set(indexed.points.map(p => p.id));
  const indexedExample = backup.points.find(p => indexedIds.has(p.id));
  const unindexedExample = backup.points.find(p => !indexedIds.has(p.id));

  console.log('\n' + '='.repeat(80));
  console.log('INDEXED POINT EXAMPLE:');
  console.log('='.repeat(80));
  console.log('ID:', indexedExample.id);
  console.log('Payload keys:', Object.keys(indexedExample.payload));
  console.log('createdAt:', indexedExample.payload.createdAt);
  console.log('createdAt type:', typeof indexedExample.payload.createdAt);
  console.log('createdAt value:', JSON.stringify(indexedExample.payload.createdAt));
  console.log('summaryType:', indexedExample.payload.summaryType);

  console.log('\n' + '='.repeat(80));
  console.log('UNINDEXED POINT EXAMPLE:');
  console.log('='.repeat(80));
  console.log('ID:', unindexedExample.id);
  console.log('Payload keys:', Object.keys(unindexedExample.payload));
  console.log('createdAt:', unindexedExample.payload.createdAt);
  console.log('createdAt type:', typeof unindexedExample.payload.createdAt);
  console.log('createdAt value:', JSON.stringify(unindexedExample.payload.createdAt));
  console.log('summaryType:', unindexedExample.payload.summaryType);

  // Check if they're actually different types
  const indexedCreatedAtType = typeof indexedExample.payload.createdAt;
  const unindexedCreatedAtType = typeof unindexedExample.payload.createdAt;

  console.log('\n' + '='.repeat(80));
  console.log('DIFFERENCE ANALYSIS:');
  console.log('='.repeat(80));

  if (indexedCreatedAtType !== unindexedCreatedAtType) {
    console.log(`❌ TYPE MISMATCH!`);
    console.log(`   Indexed: ${indexedCreatedAtType}`);
    console.log(`   Unindexed: ${unindexedCreatedAtType}`);
    console.log('\nThis explains why the integer index only covers some points!');
  } else {
    console.log(`✅ Both are type: ${indexedCreatedAtType}`);

    // Check if there's a precision difference
    const indexedVal = indexedExample.payload.createdAt;
    const unindexedVal = unindexedExample.payload.createdAt;

    console.log('\nIndexed value:', indexedVal);
    console.log('Unindexed value:', unindexedVal);

    // Check if one is an integer and one is a float
    const indexedIsInt = Number.isInteger(indexedVal);
    const unindexedIsInt = Number.isInteger(unindexedVal);

    console.log('\nIndexed is integer:', indexedIsInt);
    console.log('Unindexed is integer:', unindexedIsInt);

    if (indexedIsInt !== unindexedIsInt) {
      console.log('\n❌ PRECISION DIFFERENCE!');
      console.log('   Some points have float timestamps (1756079025944.6565)');
      console.log('   Some points have integer timestamps');
      console.log('   Qdrant integer index might only accept true integers!');
    }
  }
}

debugIndexedPoints()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
