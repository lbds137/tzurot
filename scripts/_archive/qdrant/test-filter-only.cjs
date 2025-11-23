require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function test() {
  const collectionName = 'persona-3bd86394-20d8-5992-8201-e621856e9087';
  const userId = 'e64fcc09-e4db-5902-b1c9-5750141e3bf2';
  const personalityId = 'c296b337-4e67-5337-99a3-4ca105cbbd68';

  console.log('Test 1: Scroll with userId filter only');
  const result1 = await qdrant.scroll(collectionName, {
    limit: 3,
    filter: {
      must: [{ key: 'userId', match: { value: userId } }],
    },
    with_payload: true,
    with_vector: false,
  });
  console.log(`  Found ${result1.points.length} points`);

  console.log('\nTest 2: Scroll with userId + personalityId filter');
  const result2 = await qdrant.scroll(collectionName, {
    limit: 3,
    filter: {
      must: [
        { key: 'userId', match: { value: userId } },
        { key: 'personalityId', match: { value: personalityId } },
      ],
    },
    with_payload: true,
    with_vector: false,
  });
  console.log(`  Found ${result2.points.length} points`);

  console.log('\nTest 3: Scroll with should filter (like QdrantMemoryService)');
  const result3 = await qdrant.scroll(collectionName, {
    limit: 3,
    filter: {
      should: [{ is_empty: { key: 'userId' } }, { key: 'userId', match: { value: userId } }],
    },
    with_payload: true,
    with_vector: false,
  });
  console.log(`  Found ${result3.points.length} points`);
}

test().catch(console.error);
