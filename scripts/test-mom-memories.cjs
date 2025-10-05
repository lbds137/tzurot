/**
 * Test mom/surgery memory retrieval with simple similarity search
 */

require('dotenv/config');
const { QdrantMemoryService } = require('../packages/common-types/dist/services/QdrantMemoryService.js');

const YOUR_USER_ID = 'e64fcc09-e4db-5902-b1c9-5750141e3bf2';
const PERSONALITY_ID = 'c296b337-4e67-5337-99a3-4ca105cbbd68';

async function testMomMemories() {
  const service = new QdrantMemoryService();

  console.log('🧪 Testing Mom/Surgery Memory Retrieval\n');

  // Simulate the actual voice message query
  const query = "let's see if we can get any memories of my mom's bullshit about the surgery. anything about her gaslighting me or concern trolling me would probably be relevant";

  const excludeNewerThan = new Date('2025-10-05T00:04:32.640Z').getTime();

  const memories = await service.searchMemories(
    PERSONALITY_ID,
    query,
    {
      limit: 10,
      scoreThreshold: 0.15,
      excludeNewerThan,
      userId: YOUR_USER_ID,
      includeGlobal: true,
      includePersonal: true,
      includeSession: false,
    }
  );

  console.log(`Retrieved ${memories.length} memories:\n`);

  // Analyze the results
  const byDate = {};
  const withKeywords = {
    mom: [],
    mother: [],
    surgery: [],
    gaslighting: [],
  };

  memories.forEach(memory => {
    const date = new Date(memory.metadata.createdAt).toISOString().split('T')[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(memory);

    const contentLower = memory.content.toLowerCase();
    Object.keys(withKeywords).forEach(keyword => {
      if (contentLower.includes(keyword)) {
        withKeywords[keyword].push(memory);
      }
    });
  });

  console.log('📅 Date distribution:');
  Object.entries(byDate)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .forEach(([date, mems]) => {
      console.log(`  ${date}: ${mems.length} memories`);
    });

  console.log('\n🔍 Keyword matches:');
  Object.entries(withKeywords).forEach(([keyword, mems]) => {
    console.log(`  "${keyword}": ${mems.length} matches`);
  });

  console.log('\n📝 Memory details:\n');
  memories.forEach((memory, idx) => {
    const date = new Date(memory.metadata.createdAt).toISOString().split('T')[0];
    const content = memory.content.substring(0, 120);
    const score = memory.score ? memory.score.toFixed(3) : 'N/A';
    const keywords = Object.keys(withKeywords).filter(k =>
      memory.content.toLowerCase().includes(k)
    ).join(', ');

    console.log(`${idx + 1}. [${date}] score=${score} ${keywords ? `[${keywords}]` : ''}`);
    console.log(`   "${content}..."\n`);
  });

  // Check if we got relevant results
  const totalKeywordMatches = Object.values(withKeywords).reduce((sum, arr) => sum + arr.length, 0);
  const uniqueDates = Object.keys(byDate).length;

  console.log('📊 Summary:');
  console.log(`  ${totalKeywordMatches} total keyword matches across ${memories.length} memories`);
  console.log(`  ${uniqueDates} unique dates`);
  console.log(`  Oldest: ${Object.keys(byDate).sort()[0]}`);
  console.log(`  Newest: ${Object.keys(byDate).sort().reverse()[0]}`);

  if (totalKeywordMatches >= 5) {
    console.log('\n✅ Good relevance! Multiple keyword matches found.');
  } else {
    console.log('\n⚠️  Low relevance. Consider lowering score threshold or checking embeddings.');
  }
}

testMomMemories()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
