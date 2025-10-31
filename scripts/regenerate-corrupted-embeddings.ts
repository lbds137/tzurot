#!/usr/bin/env tsx
/**
 * Regenerate Corrupted Memory Embeddings
 *
 * Finds ALL memories with corrupted timestamps (year > 9999) and regenerates
 * their embeddings based on current content.
 *
 * Does NOT delete anything - only updates embeddings.
 */

import { PrismaClient } from '@prisma/client';
import { OpenAI } from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

function log(message: string, data?: any) {
  console.log(`[RegenerateEmbeddings] ${message}`, data || '');
}

async function main() {
  log('=== Regenerating embeddings for corrupted memories ===');

  try {
    // Find ALL memories with corrupted timestamps (year > 9999)
    const corrupted = await prisma.$queryRaw<Array<{ id: string; content: string; created_at: Date }>>`
      SELECT id, content, created_at
      FROM memories
      WHERE created_at > '9999-12-31'::timestamptz
      ORDER BY created_at DESC
    `;

    log(`Found ${corrupted.length} memories with corrupted timestamps`);

    if (corrupted.length === 0) {
      log('No corrupted memories to fix!');
      await prisma.$disconnect();
      return;
    }

    // Show sample
    log('Sample of corrupted timestamps:');
    corrupted.slice(0, 5).forEach(m => {
      log(`  ${m.id}: ${m.created_at}`);
    });

    // Regenerate embeddings for each
    for (let i = 0; i < corrupted.length; i++) {
      const memory = corrupted[i];
      log(`[${i + 1}/${corrupted.length}] Processing ${memory.id}...`);
      log(`  Content length: ${memory.content.length} chars`);

      // Generate new embedding
      const embeddingResponse = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: memory.content,
      });
      const embedding = embeddingResponse.data[0].embedding;

      // Update the memory
      await prisma.$executeRaw`
        UPDATE memories
        SET embedding = ${`[${embedding.join(',')}]`}::vector(1536)
        WHERE id = ${memory.id}::uuid
      `;

      log(`  ✅ Updated embedding`);
    }

    log(`✅ Regenerated embeddings for ${corrupted.length} memories!`);

  } catch (error) {
    log('ERROR:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  log('Fatal error:', error);
  process.exit(1);
});
