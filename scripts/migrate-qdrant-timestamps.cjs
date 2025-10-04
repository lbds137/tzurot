/**
 * Migrate Qdrant timestamps from seconds to milliseconds
 *
 * This fixes timestamps from shapes.inc import that were stored in seconds.
 * Converts them to milliseconds for consistency with new memories.
 *
 * Usage:
 *   node scripts/migrate-qdrant-timestamps.cjs [personality-id] [--dry-run]
 */

const { QdrantClient } = require('@qdrant/js-client-rest');

const LILITH_ID = '1fed013b-053a-4bc8-bc09-7da5c44297d6';
const SECONDS_THRESHOLD = 10000000000; // Timestamps below this are seconds, above are milliseconds

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const personalityId = args.find(arg => !arg.startsWith('--')) || LILITH_ID;
  const collectionName = `personality-${personalityId}`;

  console.log(`\n🔧 Migrating timestamps in: ${collectionName}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will update)'}\n`);

  // Initialize Qdrant client
  const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
  });

  try {
    // Check collection exists
    const collection = await qdrant.getCollection(collectionName);
    console.log(`✅ Collection found (${collection.points_count} points)\n`);

    // Scroll through all points
    console.log('📊 Analyzing timestamps...\n');

    let offset = null;
    let totalProcessed = 0;
    let needsUpdate = 0;
    let alreadyCorrect = 0;
    const batchUpdates = [];

    while (true) {
      const batch = await qdrant.scroll(collectionName, {
        limit: 100,
        offset: offset,
        with_payload: true,
        with_vector: false,
      });

      for (const point of batch.points) {
        totalProcessed++;
        const createdAt = point.payload?.createdAt;

        if (!createdAt) {
          console.log(`⚠️  Point ${point.id} has no createdAt timestamp`);
          continue;
        }

        // Check if timestamp is in seconds (needs conversion)
        if (createdAt < SECONDS_THRESHOLD) {
          needsUpdate++;
          const oldDate = new Date(createdAt * 1000);
          const newTimestamp = createdAt * 1000;

          if (needsUpdate <= 5) {
            console.log(`🔄 Will convert: ${point.id}`);
            console.log(`   Old: ${createdAt} (seconds) = ${oldDate.toISOString()}`);
            console.log(`   New: ${newTimestamp} (milliseconds)`);
          }

          batchUpdates.push({
            id: point.id,
            payload: {
              ...point.payload,
              createdAt: newTimestamp
            }
          });

        } else {
          alreadyCorrect++;
        }
      }

      if (batch.next_page_offset === null || batch.next_page_offset === undefined) {
        break;
      }
      offset = batch.next_page_offset;
    }

    console.log(`\n📈 Analysis complete:`);
    console.log(`   Total processed: ${totalProcessed}`);
    console.log(`   Already milliseconds: ${alreadyCorrect}`);
    console.log(`   Need conversion: ${needsUpdate}\n`);

    if (needsUpdate === 0) {
      console.log('✅ All timestamps already in milliseconds format!\n');
      return;
    }

    if (dryRun) {
      console.log('🔍 DRY RUN - No changes made');
      console.log('   Run without --dry-run to apply changes\n');
      return;
    }

    // Apply updates one by one (Qdrant doesn't support batch payload updates with different values)
    console.log(`🚀 Updating ${needsUpdate} points...`);
    let updated = 0;

    for (const update of batchUpdates) {
      try {
        // Update just the createdAt field for this point
        await qdrant.setPayload(collectionName, {
          wait: false, // Don't wait for each individual update
          points: [update.id],
          payload: {
            createdAt: update.payload.createdAt
          }
        });

        updated++;
        if (updated % 100 === 0) {
          console.log(`   Updated ${updated}/${needsUpdate}...`);
        }
      } catch (error) {
        console.error(`   ❌ Failed to update ${update.id}:`, error.message);
      }
    }

    console.log(`\n✅ Migration complete! Updated ${updated}/${needsUpdate} points\n`);

  } catch (error) {
    if (error.status === 404) {
      console.error(`❌ Collection not found: ${collectionName}\n`);
    } else {
      console.error(`❌ Error:`, error.message);
      console.error(error);
    }
    process.exit(1);
  }
}

main().catch(console.error);
