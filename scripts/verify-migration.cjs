require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function verify() {
  console.log('🔍 Verifying Qdrant Migration\n');

  // Get all persona collections
  const response = await qdrant.getCollections();
  const personaCollections = response.collections
    .filter(c => c.name.startsWith('persona-'))
    .map(c => c.name);

  console.log(`Found ${personaCollections.length} persona collections:\n`);

  let totalPoints = 0;

  for (const collectionName of personaCollections) {
    const info = await qdrant.getCollection(collectionName);
    const count = info.points_count;
    totalPoints += count;

    console.log(`  ${collectionName}:`);
    console.log(`    Points: ${count}`);

    // Sample a point to check payload structure
    const sample = await qdrant.scroll(collectionName, {
      limit: 1,
      with_payload: true,
    });

    if (sample.points.length > 0) {
      const point = sample.points[0];
      console.log(`    Sample payload fields:`);
      console.log(`      - personaId: ${point.payload.personaId ? '✓' : '✗'}`);
      console.log(`      - personalityId: ${point.payload.personalityId ? '✓' : '✗'}`);
      console.log(`      - personalityName: ${point.payload.personalityName || 'N/A'}`);
      console.log(`      - userId: ${point.payload.userId ? '(kept for compat)' : 'N/A'}`);
    }
    console.log('');
  }

  console.log(`\n✅ Total points across all persona collections: ${totalPoints}`);
  console.log(`   Expected: 4059 (from migration)`);
  console.log(`   Match: ${totalPoints === 4059 ? '✅ YES' : '❌ NO'}`);
}

verify().catch(console.error);
