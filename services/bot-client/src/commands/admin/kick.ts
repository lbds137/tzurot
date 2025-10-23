/**
 * Admin: Kick Command
 * Forcefully removes the bot from a specified server
 * Owner-only command
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getConfig, createLogger } from '@tzurot/common-types';

const logger = createLogger('admin-kick');

export const data = new SlashCommandBuilder()
  .setName('admin-kick')
  .setDescription('[Owner Only] Remove bot from a server')
  .addStringOption(option =>
    option
      .setName('server_id')
      .setDescription('The server ID to leave')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for leaving (optional)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = getConfig();
  const ownerId = config.BOT_OWNER_ID;

  // Owner-only check
  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '❌ This command is only available to the bot owner.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const serverId = interaction.options.getString('server_id', true);
  const reason = interaction.options.getString('reason') || 'Kicked by bot owner';

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Verify the guild exists
    const guild = await interaction.client.guilds.fetch(serverId).catch(() => null);

    if (!guild) {
      await interaction.editReply(`❌ Bot is not in a server with ID: \`${serverId}\``);
      return;
    }

    // Store guild info before leaving
    const guildName = guild.name;
    const memberCount = guild.memberCount;

    // Leave the guild
    await guild.leave();

    await interaction.editReply(
      `✅ Successfully left server: **${guildName}**\n` +
      `├ ID: \`${serverId}\`\n` +
      `├ Members: ${memberCount.toLocaleString()}\n` +
      `└ Reason: ${reason}`
    );

  } catch (error) {
    logger.error({ err: error }, `Error leaving guild: ${serverId}`);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply(
      `❌ Error leaving server \`${serverId}\`: ${errorMessage}`
    );
  }
}
