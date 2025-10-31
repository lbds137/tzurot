#!/usr/bin/env tsx
/**
 * Fix the two specific memories with incorrect embeddings
 */

import { PrismaClient } from '@prisma/client';
import { OpenAI } from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = 'text-embedding-3-small';

// The two memory IDs with bad embeddings
const MEMORY_IDS = [
  '0c7a2a2b-3ed7-54bc-aed4-a926b51d1b0b',
  'ce5856e0-07b5-5bb4-8d42-30f6d822a354',
];

async function main() {
  console.log('=== Fixing embeddings for 2 specific memories ===');

  for (const memoryId of MEMORY_IDS) {
    console.log(`\nProcessing ${memoryId}...`);

    // Fetch the memory
    const memory = await prisma.$queryRaw<Array<{ id: string; content: string }>>`
      SELECT id, content
      FROM memories
      WHERE id = ${memoryId}::uuid
    `;

    if (memory.length === 0) {
      console.log(`  ⚠️  Memory not found, skipping`);
      continue;
    }

    const content = memory[0].content;
    console.log(`  Content length: ${content.length} chars`);
    console.log(`  Preview: ${content.substring(0, 100)}...`);

    // Generate new embedding
    console.log('  Generating new embedding...');
    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: content,
    });
    const embedding = embeddingResponse.data[0].embedding;

    // Update the memory
    await prisma.$executeRaw`
      UPDATE memories
      SET embedding = ${`[${embedding.join(',')}]`}::vector(1536)
      WHERE id = ${memoryId}::uuid
    `;

    console.log(`  ✅ Updated embedding for ${memoryId}`);
  }

  console.log('\n✅ All embeddings fixed!');
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
