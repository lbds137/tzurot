/**
 * Admin: Servers Command
 * Lists all servers (guilds) the bot is currently in
 * Owner-only command
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { getConfig, createLogger } from '@tzurot/common-types';

const logger = createLogger('admin-servers');

export const data = new SlashCommandBuilder()
  .setName('admin-servers')
  .setDescription('[Owner Only] List all servers the bot is in');

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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const guilds = await interaction.client.guilds.fetch();

    if (guilds.size === 0) {
      await interaction.editReply('Bot is not in any servers.');
      return;
    }

    // Create embed with guild list
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🏠 Server List (${guilds.size} total)`)
      .setTimestamp();

    // Build guild list with details
    const guildDetails: string[] = [];

    for (const [id] of guilds) {
      // Fetch full guild data for member count
      const guild = await interaction.client.guilds.fetch(id);
      const memberCount = guild.memberCount;
      const owner = await guild.fetchOwner();

      guildDetails.push(
        `**${guild.name}**\n` +
        `├ ID: \`${guild.id}\`\n` +
        `├ Owner: ${owner.user.tag}\n` +
        `├ Members: ${memberCount.toLocaleString()}\n` +
        `└ Joined: <t:${Math.floor((guild.joinedTimestamp || 0) / 1000)}:R>`
      );
    }

    // Discord embeds have a 4096 character limit for description
    // If we have too many servers, split into multiple embeds
    const maxCharsPerEmbed = 4000;
    let currentDescription = '';
    const embeds = [embed];

    for (const detail of guildDetails) {
      if ((currentDescription + detail).length > maxCharsPerEmbed) {
        // Current embed is full, create a new one
        embeds[embeds.length - 1].setDescription(currentDescription);

        const nextEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTimestamp();

        embeds.push(nextEmbed);
        currentDescription = detail + '\n\n';
      } else {
        currentDescription += detail + '\n\n';
      }
    }

    // Set description for the last embed
    embeds[embeds.length - 1].setDescription(currentDescription);

    // Footer on last embed only
    embeds[embeds.length - 1].setFooter({
      text: `Use /admin-kick <server_id> to remove bot from a server`
    });

    await interaction.editReply({ embeds });

  } catch (error) {
    logger.error({ err: error }, 'Error fetching server list');
    await interaction.editReply('❌ Error fetching server list.');
  }
}
