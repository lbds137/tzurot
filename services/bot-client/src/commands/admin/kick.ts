/**
 * Admin Kick Subcommand
 * Handles /admin kick
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('admin-kick');

export async function handleKick(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  const serverId = interaction.options.getString('server-id', true);

  try {
    const guild = interaction.client.guilds.cache.get(serverId);

    if (!guild) {
      await interaction.editReply(
        `❌ Bot is not in a server with ID \`${serverId}\`.\n\n` +
          'Use `/admin servers` to see a list of all servers.'
      );
      return;
    }

    const serverName = guild.name;

    await guild.leave();

    await interaction.editReply(`✅ Successfully left server: **${serverName}** (\`${serverId}\`)`);

    logger.info(
      `[Admin] Left server: ${serverName} (${serverId}) by request of ${interaction.user.tag}`
    );
  } catch (error) {
    logger.error({ err: error }, `Error leaving server ${serverId}`);
    await interaction.editReply(
      `❌ Failed to leave server \`${serverId}\`.\n\n` +
        'The server may no longer exist or bot may lack permissions.'
    );
  }
}

/**
 * Handle /admin usage subcommand
 */
