/**
 * Admin Command Group
 * Groups all admin commands under /admin with subcommands
 * Owner-only commands for bot administration
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { getConfig, createLogger } from '@tzurot/common-types';

const logger = createLogger('admin-command');

interface SyncResult {
  schemaVersion?: string;
  stats?: Record<string, { devToProd?: number; prodToDev?: number; conflicts?: number }>;
  warnings?: string[];
  changes?: unknown;
}

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Admin commands (Owner only)')
  .addSubcommand(subcommand =>
    subcommand
      .setName('db-sync')
      .setDescription('Sync database between dev and prod environments')
      .addBooleanOption(option =>
        option
          .setName('dry-run')
          .setDescription('Show what would be synced without making changes')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('servers')
      .setDescription('List all servers the bot is in')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('kick')
      .setDescription('Remove bot from a server')
      .addStringOption(option =>
        option
          .setName('server-id')
          .setDescription('The ID of the server to leave')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('usage')
      .setDescription('View API usage statistics')
      .addStringOption(option =>
        option
          .setName('timeframe')
          .setDescription('Time period to view')
          .setRequired(false)
          .addChoices(
            { name: 'Last 24 hours', value: '24h' },
            { name: 'Last 7 days', value: '7d' },
            { name: 'Last 30 days', value: '30d' },
            { name: 'All time', value: 'all' }
          )
      )
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

  const subcommand = interaction.options.getSubcommand();

  // Route to appropriate handler
  switch (subcommand) {
    case 'db-sync':
      await handleDbSync(interaction, config);
      break;
    case 'servers':
      await handleServers(interaction);
      break;
    case 'kick':
      await handleKick(interaction);
      break;
    case 'usage':
      await handleUsage(interaction, config);
      break;
    default:
      await interaction.reply({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral
      });
  }
}

/**
 * Handle /admin db-sync subcommand
 */
async function handleDbSync(
  interaction: ChatInputCommandInteraction,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  const dryRun = interaction.options.getBoolean('dry-run') ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Call API Gateway sync endpoint
    // (API gateway will validate that database URLs are configured)
    const gatewayUrl = config.API_GATEWAY_URL || config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/db-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dryRun,
        ownerId: interaction.user.id,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'DB sync failed');

      await interaction.editReply(
        `❌ Database sync failed (HTTP ${response.status}):\n\`\`\`\n${errorText}\n\`\`\``
      );
      return;
    }

    const result = await response.json() as SyncResult;

    // Build result embed
    const embed = new EmbedBuilder()
      .setColor(dryRun ? 0xFFA500 : 0x00FF00)
      .setTitle(dryRun ? '🔍 Database Sync Preview (Dry Run)' : '✅ Database Sync Complete')
      .setTimestamp();

    // Add sync summary
    const summary: string[] = [];

    if (result.schemaVersion) {
      summary.push(`**Schema Version**: \`${result.schemaVersion}\``);
    }

    if (result.stats) {
      summary.push('\n**Sync Statistics**:');
      for (const [table, stats] of Object.entries(result.stats)) {
        const tableStats = stats as { devToProd?: number; prodToDev?: number; conflicts?: number };
        summary.push(
          `\`${table}\`: ` +
          `${tableStats.devToProd || 0} dev→prod, ` +
          `${tableStats.prodToDev || 0} prod→dev` +
          (tableStats.conflicts ? `, ${tableStats.conflicts} conflicts` : '')
        );
      }
    }

    if (dryRun && result.changes) {
      summary.push('\n**Changes Preview**:');
      summary.push('```');
      summary.push(JSON.stringify(result.changes, null, 2).slice(0, 1000));
      summary.push('```');
      summary.push('\n*Run without `--dry-run` to apply these changes.*');
    }

    embed.setDescription(summary.join('\n'));

    if (result.warnings && result.warnings.length > 0) {
      embed.addFields({
        name: '⚠️ Warnings',
        value: result.warnings.join('\n').slice(0, 1024),
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error({ err: error }, 'Error during database sync');
    await interaction.editReply(
      '❌ Error during database sync.\n' +
      'Check API gateway logs for details.'
    );
  }
}

/**
 * Handle /admin servers subcommand
 */
async function handleServers(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const guilds = interaction.client.guilds.cache;

    if (guilds.size === 0) {
      await interaction.editReply('Bot is not in any servers.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📋 Server List (${guilds.size} total)`)
      .setTimestamp();

    const serverList = guilds.map(guild => {
      const memberCount = guild.memberCount || 'Unknown';
      return `**${guild.name}**\nID: \`${guild.id}\`\nMembers: ${memberCount}`;
    }).join('\n\n');

    // Discord embed description has a 4096 character limit
    if (serverList.length > 4000) {
      const truncated = serverList.substring(0, 3900);
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
async function handleKick(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.options.getString('server-id', true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    await interaction.editReply(
      `✅ Successfully left server: **${serverName}** (\`${serverId}\`)`
    );

    logger.info(`[Admin] Left server: ${serverName} (${serverId}) by request of ${interaction.user.tag}`);

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
async function handleUsage(
  interaction: ChatInputCommandInteraction,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  const timeframe = interaction.options.getString('timeframe') || '7d';

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const gatewayUrl = config.API_GATEWAY_URL || config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/usage?timeframe=${timeframe}`, {
      headers: {
        'X-Owner-Id': interaction.user.id,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Usage query failed');

      await interaction.editReply(
        `❌ Failed to retrieve usage statistics (HTTP ${response.status}):\n\`\`\`\n${errorText}\n\`\`\``
      );
      return;
    }

    const data = await response.json();

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 API Usage Statistics')
      .setDescription(`Timeframe: **${timeframe}**`)
      .setTimestamp();

    // Add usage data fields
    if (typeof data === 'object' && data !== null) {
      const usageData = data as {
        totalRequests?: number;
        totalTokens?: number;
        estimatedCost?: number;
      };

      if (usageData.totalRequests !== undefined) {
        embed.addFields({ name: 'Total Requests', value: String(usageData.totalRequests), inline: true });
      }

      if (usageData.totalTokens !== undefined) {
        embed.addFields({ name: 'Total Tokens', value: String(usageData.totalTokens), inline: true });
      }

      if (usageData.estimatedCost !== undefined) {
        embed.addFields({ name: 'Estimated Cost', value: `$${usageData.estimatedCost.toFixed(2)}`, inline: true });
      }
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error({ err: error }, 'Error retrieving usage statistics');
    await interaction.editReply(
      '❌ Error retrieving usage statistics.\n' +
      'This feature may not be implemented yet.'
    );
  }
}
