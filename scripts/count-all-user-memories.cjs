/**
 * Count ALL memories by userId
 * Full scan of the collection
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

async function countAllMemories() {
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  const collectionName = 'personality-c296b337-4e67-5337-99a3-4ca105cbbd68';

  console.log('🔍 Counting ALL memories by userId...\n');

  const userIdCounts = {};
  const noUserIdCount = { count: 0 };

  let offset = null;
  let totalProcessed = 0;

  while (true) {
    const result = await qdrant.scroll(collectionName, {
      limit: 100,
      offset: offset,
      with_payload: ['userId'],
      with_vector: false,
    });

    if (result.points.length === 0) break;

    for (const point of result.points) {
      const userId = point.payload?.userId;

      if (userId) {
        userIdCounts[userId] = (userIdCounts[userId] || 0) + 1;
      } else {
        noUserIdCount.count++;
      }

      totalProcessed++;
    }

    console.log(`Processed ${totalProcessed} memories...`);

    offset = result.next_page_offset;
    if (!offset) break;
  }

  console.log(`\n✅ Processed ${totalProcessed} total memories\n`);
  console.log(`📊 Memory Distribution:\n`);

  // Sort by count
  const sorted = Object.entries(userIdCounts).sort((a, b) => b[1] - a[1]);

  // lbds137's UUID
  const LBDS137_UUID = 'e64fcc09-e4db-5902-b1c9-5750141e3bf2';

  sorted.forEach(([userId, count]) => {
    const isLbds137 = userId === LBDS137_UUID;
    const marker = isLbds137 ? '👤 YOU' : '   ';
    console.log(`${marker} ${userId}: ${count} memories`);
  });

  if (noUserIdCount.count > 0) {
    console.log(`\n⚠️  NO userId: ${noUserIdCount.count} memories`);
    console.log(`    These memories have no userId field at all.`);
  }

  const yourCount = userIdCounts[LBDS137_UUID] || 0;
  console.log(`\n📈 Summary:`);
  console.log(`   Total memories: ${totalProcessed}`);
  console.log(`   Your memories: ${yourCount}`);
  console.log(`   Other users: ${totalProcessed - yourCount - noUserIdCount.count}`);
  console.log(`   No userId: ${noUserIdCount.count}`);
}

countAllMemories()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
