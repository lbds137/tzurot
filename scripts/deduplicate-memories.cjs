/**
 * Deduplicate Memories in Qdrant
 *
 * Removes duplicate memories (same content + userId), keeping the oldest one
 *
 * Usage:
 *   # Dry run (preview):
 *   node scripts/deduplicate-memories.cjs --dry-run
 *
 *   # Actually deduplicate:
 *   node scripts/deduplicate-memories.cjs
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');

const isDryRun = process.argv.includes('--dry-run');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const stats = {
  totalPoints: 0,
  duplicatesFound: 0,
  duplicatesDeleted: 0,
  pointsKept: 0,
  errors: [],
};

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function deduplicateCollection(collectionName) {
  console.log(`\n📦 Processing collection: ${collectionName}`);

  try {
    const collectionInfo = await qdrant.getCollection(collectionName);
    console.log(`   Total points: ${collectionInfo.points_count}\n`);

    // Map: userId -> content hash -> [points]
    const userContentMap = new Map();

    // Scroll through all points
    let offset = null;

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
        stats.totalPoints++;
        const userId = point.payload?.userId || 'global';
        const content = point.payload?.content;
        const createdAt = point.payload?.createdAt || 0;

        if (!content) continue;

        // Use FULL content for comparison to avoid false positives
        // (not just first 200 chars - that could match different conversations)
        const contentKey = content;

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
          createdAt,
          payload: point.payload,
        });
      }

      offset = scrollResult.next_page_offset;
      if (!offset) break;
    }

    console.log(`   ✅ Scanned ${stats.totalPoints} points\n`);
    console.log('   🔍 Finding duplicates...\n');

    // Find and remove duplicates
    const pointsToDelete = [];

    for (const [userId, contentMap] of userContentMap.entries()) {
      for (const [contentKey, points] of contentMap.entries()) {
        if (points.length > 1) {
          // Sort by createdAt (oldest first)
          points.sort((a, b) => a.createdAt - b.createdAt);

          const keepPoint = points[0];
          const deletePoints = points.slice(1);

          stats.duplicatesFound += points.length - 1;
          stats.pointsKept++;

          let userLabel = userId;
          if (userId === 'e64fcc09-e4db-5902-b1c9-5750141e3bf2') {
            userLabel = 'lbds137';
          } else if (userId === 'fd228688-5fee-58d8-b907-a1800ad43bcd') {
            userLabel = 'nevae63';
          }

          console.log(`   📝 ${userLabel}: Found ${points.length}x copies`);
          console.log(`      Content: "${contentKey}..."`);
          console.log(`      Keeping: ${keepPoint.id} (created: ${new Date(keepPoint.createdAt).toISOString()})`);
          console.log(`      Deleting: ${deletePoints.length} duplicate(s)`);

          // Add to deletion list
          deletePoints.forEach(p => {
            pointsToDelete.push(p.id);
            console.log(`        - ${p.id}`);
          });

          console.log('');
        }
      }
    }

    // Delete duplicates in batches
    if (!isDryRun && pointsToDelete.length > 0) {
      console.log(`   🗑️  Deleting ${pointsToDelete.length} duplicates...\n`);

      const batchSize = 100;
      for (let i = 0; i < pointsToDelete.length; i += batchSize) {
        const batch = pointsToDelete.slice(i, i + batchSize);

        try {
          await qdrant.delete(collectionName, {
            wait: true,
            points: batch,
          });

          stats.duplicatesDeleted += batch.length;
          console.log(`   ✅ Deleted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} points`);

          // Rate limiting delay
          await sleep(200);
        } catch (error) {
          console.error(`   ❌ Failed to delete batch:`, error.message);
          stats.errors.push({
            collection: collectionName,
            batch: i / batchSize,
            error: error.message,
          });
        }
      }
    }

    console.log(`\n   ✅ Collection processed: ${pointsToDelete.length} duplicates ${isDryRun ? 'found' : 'deleted'}`);

  } catch (error) {
    console.error(`❌ Error processing collection ${collectionName}:`, error.message);
    stats.errors.push({
      collection: collectionName,
      error: error.message,
    });
  }
}

async function deduplicate() {
  console.log('🧹 Qdrant Memory Deduplication\n');

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  try {
    const collections = await qdrant.getCollections();
    const personalityCollections = collections.collections
      .filter(c => c.name.startsWith('personality-'))
      .map(c => c.name);

    console.log(`Found ${personalityCollections.length} personality collection(s)\n`);

    for (const collectionName of personalityCollections) {
      await deduplicateCollection(collectionName);
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Deduplication Summary');
    console.log('='.repeat(60));
    console.log(`Total points scanned:      ${stats.totalPoints}`);
    console.log(`Unique points kept:        ${stats.pointsKept}`);
    console.log(`Duplicates found:          ${stats.duplicatesFound}`);

    if (!isDryRun) {
      console.log(`Duplicates deleted:        ${stats.duplicatesDeleted}`);
    }

    if (stats.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      stats.errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. Collection: ${err.collection}`);
        console.log(`     Error: ${err.error}`);
      });
    }

    console.log('\n' + '='.repeat(60));

    if (isDryRun) {
      console.log('\n✅ Dry run completed!');
      console.log('   Run without --dry-run to delete duplicates.');
    } else {
      console.log('\n✅ Deduplication completed!');
      console.log(`   Removed ${stats.duplicatesDeleted} duplicate memories.`);
    }

  } catch (error) {
    console.error('\n❌ Deduplication failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

deduplicate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
