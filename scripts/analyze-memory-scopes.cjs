/**
 * Analyze Memory Scopes
 * Check if old memories are global or personal
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

async function analyzeScopes() {
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  const collectionName = 'personality-c296b337-4e67-5337-99a3-4ca105cbbd68';

  console.log('🔍 Analyzing Memory Scopes\n');

  const scopeCounts = {
    global: 0,
    personal: 0,
    session: 0,
    undefined: 0,
  };

  const userIdStats = {
    withUserId: 0,
    withoutUserId: 0,
  };

  let offset = null;
  let count = 0;

  while (count < 200) {
    const result = await qdrant.scroll(collectionName, {
      limit: 20,
      offset: offset,
      with_payload: true,
      with_vector: false,
    });

    if (result.points.length === 0) break;

    for (const point of result.points) {
      const scope = point.payload?.canonScope;
      const userId = point.payload?.userId;
      const createdAt = point.payload?.createdAt;

      scopeCounts[scope || 'undefined']++;
      if (userId) {
        userIdStats.withUserId++;
      } else {
        userIdStats.withoutUserId++;

        // Show some examples of memories without userId
        if (userIdStats.withoutUserId <= 5) {
          console.log(`Memory without userId #${userIdStats.withoutUserId}:`);
          console.log(`  scope: ${scope || 'undefined'}`);
          console.log(`  createdAt: ${createdAt ? new Date(createdAt).toISOString() : 'MISSING'}`);
          console.log(`  content: ${point.payload?.content?.substring(0, 80)}...`);
          console.log();
        }
      }

      count++;
    }

    offset = result.next_page_offset;
    if (!offset) break;
  }

  console.log(`\n📊 Scope Distribution (from ${count} memories):\n`);
  Object.entries(scopeCounts).forEach(([scope, count]) => {
    console.log(`  ${scope}: ${count}`);
  });

  console.log(`\n📊 User ID Status:\n`);
  console.log(`  With userId: ${userIdStats.withUserId}`);
  console.log(`  Without userId: ${userIdStats.withoutUserId}`);

  if (userIdStats.withoutUserId > 0) {
    console.log(`\n💡 INSIGHT:`);
    console.log(`   ${userIdStats.withoutUserId} memories have NO userId.`);
    console.log(`   These might be:`)
    console.log(`   - Global memories (should be visible to all users)`);
    console.log(`   - Old memories from before userId was implemented`);
    console.log(`\n   If these are global memories, they should be retrieved.`);
    console.log(`   If not, we need to assign them to the correct user.`);
  }
}

analyzeScopes()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
