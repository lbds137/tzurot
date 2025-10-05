/**
 * Count Total Memories in Qdrant
 *
 * Shows actual memory counts per user after migration
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function countMemories() {
  console.log('📊 Counting Total Memories in Qdrant\n');

  try {
    // Get all collections
    const collections = await qdrant.getCollections();
    const personalityCollections = collections.collections
      .filter(c => c.name.startsWith('personality-'))
      .map(c => c.name);

    console.log(`Found ${personalityCollections.length} personality collection(s)\n`);

    const userCounts = new Map();
    let totalPoints = 0;
    let globalPoints = 0;

    for (const collectionName of personalityCollections) {
      console.log(`📦 Collection: ${collectionName}`);

      const collectionInfo = await qdrant.getCollection(collectionName);
      const pointCount = collectionInfo.points_count;
      totalPoints += pointCount;

      console.log(`   Total points: ${pointCount}`);

      // Scroll through all points
      let offset = null;

      while (true) {
        const scrollResult = await qdrant.scroll(collectionName, {
          limit: 100,
          offset,
          with_payload: true,
          with_vector: false, // Don't need vectors for counting
        });

        if (!scrollResult.points || scrollResult.points.length === 0) {
          break;
        }

        for (const point of scrollResult.points) {
          const userId = point.payload?.userId;

          if (!userId) {
            globalPoints++;
          } else {
            const count = userCounts.get(userId) || 0;
            userCounts.set(userId, count + 1);
          }
        }

        offset = scrollResult.next_page_offset;
        if (!offset) break;
      }

      console.log(`   ✅ Counted\n`);
    }

    // Print results
    console.log('='.repeat(60));
    console.log('📊 Total Memory Counts');
    console.log('='.repeat(60));
    console.log(`Total points in Qdrant:    ${totalPoints}`);
    console.log(`Global memories (no user): ${globalPoints}`);
    console.log(`User-specific memories:    ${totalPoints - globalPoints}\n`);

    if (userCounts.size > 0) {
      console.log('📋 Memories per User (sorted by count):');

      const sortedUsers = Array.from(userCounts.entries())
        .sort((a, b) => b[1] - a[1]);

      // Show top users
      sortedUsers.forEach(([userId, count]) => {
        // Highlight known users
        let label = userId;
        if (userId === 'e64fcc09-e4db-5902-b1c9-5750141e3bf2') {
          label = `${userId} (lbds137)`;
        } else if (userId === 'fd228688-5fee-58d8-b907-a1800ad43bcd') {
          label = `${userId} (nevae63)`;
        }
        console.log(`  ${label}: ${count}`);
      });

      console.log(`\nTotal unique users: ${userCounts.size}`);
    }

    console.log('\n' + '='.repeat(60));

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

countMemories().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
