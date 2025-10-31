#!/usr/bin/env tsx
/**
 * Backfill guild_id in conversation_history table
 *
 * This script populates missing guild_id values by:
 * 1. Using channel_id → guild_id mappings from memories table
 * 2. Leaving DM channels as null (guild_id = null)
 *
 * Run with DRY_RUN=true to preview changes without applying them.
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../packages/common-types/src/logger.js';

const logger = createLogger('BackfillGuildIds');
const prisma = new PrismaClient();

const DRY_RUN = process.env.DRY_RUN === 'true';

async function main() {
  logger.info('=== Backfilling guild_id in conversation_history ===');
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will update database)'}`);

  // Step 1: Build channel_id → guild_id mapping from memories table
  logger.info('Building channel → guild mapping from memories table...');
  const channelMappings = await prisma.$queryRaw<Array<{
    channel_id: string;
    guild_id: string;
  }>>`
    SELECT DISTINCT channel_id, guild_id
    FROM memories
    WHERE channel_id IS NOT NULL
      AND guild_id IS NOT NULL
  `;

  const channelToGuild = new Map<string, string>();
  for (const mapping of channelMappings) {
    channelToGuild.set(mapping.channel_id, mapping.guild_id);
  }

  logger.info(`Found ${channelToGuild.size} channel → guild mappings from memories`);

  // Step 2: Find conversation_history records with null guild_id
  const recordsToUpdate = await prisma.$queryRaw<Array<{
    id: string;
    channel_id: string;
  }>>`
    SELECT id, channel_id
    FROM conversation_history
    WHERE guild_id IS NULL
      AND channel_id != 'dm'
  `;

  logger.info(`Found ${recordsToUpdate.length} conversation_history records with null guild_id`);

  if (recordsToUpdate.length === 0) {
    logger.info('No records to update!');
    await prisma.$disconnect();
    return;
  }

  // Step 3: Update records
  let updated = 0;
  let skipped = 0;

  for (const record of recordsToUpdate) {
    const guildId = channelToGuild.get(record.channel_id);

    if (guildId) {
      if (!DRY_RUN) {
        await prisma.$executeRaw`
          UPDATE conversation_history
          SET guild_id = ${guildId}
          WHERE id = ${record.id}::uuid
        `;
      }
      logger.debug(`✅ ${DRY_RUN ? '[DRY RUN] Would update' : 'Updated'} ${record.id.substring(0, 8)}... (channel: ${record.channel_id} → guild: ${guildId})`);
      updated++;
    } else {
      logger.debug(`⏭️  Skipped ${record.id.substring(0, 8)}... (no guild_id found for channel: ${record.channel_id})`);
      skipped++;
    }
  }

  // Summary
  logger.info('\n=== Summary ===');
  logger.info(`Records updated: ${updated}`);
  logger.info(`Records skipped (no mapping): ${skipped}`);
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
