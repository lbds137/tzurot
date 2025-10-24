#!/usr/bin/env tsx
/**
 * Fix Text→Content Field Name
 *
 * Some old memories use "text" instead of "content" as the payload field.
 * This script renames the field to match the current v3 schema.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { config as loadEnv } from 'dotenv';

loadEnv();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});

const COLLECTION_NAME = 'persona-3bd86394-20d8-5992-8201-e621856e9087';

const memoryIds = [
  "0eb8e24d-2d88-5710-bc87-8081748282a2",
  "53a85f47-4437-5a55-ab8c-70662ca69b74",
  "6a2efb9d-f430-5b6b-a98b-07d96e06201f",
  "7c17b3b0-5ed0-5212-8c0a-e4e7c4baaff3",
  "7c316fdd-4821-53f1-a75a-786611a1b8f2",
  "8c635d40-ca85-5b32-a995-79b68e9aa2e7",
  "984ef0e3-9fa3-4beb-afd2-1b4f0a2617bc",
  "f0a9b9b9-6f39-59f4-98fb-3896336df888",
];

async function fixMemories() {
  console.log(`🔧 Fixing ${memoryIds.length} memories with text→content rename\n`);

  for (const memoryId of memoryIds) {
    console.log(`Processing ${memoryId}...`);

    try {
      // Fetch the memory
      const response = await qdrant.retrieve(COLLECTION_NAME, {
        ids: [memoryId],
        with_payload: true,
        with_vector: true,
      });

      if (response.length === 0) {
        console.log(`  ❌ Memory not found`);
        continue;
      }

      const memory = response[0];
      const payload = memory.payload as any;

      if (!payload.text) {
        console.log(`  ⚠️  Memory has no 'text' field, skipping`);
        continue;
      }

      if (payload.content) {
        console.log(`  ⚠️  Memory already has 'content' field, skipping`);
        continue;
      }

      // Create new payload with content instead of text
      const { text, ...rest } = payload;
      const newPayload = {
        content: text,
        ...rest,
      };

      // Update the memory
      await qdrant.upsert(COLLECTION_NAME, {
        points: [
          {
            id: memoryId,
            vector: memory.vector as number[],
            payload: newPayload,
          },
        ],
      });

      console.log(`  ✅ Renamed text → content`);
    } catch (error) {
      console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n✅ All memories fixed!`);
}

fixMemories();
