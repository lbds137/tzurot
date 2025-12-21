/**
 * Admin Servers Subcommand
 * Handles /admin servers
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types';
import { escapeMarkdown } from '../../utils/markdownUtils.js';

const logger = createLogger('admin-servers');

export async function handleServers(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  try {
    const guilds = interaction.client.guilds.cache;

    if (guilds.size === 0) {
      await interaction.editReply('Bot is not in any servers.');
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

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error }, 'Error listing servers');
    await interaction.editReply('❌ Failed to retrieve server list.');
  }
}

/**
 * Handle /admin kick subcommand
 */
