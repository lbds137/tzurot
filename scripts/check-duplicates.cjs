/**
 * Check for Duplicate Memories in Qdrant
 *
 * Identifies memories with identical content for the same user
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function checkDuplicates() {
  console.log('🔍 Checking for Duplicate Memories\n');

  try {
    const collections = await qdrant.getCollections();
    const personalityCollections = collections.collections
      .filter(c => c.name.startsWith('personality-'))
      .map(c => c.name);

    let totalDuplicates = 0;
    const duplicatesByUser = new Map();

    for (const collectionName of personalityCollections) {
      console.log(`📦 Collection: ${collectionName}`);

      const collectionInfo = await qdrant.getCollection(collectionName);
      console.log(`   Total points: ${collectionInfo.points_count}\n`);

      // Map to track: userId -> content hash -> [point IDs]
      const userContentMap = new Map();

      let offset = null;
      let processed = 0;

      while (true) {
        const scrollResult = await qdrant.scroll(collectionName, {
          limit: 100,
          offset,
          with_payload: true,
          with_vector: false,
        });

        if (!scrollResult.points || scrollResult.points.length === 0) {
          break;
        }

        for (const point of scrollResult.points) {
          const userId = point.payload?.userId || 'global';
          const content = point.payload?.content;

          if (!content) continue;

          // Create a simple hash of content (first 200 chars for comparison)
          const contentKey = content.substring(0, 200);

          if (!userContentMap.has(userId)) {
            userContentMap.set(userId, new Map());
          }

          const userMap = userContentMap.get(userId);
          if (!userMap.has(contentKey)) {
            userMap.set(contentKey, []);
          }

          userMap.get(contentKey).push({
            id: point.id,
            content: content.substring(0, 150),
            timestamp: point.payload?.createdAt,
          });

          processed++;
        }

        offset = scrollResult.next_page_offset;
        if (!offset) break;
      }

      console.log(`   Processed ${processed} points\n`);

      // Find duplicates
      console.log('   🔎 Analyzing for duplicates...\n');

      for (const [userId, contentMap] of userContentMap.entries()) {
        let userDupes = 0;

        for (const [contentKey, points] of contentMap.entries()) {
          if (points.length > 1) {
            // Found duplicates!
            if (!duplicatesByUser.has(userId)) {
              duplicatesByUser.set(userId, []);
            }

            duplicatesByUser.get(userId).push({
              count: points.length,
              content: contentKey,
              points: points,
            });

            userDupes += points.length - 1; // -1 because one is the original
            totalDuplicates += points.length - 1;
          }
        }

        if (userDupes > 0) {
          let userLabel = userId;
          if (userId === 'e64fcc09-e4db-5902-b1c9-5750141e3bf2') {
            userLabel = 'lbds137';
          } else if (userId === 'fd228688-5fee-58d8-b907-a1800ad43bcd') {
            userLabel = 'nevae63';
          }
          console.log(`   ⚠️  ${userLabel}: ${userDupes} duplicate(s) found`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Duplicate Analysis Results');
    console.log('='.repeat(60));

    if (totalDuplicates === 0) {
      console.log('✅ No duplicates found! Migration was clean.');
    } else {
      console.log(`⚠️  Found ${totalDuplicates} duplicate memories\n`);

      console.log('Top users with duplicates:\n');

      // Sort by number of duplicates
      const sortedUsers = Array.from(duplicatesByUser.entries())
        .map(([userId, dupes]) => ({
          userId,
          totalDupes: dupes.reduce((sum, d) => sum + (d.count - 1), 0),
          instances: dupes,
        }))
        .sort((a, b) => b.totalDupes - a.totalDupes)
        .slice(0, 5); // Top 5

      for (const { userId, totalDupes, instances } of sortedUsers) {
        let userLabel = userId;
        if (userId === 'e64fcc09-e4db-5902-b1c9-5750141e3bf2') {
          userLabel = `${userId} (lbds137)`;
        } else if (userId === 'fd228688-5fee-58d8-b907-a1800ad43bcd') {
          userLabel = `${userId} (nevae63)`;
        }

        console.log(`${userLabel}:`);
        console.log(`  Total duplicates: ${totalDupes}`);
        console.log(`  Example duplicates:`);

        // Show first 2 examples
        instances.slice(0, 2).forEach((dup, idx) => {
          console.log(`    ${idx + 1}. ${dup.count}x copies of: "${dup.content}..."`);
          console.log(`       Point IDs: ${dup.points.map(p => p.id).join(', ')}`);
        });

        console.log('');
      }
    }

    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkDuplicates().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
