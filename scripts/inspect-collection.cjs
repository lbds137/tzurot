require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function inspect() {
  const collectionName = 'persona-3bd86394-20d8-5992-8201-e621856e9087';

  const sample = await qdrant.scroll(collectionName, {
    limit: 3,
    with_payload: true,
    with_vector: false,
  });

  console.log('Sample points from collection:');
  sample.points.forEach((point, i) => {
    console.log(`\nPoint ${i + 1}:`);
    console.log(`  userId: ${point.payload.userId}`);
    console.log(`  personaId: ${point.payload.personaId}`);
    console.log(`  personalityId: ${point.payload.personalityId}`);
    console.log(`  content: ${(point.payload.content || '').substring(0, 60)}...`);
  });
}

inspect().catch(console.error);
