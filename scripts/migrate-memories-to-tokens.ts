#!/usr/bin/env tsx
/**
 * Migrate existing memories to use {user} and {assistant} tokens
 *
 * This script:
 * - Replaces hardcoded persona/personality names with tokens
 * - For shapes.inc memories: "User:" → "{user}:", personality name → "{assistant}:"
 * - For v3 memories: persona name → "{user}:", personality name → "{assistant}:"
 * - Preserves embeddings (tokens make semantic search work the same)
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../packages/common-types/src/logger.js';

const logger = createLogger('MigrateMemoriesToTokens');
const prisma = new PrismaClient();

const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 100;

async function main() {
  logger.info('=== Migrating memories to use {user} and {assistant} tokens ===');
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will update database)'}`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Process memories in batches
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    // Fetch batch with persona and personality names
    const memories = await prisma.$queryRaw<Array<{
      id: string;
      content: string;
      source_system: string;
      persona_name: string;
      personality_display_name: string | null;
      personality_name: string;
    }>>`
      SELECT
        m.id,
        m.content,
        m.source_system,
        persona.name as persona_name,
        personality.display_name as personality_display_name,
        personality.name as personality_name
      FROM memories m
      JOIN personas persona ON m.persona_id = persona.id
      JOIN personalities personality ON m.personality_id = personality.id
      ORDER BY m.created_at ASC
      LIMIT ${BATCH_SIZE}
      OFFSET ${offset}
    `;

    if (memories.length === 0) {
      hasMore = false;
      break;
    }

    logger.info(`\nProcessing batch at offset ${offset} (${memories.length} memories)...`);

    for (const memory of memories) {
      try {
        const personalityName = memory.personality_display_name || memory.personality_name;
        let newContent = memory.content;
        let wasModified = false;

        if (memory.source_system === 'shapes-inc') {
          // shapes.inc format: "User: ...\n\nAssistant: ..."
          // Replace with tokens
          if (newContent.includes('User:')) {
            newContent = newContent.replace(/User:/g, '{user}:');
            wasModified = true;
          }
          if (newContent.includes('Assistant:')) {
            newContent = newContent.replace(/Assistant:/g, '{assistant}:');
            wasModified = true;
          }
          // Also check for personality name (in case it was used)
          if (newContent.includes(`${personalityName}:`)) {
            newContent = newContent.replace(new RegExp(`${personalityName}:`, 'g'), '{assistant}:');
            wasModified = true;
          }
        } else if (memory.source_system === 'tzurot-v3') {
          // v3 format can be:
          // 1. Generic "User:" and "Assistant:" from rebuild script
          // 2. Actual persona/personality names from live system

          // First, handle generic labels (from rebuild script)
          if (newContent.includes('User:')) {
            newContent = newContent.replace(/User:/g, '{user}:');
            wasModified = true;
          }
          if (newContent.includes('Assistant:')) {
            newContent = newContent.replace(/Assistant:/g, '{assistant}:');
            wasModified = true;
          }

          // Then handle actual names (from live system)
          if (newContent.includes(`${memory.persona_name}:`)) {
            newContent = newContent.replace(new RegExp(`${memory.persona_name}:`, 'g'), '{user}:');
            wasModified = true;
          }
          if (newContent.includes(`${personalityName}:`)) {
            newContent = newContent.replace(new RegExp(`${personalityName}:`, 'g'), '{assistant}:');
            wasModified = true;
          }
        }

        if (wasModified) {
          if (!DRY_RUN) {
            await prisma.$executeRaw`
              UPDATE memories
              SET content = ${newContent}
              WHERE id = ${memory.id}::uuid
            `;
          }
          logger.debug(`  ✅ Updated memory ${memory.id.substring(0, 8)}... (${memory.source_system})`);
          totalUpdated++;
        } else {
          logger.debug(`  ⏭️  Skipped memory ${memory.id.substring(0, 8)}... (already uses tokens or no names found)`);
          totalSkipped++;
        }
      } catch (error) {
        totalErrors++;
        logger.error({ err: error, memoryId: memory.id }, 'Failed to process memory');
      }
    }

    offset += BATCH_SIZE;
  }

  // Summary
  logger.info('\n=== Summary ===');
  logger.info(`Memories updated: ${totalUpdated}`);
  logger.info(`Memories skipped: ${totalSkipped}`);
  logger.info(`Errors: ${totalErrors}`);
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
