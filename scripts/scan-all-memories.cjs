/**
 * Scan all memories and search for keywords locally
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const YOUR_USER_ID = 'e64fcc09-e4db-5902-b1c9-5750141e3bf2';
const PERSONALITY_ID = 'c296b337-4e67-5337-99a3-4ca105cbbd68';

async function scanMemories() {
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  const collectionName = `personality-${PERSONALITY_ID}`;

  console.log('🔍 Scanning all memories for surgery/mom keywords\n');

  const keywords = ['surgery', 'mother', 'mom', 'gaslighting'];
  const matchesByKeyword = {};
  keywords.forEach(k => matchesByKeyword[k] = []);

  let offset = null;
  let totalProcessed = 0;

  while (true) {
    const result = await qdrant.scroll(collectionName, {
      limit: 100,
      offset: offset,
      filter: {
        must: [
          {
            key: 'userId',
            match: { value: YOUR_USER_ID }
          }
        ]
      },
      with_payload: ['createdAt', 'content'],
      with_vector: false,
    });

    if (result.points.length === 0) break;

    for (const point of result.points) {
      const content = point.payload?.content || '';
      const contentLower = content.toLowerCase();
      const createdAt = point.payload?.createdAt;

      // Check for each keyword
      keywords.forEach(keyword => {
        if (contentLower.includes(keyword.toLowerCase())) {
          matchesByKeyword[keyword].push({
            date: new Date(createdAt).toISOString().split('T')[0],
            content: content.substring(0, 150),
            createdAt
          });
        }
      });

      totalProcessed++;
    }

    console.log(`Scanned ${totalProcessed} memories...`);

    offset = result.next_page_offset;
    if (!offset) break;
  }

  console.log(`\n✅ Scanned ${totalProcessed} memories\n`);

  // Report findings
  keywords.forEach(keyword => {
    const matches = matchesByKeyword[keyword];
    console.log(`\n📝 "${keyword}": ${matches.length} matches`);

    if (matches.length > 0) {
      // Group by date
      const byDate = {};
      matches.forEach(m => {
        if (!byDate[m.date]) byDate[m.date] = [];
        byDate[m.date].push(m);
      });

      console.log('\n  Date distribution:');
      const sortedDates = Object.entries(byDate)
        .sort((a, b) => b[0].localeCompare(a[0]));

      // Show recent dates
      console.log('  Recent dates:');
      sortedDates.slice(0, 5).forEach(([date, points]) => {
        console.log(`    ${date}: ${points.length} memories`);
      });

      // Show older dates (before Oct 2025)
      const older = sortedDates.filter(([date]) => date < '2025-10-01');
      if (older.length > 0) {
        console.log('\n  Older dates (before Oct 2025):');
        older.slice(0, 10).forEach(([date, points]) => {
          console.log(`    ${date}: ${points.length} memories`);
          console.log(`      Sample: "${points[0].content}..."`);
        });
      } else {
        console.log('\n  ⚠️  NO matches found before October 2025!');
      }
    }
  });
}

scanMemories()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
