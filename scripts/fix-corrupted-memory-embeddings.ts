#!/usr/bin/env tsx
/**
 * Fix Corrupted Memory Embeddings
 *
 * Regenerates embeddings for specific memories where the text content
 * was fixed but embeddings are still based on old "Hello" fallback.
 */

import { PrismaClient } from '@prisma/client';
import { OpenAI } from 'openai';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('FixCorruptedMemoryEmbeddings');
const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

// The two memory IDs that need their embeddings regenerated
const CORRUPTED_MEMORY_IDS = [
  '0c7a2a2b-3ed7-54bc-aed4-a926b51d1b0b',
  'ce5856e0-07b5-5bb4-8d42-30f6d822a354',
];

async function main() {
  logger.info('=== Fixing corrupted memory embeddings ===');

  try {
    for (const memoryId of CORRUPTED_MEMORY_IDS) {
      logger.info(`Processing memory ${memoryId}...`);

      // Fetch the memory
      const memory = await prisma.$queryRaw<Array<{ id: string; content: string }>>`
        SELECT id, content
        FROM memories
        WHERE id = ${memoryId}::uuid
      `;

      if (memory.length === 0) {
        logger.warn(`Memory ${memoryId} not found, skipping`);
        continue;
      }

      const content = memory[0].content;
      logger.info(`Content length: ${content.length} chars`);
      logger.info(`Content preview: ${content.substring(0, 150)}...`);

      // Generate new embedding
      logger.info('Generating new embedding...');
      const embeddingResponse = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: content,
      });
      const embedding = embeddingResponse.data[0].embedding;
      logger.info(`Generated embedding with ${embedding.length} dimensions`);

      // Update the memory with new embedding
      await prisma.$executeRaw`
        UPDATE memories
        SET embedding = ${`[${embedding.join(',')}]`}::vector(1536)
        WHERE id = ${memoryId}::uuid
      `;

      logger.info(`✅ Updated embedding for memory ${memoryId}`);
    }

    logger.info('✅ All embeddings updated successfully!');
  } catch (error) {
    logger.error({ err: error }, 'Failed to fix embeddings');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
