#!/usr/bin/env tsx
import { QdrantClient } from '@qdrant/js-client-rest';
import { config as loadEnv } from 'dotenv';

loadEnv();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});

const memoryIds = [
  '0eb8e24d-2d88-5710-bc87-8081748282a2',
  '53a85f47-4437-5a55-ab8c-70662ca69b74',
  '6a2efb9d-f430-5b6b-a98b-07d96e06201f',
  '7c17b3b0-5ed0-5212-8c0a-e4e7c4baaff3',
  '7c316fdd-4821-53f1-a75a-786611a1b8f2',
  '8c635d40-ca85-5b32-a995-79b68e9aa2e7',
  '984ef0e3-9fa3-4beb-afd2-1b4f0a2617bc',
  'f0a9b9b9-6f39-59f4-98fb-3896336df888',
];

async function checkMemories() {
  const collectionName = 'persona-3bd86394-20d8-5992-8201-e621856e9087';

  for (const memoryId of memoryIds) {
    console.log(`\nChecking memory ${memoryId}:`);

    try {
      const response = await qdrant.retrieve(collectionName, {
        ids: [memoryId],
        with_payload: true,
        with_vector: false,
      });

      if (response.length === 0) {
        console.log('  ❌ Memory not found');
      } else {
        const memory = response[0];
        console.log('  ✅ Memory found');
        const timestamp = memory.payload?.createdAt || memory.payload?.timestamp;
        const date = timestamp ? new Date(Number(timestamp)).toISOString() : 'unknown';
        console.log('  Created:', date);
        console.log('  Content:');
        console.log('─'.repeat(80));
        console.log(memory.payload?.content || memory.payload?.text || 'MISSING');
        console.log('─'.repeat(80));
      }
    } catch (error) {
      console.log('  ❌ Error:', error instanceof Error ? error.message : String(error));
    }
  }
}

checkMemories();
