/**
 * Admin: Usage Command
 * Shows API usage and cost information
 * Owner-only command
 *
 * TODO: Implement actual usage tracking
 * For now, shows basic bot statistics
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { getConfig, createLogger } from '@tzurot/common-types';

const logger = createLogger('admin-usage');

export const data = new SlashCommandBuilder()
  .setName('admin-usage')
  .setDescription('[Owner Only] View bot usage statistics');

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
    const client = interaction.client;

    // Calculate uptime
    const uptimeMs = client.uptime || 0;
    const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
    const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

    const uptimeString = `${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`;

    // Get guild and user counts
    const guildCount = client.guilds.cache.size;
    let totalMembers = 0;

    for (const guild of client.guilds.cache.values()) {
      totalMembers += guild.memberCount;
    }

    // Memory usage
    const memoryUsage = process.memoryUsage();
    const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const memoryTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Bot Usage Statistics')
      .setDescription('Current bot statistics and resource usage')
      .addFields(
        {
          name: '⏱️ Uptime',
          value: uptimeString,
          inline: true
        },
        {
          name: '🏠 Servers',
          value: guildCount.toLocaleString(),
          inline: true
        },
        {
          name: '👥 Total Users',
          value: totalMembers.toLocaleString(),
          inline: true
        },
        {
          name: '💾 Memory Usage',
          value: `${memoryMB} MB / ${memoryTotalMB} MB`,
          inline: true
        },
        {
          name: '🌐 WebSocket Ping',
          value: `${client.ws.ping}ms`,
          inline: true
        },
        {
          name: '📡 Status',
          value: client.ws.status === 0 ? '✅ Ready' : `⚠️ ${client.ws.status}`,
          inline: true
        }
      )
      .setFooter({
        text: '⚠️ API cost tracking not yet implemented'
      })
      .setTimestamp();

    // TODO: Add actual usage tracking
    // - API calls per server/user
    // - Estimated costs
    // - Token usage
    // - Rate limit status

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error({ err: error }, 'Error fetching usage statistics');
    await interaction.editReply('❌ Error fetching usage statistics.');
  }
}
