/**
 * Admin Servers Subcommand
 * Handles /admin servers
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { createLogger, DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-servers');

export async function handleServers(context: DeferredCommandContext): Promise<void> {
  try {
    const guilds = context.interaction.client.guilds.cache;

    if (guilds.size === 0) {
      await context.editReply({ content: 'Bot is not in any servers.' });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.BLURPLE)
      .setTitle(`📋 Server List (${guilds.size} total)`)
      .setTimestamp();

    const serverList = guilds
      .map(guild => {
        const memberCount = guild.memberCount || 'Unknown';
        return `**${escapeMarkdown(guild.name)}**\nID: \`${guild.id}\`\nMembers: ${memberCount}`;
      })
      .join('\n\n');

    // Discord embed description has a character limit
    // Use safety margin to leave room for truncation message
    const SAFETY_MARGIN = 96;
    if (serverList.length > DISCORD_LIMITS.EMBED_DESCRIPTION - SAFETY_MARGIN) {
      const truncated = serverList.substring(0, DISCORD_LIMITS.EMBED_DESCRIPTION - 196);
      embed.setDescription(truncated + '\n\n*... (list truncated)*');
    } else {
      embed.setDescription(serverList);
    }

    await context.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error }, 'Error listing servers');
    await context.editReply({ content: '❌ Failed to retrieve server list.' });
  }
}

/**
 * Handle /admin kick subcommand
 */
