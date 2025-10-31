#!/usr/bin/env tsx
/**
 * Backfill guild_id from Discord API for channels we don't have mappings for
 *
 * This script:
 * 1. Connects to Discord using the bot client
 * 2. Queries all channels with null guild_id
 * 3. Fetches guild_id from Discord API for each channel
 * 4. Updates conversation_history and memories tables
 *
 * Run with DRY_RUN=true to preview changes without applying them.
 */

import { Client, GatewayIntentBits } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('BackfillGuildIdsFromDiscord');
const prisma = new PrismaClient();

const DRY_RUN = process.env.DRY_RUN === 'true';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  logger.error('DISCORD_TOKEN environment variable is required');
  process.exit(1);
}

async function main() {
  logger.info('=== Backfilling guild_id from Discord API ===');
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will update database)'}`);

  // Initialize Discord client
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  // Login and wait for ready
  logger.info('Connecting to Discord...');
  await client.login(DISCORD_TOKEN);

  await new Promise<void>((resolve) => {
    client.once('ready', () => {
      logger.info(`Connected as ${client.user?.tag}`);
      resolve();
    });
  });

  // Get unique channel_ids with null guild_id from conversation_history
  const conversationChannels = await prisma.$queryRaw<Array<{ channel_id: string }>>`
    SELECT DISTINCT channel_id
    FROM conversation_history
    WHERE guild_id IS NULL
      AND channel_id != 'dm'
    ORDER BY channel_id
  `;

  logger.info(`Found ${conversationChannels.length} unique channels in conversation_history needing guild_id`);

  // Get unique channel_ids with null guild_id from memories
  const memoryChannels = await prisma.$queryRaw<Array<{ channel_id: string }>>`
    SELECT DISTINCT channel_id
    FROM memories
    WHERE guild_id IS NULL
      AND channel_id IS NOT NULL
      AND channel_id != 'dm'
    ORDER BY channel_id
  `;

  logger.info(`Found ${memoryChannels.length} unique channels in memories needing guild_id`);

  // Combine and deduplicate
  const allChannelIds = new Set<string>([
    ...conversationChannels.map(c => c.channel_id),
    ...memoryChannels.map(c => c.channel_id),
  ]);

  logger.info(`Total unique channels to query: ${allChannelIds.size}`);

  // Query Discord API for each channel
  const channelToGuild = new Map<string, string>();
  let successCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  for (const channelId of allChannelIds) {
    try {
      const channel = await client.channels.fetch(channelId);

      if (channel && 'guild' in channel && channel.guild) {
        channelToGuild.set(channelId, channel.guild.id);
        logger.debug(`✅ ${channelId} → guild ${channel.guild.id} (${channel.guild.name})`);
        successCount++;
      } else {
        logger.debug(`⚠️  ${channelId} → No guild (DM or deleted)`);
        notFoundCount++;
      }
    } catch (error: any) {
      if (error.code === 10003) {
        // Unknown channel - deleted or bot doesn't have access
        logger.debug(`❌ ${channelId} → Unknown channel (deleted or no access)`);
        notFoundCount++;
      } else {
        logger.warn({ err: error, channelId }, `Error fetching channel`);
        errorCount++;
      }
    }
  }

  logger.info(`\nDiscord API query complete:`);
  logger.info(`  ✅ Success: ${successCount}`);
  logger.info(`  ⚠️  Not found: ${notFoundCount}`);
  logger.info(`  ❌ Errors: ${errorCount}`);

  if (channelToGuild.size === 0) {
    logger.info('No guild_ids to update!');
    await client.destroy();
    await prisma.$disconnect();
    return;
  }

  // Update conversation_history
  let conversationUpdated = 0;
  for (const [channelId, guildId] of channelToGuild.entries()) {
    if (!DRY_RUN) {
      const result = await prisma.$executeRaw`
        UPDATE conversation_history
        SET guild_id = ${guildId}
        WHERE channel_id = ${channelId}
          AND guild_id IS NULL
      `;
      conversationUpdated += Number(result);
    } else {
      const count = await prisma.conversationHistory.count({
        where: {
          channelId,
          guildId: null,
        },
      });
      conversationUpdated += count;
    }
  }

  logger.info(`${DRY_RUN ? '[DRY RUN] Would update' : 'Updated'} ${conversationUpdated} conversation_history records`);

  // Update memories
  let memoriesUpdated = 0;
  for (const [channelId, guildId] of channelToGuild.entries()) {
    if (!DRY_RUN) {
      const result = await prisma.$executeRaw`
        UPDATE memories
        SET guild_id = ${guildId}
        WHERE channel_id = ${channelId}
          AND guild_id IS NULL
      `;
      memoriesUpdated += Number(result);
    } else {
      const count = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count
        FROM memories
        WHERE channel_id = ${channelId}
          AND guild_id IS NULL
      `;
      memoriesUpdated += Number(count[0].count);
    }
  }

  logger.info(`${DRY_RUN ? '[DRY RUN] Would update' : 'Updated'} ${memoriesUpdated} memory records`);

  // Summary
  logger.info('\n=== Summary ===');
  logger.info(`Channels queried: ${allChannelIds.size}`);
  logger.info(`Guild IDs found: ${channelToGuild.size}`);
  logger.info(`Conversation history records updated: ${conversationUpdated}`);
  logger.info(`Memory records updated: ${memoriesUpdated}`);
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

  await client.destroy();
  await prisma.$disconnect();
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
