#!/usr/bin/env tsx
/**
 * Fix UUID→Username in Memory Content
 *
 * Some v3 memories have "User (UUID):" in the content instead of "User (username):".
 * This script replaces the UUID with the actual username.
 */

import { PrismaClient } from '@prisma/client';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config as loadEnv } from 'dotenv';

loadEnv();

const prisma = new PrismaClient();
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});

const COLLECTION_NAME = 'persona-3bd86394-20d8-5992-8201-e621856e9087';
const USER_ID = 'e64fcc09-e4db-5902-b1c9-5750141e3bf2';

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

async function fixMemories() {
  // Look up username
  const user = await prisma.user.findUnique({
    where: { id: USER_ID },
    select: { username: true },
  });

  if (!user) {
    console.error(`❌ User ${USER_ID} not found`);
    process.exit(1);
  }

  const username = user.username;
  console.log(
    `🔧 Replacing "User (${USER_ID}):" with "User (${username}):" in ${memoryIds.length} memories\n`
  );

  const searchPattern = `User (${USER_ID}):`;
  const replacePattern = `User (${username}):`;

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
      const content = payload.content;

      if (!content) {
        console.log(`  ⚠️  Memory has no content field, skipping`);
        continue;
      }

      if (!content.includes(searchPattern)) {
        console.log(`  ⚠️  Memory doesn't contain UUID pattern, skipping`);
        continue;
      }

      // Replace UUID with username
      const newContent = content.replace(
        new RegExp(searchPattern.replace(/[()]/g, '\\$&'), 'g'),
        replacePattern
      );

      // Update the memory
      await qdrant.upsert(COLLECTION_NAME, {
        points: [
          {
            id: memoryId,
            vector: memory.vector as number[],
            payload: {
              ...payload,
              content: newContent,
            },
          },
        ],
      });

      const occurrences = (
        content.match(new RegExp(searchPattern.replace(/[()]/g, '\\$&'), 'g')) || []
      ).length;
      console.log(`  ✅ Replaced ${occurrences} occurrence(s)`);
    } catch (error) {
      console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n✅ All memories fixed!`);
  await prisma.$disconnect();
}

fixMemories();
