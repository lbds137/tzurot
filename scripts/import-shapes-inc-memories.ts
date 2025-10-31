#!/usr/bin/env tsx
/**
 * Import legacy memories from shapes.inc data export
 *
 * This script:
 * - Loads memory JSONs from tzurot-legacy/data/personalities/
 * - Maps personality slugs to current database IDs
 * - Maps Discord user IDs to persona IDs
 * - Generates new OpenAI embeddings (shapes.inc used different model)
 * - Inserts with deterministic UUIDs for deduplication
 */

import { PrismaClient } from '@prisma/client';
import { OpenAI } from 'openai';
import { v5 as uuidv5 } from 'uuid';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../packages/common-types/src/logger.js';

const logger = createLogger('ShapesIncImport');
const prisma = new PrismaClient();

// Namespace UUID for memories
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const MEMORY_NAMESPACE = uuidv5('tzurot-v3-memory', DNS_NAMESPACE);

// Helper to hash content
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
}

// Helper to generate deterministic memory UUID
function deterministicMemoryUuid(personaId: string, personalityId: string, content: string): string {
  const key = `${personaId}:${personalityId}:${hashContent(content)}`;
  return uuidv5(key, MEMORY_NAMESPACE);
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 50; // Process 50 memories at a time
const DRY_RUN = process.env.DRY_RUN === 'true';
const LEGACY_DATA_DIR = 'tzurot-legacy/data/personalities';

interface ShapesIncMemory {
  id: string;
  shape_id: string;
  senders: string[];
  user_id: string | null;
  result: string; // The actual memory content
  metadata: {
    discord_channel_id: string;
    discord_guild_id?: string;
    group: boolean;
    senders: string[];
    msg_ids: string[];
    start_ts: number;
    end_ts: number;
    created_at: number; // Unix timestamp
  };
  summary_type: string;
  deleted: boolean;
}

async function main() {
  logger.info('=== Importing shapes.inc Legacy Memories ===');
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write to database)'}`);

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Step 1: Get all personality directories
  logger.info('\n📂 Step 1: Finding personality directories...');
  const dirs = await fs.readdir(LEGACY_DATA_DIR, { withFileTypes: true });
  const personalityDirs = dirs.filter(d => d.isDirectory()).map(d => d.name);
  logger.info(`Found ${personalityDirs.length} personality directories`);

  // Step 2: Load existing shapes.inc persona mappings
  logger.info('\n👤 Step 2: Loading shapes.inc persona mappings...');
  const mappings = await prisma.shapesPersonaMapping.findMany({
    select: {
      shapesUserId: true,
      personaId: true,
    },
  });

  // Create mapping: shapes.inc user UUID → persona UUID
  const shapesUserToPersona = new Map<string, string>();
  for (const mapping of mappings) {
    shapesUserToPersona.set(mapping.shapesUserId, mapping.personaId);
  }
  logger.info(`Found ${shapesUserToPersona.size} existing shapes.inc persona mappings`);

  // Step 3: Process each personality directory
  let totalMemories = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let personalitiesProcessed = 0;

  for (const dirName of personalityDirs) {
    const memoryFilePath = path.join(LEGACY_DATA_DIR, dirName, `${dirName}_memories.json`);

    // Check if memory file exists
    try {
      await fs.access(memoryFilePath);
    } catch {
      logger.debug(`  ⏭️  No memories file for ${dirName}, skipping`);
      continue;
    }

    // Find matching personality by slug
    const personality = await prisma.personality.findUnique({
      where: { slug: dirName },
      select: {
        id: true,
        name: true,
      },
    });

    if (!personality) {
      logger.warn(`  ⚠️  No personality found for slug: ${dirName}`);
      totalSkipped++;
      continue;
    }

    logger.info(`\n🔄 Processing: ${personality.name} (${dirName})`);

    // Load memories from JSON
    const fileContent = await fs.readFile(memoryFilePath, 'utf-8');
    const memories: ShapesIncMemory[] = JSON.parse(fileContent);

    // Filter out deleted memories
    const activeMemories = memories.filter(m => !m.deleted);
    logger.info(`  Found ${activeMemories.length} memories (${memories.length - activeMemories.length} deleted)`);

    if (activeMemories.length === 0) {
      continue;
    }

    personalitiesProcessed++;

    // Process in batches
    for (let i = 0; i < activeMemories.length; i += BATCH_SIZE) {
      const batch = activeMemories.slice(i, i + BATCH_SIZE);
      logger.info(`  Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(activeMemories.length / BATCH_SIZE)} (${batch.length} memories)...`);

      for (const memory of batch) {
        try {
          // Get shapes.inc user UUID from senders array (this is the legacy persona UUID)
          const shapesUserId = memory.senders && memory.senders.length > 0 ? memory.senders[0] : null;

          if (!shapesUserId) {
            logger.debug(`  Memory ${memory.id} has no senders, skipping`);
            totalSkipped++;
            continue;
          }

          // Check if there's a mapping to a current persona
          const mappedPersonaId = shapesUserToPersona.get(shapesUserId);

          // Use the memory result as content
          const memoryContent = memory.result;

          // Generate embedding
          const embeddingResponse = await openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: memoryContent,
          });
          const embedding = embeddingResponse.data[0].embedding;

          if (!DRY_RUN) {
            // Generate deterministic UUID based on legacy shapes user ID
            // Key: legacy_shapes_user_id:personality_id:content_hash
            const key = `${shapesUserId}:${personality.id}:${hashContent(memoryContent)}`;
            const memoryId = uuidv5(key, MEMORY_NAMESPACE);

            // Convert Unix timestamp to Date
            const createdAt = new Date(memory.metadata.created_at * 1000);

            // Insert into memories table with legacy tracking
            await prisma.$executeRaw`
              INSERT INTO memories (
                id,
                persona_id,
                personality_id,
                personality_name,
                legacy_shapes_user_id,
                source_system,
                content,
                embedding,
                channel_id,
                guild_id,
                message_ids,
                senders,
                is_summarized,
                created_at
              ) VALUES (
                ${memoryId}::uuid,
                ${mappedPersonaId || null}::uuid,
                ${personality.id}::uuid,
                ${personality.name},
                ${shapesUserId}::uuid,
                'shapes-inc',
                ${memoryContent},
                ${`[${embedding.join(',')}]`}::vector(1536),
                ${memory.metadata.discord_channel_id},
                ${memory.metadata.discord_guild_id || null},
                ${memory.metadata.msg_ids}::text[],
                ${memory.metadata.senders}::text[],
                true,
                ${createdAt}
              )
              ON CONFLICT (id) DO NOTHING
            `;
          }

          totalMemories++;

        } catch (error) {
          totalErrors++;
          logger.error({ err: error, memory: memory.id }, 'Failed to process memory');
        }
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info(`  ✅ Completed: ${activeMemories.length} memories processed`);
  }

  // Summary
  logger.info('\n=== Summary ===');
  logger.info(`Personalities processed: ${personalitiesProcessed}`);
  logger.info(`Total memories imported: ${totalMemories}`);
  logger.info(`Total skipped: ${totalSkipped}`);
  logger.info(`Total errors: ${totalErrors}`);
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal error in shapes.inc import');
  process.exit(1);
});
