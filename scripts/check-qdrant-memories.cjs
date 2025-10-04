/**
 * Check Qdrant memories for a personality
 *
 * Usage:
 *   node scripts/check-qdrant-memories.cjs [personality-id]
 *
 * If no personality-id provided, uses Lilith's ID
 */

const { QdrantClient } = require('@qdrant/js-client-rest');

const LILITH_ID = '1fed013b-053a-4bc8-bc09-7da5c44297d6';

async function main() {
  const personalityId = process.argv[2] || LILITH_ID;
  const collectionName = `personality-${personalityId}`;

  console.log(`\n📊 Checking Qdrant collection: ${collectionName}\n`);

  // Initialize Qdrant client
  const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
  });

  try {
    // Get collection info
    const collection = await qdrant.getCollection(collectionName);
    console.log(`✅ Collection exists`);
    console.log(`   Total points: ${collection.points_count}`);
    console.log(`   Vector size: ${collection.config.params.vectors.size}`);
    console.log(`   Distance: ${collection.config.params.vectors.distance}\n`);

    // Check if createdAt index exists
    const indexes = collection.payload_schema || {};
    if (indexes.createdAt) {
      console.log(`✅ createdAt index exists (type: ${indexes.createdAt.data_type})\n`);
    } else {
      console.log(`⚠️  No createdAt index found\n`);
    }

    // Scroll through ALL memories to find the newest
    console.log(`📝 Finding newest memories...\n`);

    let allMemories = [];
    let offset = null;

    // Scroll through all points in batches
    while (true) {
      const batch = await qdrant.scroll(collectionName, {
        limit: 100,
        offset: offset,
        with_payload: true,
        with_vector: false,
      });

      allMemories.push(...batch.points);

      if (batch.next_page_offset === null || batch.next_page_offset === undefined) {
        break;
      }
      offset = batch.next_page_offset;
    }

    console.log(`   Found ${allMemories.length} total memories\n`);

    if (allMemories.length === 0) {
      console.log('   No memories found\n');
      return;
    }

    // Sort by createdAt (absolute value - could be seconds or milliseconds)
    const points = allMemories.sort((a, b) => {
      const aTime = a.payload?.createdAt || 0;
      const bTime = b.payload?.createdAt || 0;
      return bTime - aTime; // Highest timestamp first
    });

    // Find the max timestamp to determine format
    const maxTimestamp = points[0]?.payload?.createdAt || 0;
    const isMilliseconds = maxTimestamp > 1700000000000; // If > this, it's milliseconds

    console.log(`   Newest timestamp: ${maxTimestamp} (${isMilliseconds ? 'milliseconds' : 'seconds'})`);
    console.log(`   Newest date: ${new Date(isMilliseconds ? maxTimestamp : maxTimestamp * 1000).toISOString()}\n`);

    // Split into new (recent) and old (imported) based on detected format
    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);

    const recentPoints = points.filter(p => {
      const ts = p.payload?.createdAt || 0;
      // Check both milliseconds and seconds formats
      return ts > dayAgo || (ts > dayAgo / 1000 && ts < 2000000000);
    });

    const oldPoints = points.filter(p => !recentPoints.includes(p));

    if (recentPoints.length > 0) {
      console.log(`🆕 NEW memories (last 24h): ${recentPoints.length}\n`);
      recentPoints.slice(0, 5).forEach((point, idx) => {
        const payload = point.payload || {};
        const createdAt = payload.createdAt;
        const content = payload.content || '';
        const summaryType = payload.summaryType || 'unknown';

        let timestamp = 'no timestamp';
        if (createdAt) {
          timestamp = new Date(createdAt).toISOString();
        }

        console.log(`${idx + 1}. [${timestamp}] (${summaryType})`);
        console.log(`   ID: ${point.id}`);
        console.log(`   Raw timestamp: ${createdAt}`);
        console.log(`   ${content.substring(0, 150)}${content.length > 150 ? '...' : ''}`);
        console.log('');
      });
    } else {
      console.log(`⚠️  No memories created in last 24 hours\n`);
    }

    console.log(`📚 IMPORTED memories (older): ${oldPoints.length} (showing first 5)\n`);
    oldPoints.slice(0, 5).forEach((point, idx) => {
      const payload = point.payload || {};
      const createdAt = payload.createdAt;
      const content = payload.content || '';
      const summaryType = payload.summaryType || 'unknown';

      // Format timestamp
      let timestamp = 'no timestamp';
      if (createdAt) {
        if (typeof createdAt === 'number') {
          timestamp = new Date(createdAt).toISOString();
        } else {
          timestamp = createdAt;
        }
      }

      console.log(`${idx + 1}. [${timestamp}] (${summaryType})`);
      console.log(`   ID: ${point.id}`);
      console.log(`   Raw timestamp: ${createdAt}`);
      console.log(`   ${content.substring(0, 150)}${content.length > 150 ? '...' : ''}`);
      console.log('');
    });

    const allPoints = [...recentPoints, ...oldPoints];

    // Show stats
    const types = {};
    allPoints.forEach(p => {
      const type = p.payload?.summaryType || 'unknown';
      types[type] = (types[type] || 0) + 1;
    });

    console.log(`📈 Memory types in sample (${allPoints.length} total):`);
    Object.entries(types).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
    console.log('');

  } catch (error) {
    if (error.status === 404) {
      console.error(`❌ Collection not found: ${collectionName}`);
      console.error(`   This personality has no memories yet.\n`);
    } else {
      console.error(`❌ Error:`, error.message);
      console.error(error);
    }
    process.exit(1);
  }
}

main().catch(console.error);
