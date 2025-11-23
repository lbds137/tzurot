#!/usr/bin/env node
require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function findRefusalSpam() {
  const collectionName = 'personality-c296b337-4e67-5337-99a3-4ca105cbbd68';

  const refusalPatterns = [
    'I cannot generate',
    'I cannot provide',
    'I cannot create',
    'I cannot assist',
    'I apologize, but I cannot',
    "I'm not able to",
    'I cannot help with',
    "I'm unable to",
  ];

  const refusalMemories = [];

  let offset = null;
  let totalPoints = 0;

  while (true) {
    const response = await qdrant.scroll(collectionName, {
      limit: 100,
      offset: offset,
      with_payload: true,
      with_vector: false,
    });

    for (const point of response.points) {
      totalPoints++;
      const content = point.payload.content || '';
      const lowerContent = content.toLowerCase();

      for (const pattern of refusalPatterns) {
        if (lowerContent.includes(pattern.toLowerCase())) {
          refusalMemories.push({
            id: point.id,
            userId: point.payload.userId,
            content: content,
            timestamp: point.payload.createdAt || point.payload.timestamp,
            senders: point.payload.senders || [],
          });
          break; // Only count once per memory
        }
      }
    }

    offset = response.next_page_offset;
    if (!offset) break;
  }

  console.log('Refusal Spam Analysis');
  console.log('='.repeat(80));
  console.log(`Total memories scanned: ${totalPoints}`);
  console.log(`Refusal spam memories found: ${refusalMemories.length}`);
  console.log(`Percentage: ${((refusalMemories.length / totalPoints) * 100).toFixed(2)}%`);
  console.log('='.repeat(80));

  if (refusalMemories.length > 0) {
    console.log('\n📋 REFUSAL SPAM SAMPLES (first 10):');
    console.log('='.repeat(80));

    for (let i = 0; i < Math.min(10, refusalMemories.length); i++) {
      const mem = refusalMemories[i];
      console.log(`\n${i + 1}. ID: ${mem.id}`);
      console.log(`   User: ${mem.userId}`);
      console.log(`   Senders: ${JSON.stringify(mem.senders)}`);
      console.log(`   Content: ${mem.content.substring(0, 200)}`);
      console.log('   ' + '-'.repeat(76));
    }

    console.log('\n' + '='.repeat(80));
    console.log('RECOMMENDATION:');
    console.log('These memories are garbage and should be filtered out during migration.');
    console.log('They contain no useful information and waste storage/retrieval resources.');
    console.log('='.repeat(80));
  }
}

findRefusalSpam().catch(console.error);
