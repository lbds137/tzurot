/**
 * Analyze Memory Creation Dates
 * Shows when memories were created
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const YOUR_USER_ID = 'e64fcc09-e4db-5902-b1c9-5750141e3bf2';

async function analyzeMemoryDates() {
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  const collectionName = 'personality-c296b337-4e67-5337-99a3-4ca105cbbd68';

  console.log('📅 Analyzing Memory Creation Dates\n');
  console.log(`Analyzing memories for user: ${YOUR_USER_ID}\n`);

  const dateCounts = {};
  let offset = null;
  let totalProcessed = 0;
  let yourMemoriesCount = 0;

  while (true) {
    const result = await qdrant.scroll(collectionName, {
      limit: 100,
      offset: offset,
      with_payload: ['userId', 'createdAt'],
      with_vector: false,
    });

    if (result.points.length === 0) break;

    for (const point of result.points) {
      const userId = point.payload?.userId;

      // Only count your memories
      if (userId !== YOUR_USER_ID) continue;

      yourMemoriesCount++;
      const createdAt = point.payload?.createdAt;

      if (createdAt) {
        const date = new Date(createdAt).toISOString().split('T')[0];
        dateCounts[date] = (dateCounts[date] || 0) + 1;
      } else {
        dateCounts['NO_DATE'] = (dateCounts['NO_DATE'] || 0) + 1;
      }

      totalProcessed++;
    }

    console.log(`Processed ${totalProcessed} memories...`);

    offset = result.next_page_offset;
    if (!offset) break;
  }

  console.log(`\n✅ Analyzed ${yourMemoriesCount} of your memories\n`);
  console.log(`📊 Date Distribution:\n`);

  // Sort by date
  const sorted = Object.entries(dateCounts).sort((a, b) => a[0].localeCompare(b[0]));

  // Group by month
  const monthCounts = {};
  sorted.forEach(([date, count]) => {
    if (date === 'NO_DATE') return;
    const month = date.substring(0, 7); // YYYY-MM
    monthCounts[month] = (monthCounts[month] || 0) + count;
  });

  console.log('By Month:');
  Object.entries(monthCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([month, count]) => {
      const bar = '█'.repeat(Math.ceil(count / 10));
      console.log(`  ${month}: ${count.toString().padStart(4)} ${bar}`);
    });

  console.log('\nRecent Days (last 30):');
  const recent = sorted.slice(-30);
  recent.forEach(([date, count]) => {
    const bar = '█'.repeat(Math.ceil(count / 2));
    console.log(`  ${date}: ${count.toString().padStart(3)} ${bar}`);
  });

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`\n📈 Summary:`);
  console.log(`  Total memories: ${yourMemoriesCount}`);
  console.log(`  Today (${today}): ${dateCounts[today] || 0}`);
  console.log(`  Yesterday (${yesterday}): ${dateCounts[yesterday] || 0}`);
  console.log(`  Older: ${yourMemoriesCount - (dateCounts[today] || 0) - (dateCounts[yesterday] || 0)}`);
}

analyzeMemoryDates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
