#!/usr/bin/env node
/**
 * Search Qdrant memories by content keywords to identify old user IDs
 */

require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function searchByKeywords(keywords, limit = 50) {
  const collectionName = 'personality-c296b337-4e67-5337-99a3-4ca105cbbd68';

  console.log(`\nSearching for memories containing: "${keywords}"`);
  console.log('='.repeat(60));

  const userMemoryCounts = {};
  let totalMatches = 0;

  let offset = null;
  while (true) {
    const response = await qdrant.scroll(collectionName, {
      limit: 100,
      offset: offset,
      with_payload: true,
      with_vector: false,
    });

    for (const point of response.points) {
      const content = point.payload.content || '';
      const lowerContent = content.toLowerCase();
      const lowerKeywords = keywords.toLowerCase();

      if (lowerContent.includes(lowerKeywords)) {
        totalMatches++;
        const userId = point.payload.userId;

        if (!userMemoryCounts[userId]) {
          userMemoryCounts[userId] = {
            count: 0,
            samples: []
          };
        }

        userMemoryCounts[userId].count++;

        // Keep a few sample excerpts
        if (userMemoryCounts[userId].samples.length < 3) {
          const excerpt = content.substring(0, 200).replace(/\n/g, ' ');
          userMemoryCounts[userId].samples.push(excerpt);
        }
      }
    }

    offset = response.next_page_offset;
    if (!offset) break;
  }

  console.log(`\nFound ${totalMatches} total memories containing "${keywords}"\n`);

  // Sort by count
  const sorted = Object.entries(userMemoryCounts)
    .sort(([, a], [, b]) => b.count - a.count);

  for (const [userId, data] of sorted.slice(0, limit)) {
    console.log(`User ID: ${userId}`);
    console.log(`  Memories: ${data.count}`);
    console.log(`  Sample excerpts:`);
    for (const sample of data.samples) {
      console.log(`    - ${sample}...`);
    }
    console.log('');
  }

  return sorted;
}

async function main() {
  const searchTerm = process.argv[2];

  if (!searchTerm) {
    console.log('Usage: node find-user-memories.cjs <search-term>');
    console.log('\nExamples:');
    console.log('  node find-user-memories.cjs "fennarin"');
    console.log('  node find-user-memories.cjs "snail"');
    console.log('  node find-user-memories.cjs "master"');
    process.exit(1);
  }

  await searchByKeywords(searchTerm);
}

main().catch(console.error);
