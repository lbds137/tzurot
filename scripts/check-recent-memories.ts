#!/usr/bin/env tsx
import { QdrantClient } from '@qdrant/js-client-rest';
import { config as loadEnv } from 'dotenv';

loadEnv();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});

const COLLECTION_NAME = 'persona-3bd86394-20d8-5992-8201-e621856e9087';

async function checkRecentMemories() {
  console.log('🔍 Fetching recent memories from October 24, 2025...\n');

  // October 24, 2025 00:00:00 UTC
  const oct24Start = new Date('2025-10-24T00:00:00Z').getTime();
  // October 25, 2025 00:00:00 UTC (to catch everything today)
  const oct25Start = new Date('2025-10-25T00:00:00Z').getTime();

  let offset: string | number | null = null;
  const oct24Memories: any[] = [];

  console.log('Scanning collection...');
  while (true) {
    const response = await qdrant.scroll(COLLECTION_NAME, {
      limit: 100,
      offset,
      with_payload: true,
      with_vector: false,
    });

    for (const point of response.points) {
      const timestamp = point.payload?.createdAt || point.payload?.timestamp;
      if (timestamp && timestamp >= oct24Start && timestamp < oct25Start) {
        oct24Memories.push(point);
      }
    }

    offset = response.next_page_offset;
    if (!offset) break;
  }

  console.log(`Found ${oct24Memories.length} memories from October 24, 2025\n`);
  console.log('═'.repeat(80));

  // Sort by timestamp
  oct24Memories.sort((a, b) => {
    const aTime = a.payload?.createdAt || a.payload?.timestamp || 0;
    const bTime = b.payload?.createdAt || b.payload?.timestamp || 0;
    return aTime - bTime;
  });

  for (const memory of oct24Memories) {
    const timestamp = memory.payload?.createdAt || memory.payload?.timestamp;
    const date = new Date(Number(timestamp));
    const content = String(memory.payload?.content || '');

    // Extract first line
    const firstLine = content.split('\n')[0].substring(0, 120);

    // Check if it has the UUID format
    const hasUUID = content.includes('User (e64fcc09-e4db-5902-b1c9-5750141e3bf2):');
    const hasUsername = content.includes('User (lbds137):');

    const formatStatus = hasUUID ? '❌ UUID' : hasUsername ? '✅ Username' : '⚠️  Other';

    console.log(`${formatStatus} | ${date.toISOString()} | ${memory.id}`);
    console.log(`   ${firstLine}${content.length > 120 ? '...' : ''}`);
    console.log('');
  }

  console.log('═'.repeat(80));

  const uuidCount = oct24Memories.filter(m =>
    String(m.payload?.content || '').includes('User (e64fcc09-e4db-5902-b1c9-5750141e3bf2):')
  ).length;

  const usernameCount = oct24Memories.filter(m =>
    String(m.payload?.content || '').includes('User (lbds137):')
  ).length;

  console.log(`\nSummary:`);
  console.log(`  Total October 24 memories: ${oct24Memories.length}`);
  console.log(`  Using UUID format: ${uuidCount}`);
  console.log(`  Using username format: ${usernameCount}`);
  console.log(`  Other format: ${oct24Memories.length - uuidCount - usernameCount}`);
}

checkRecentMemories();
