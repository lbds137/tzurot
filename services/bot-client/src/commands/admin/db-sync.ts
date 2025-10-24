/**
 * Admin: Database Sync Command
 * Performs bidirectional database synchronization between dev and prod environments
 * Owner-only command
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { getConfig, createLogger } from '@tzurot/common-types';

const logger = createLogger('admin-db-sync');

interface SyncResult {
  schemaVersion?: string;
  stats?: Record<string, { devToProd?: number; prodToDev?: number; conflicts?: number }>;
  warnings?: string[];
  changes?: unknown;
}

export const data = new SlashCommandBuilder()
  .setName('admin-db-sync')
  .setDescription('[Owner Only] Sync database between dev and prod environments')
  .addBooleanOption(option =>
    option
      .setName('dry-run')
      .setDescription('Show what would be synced without making changes')
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

  const dryRun = interaction.options.getBoolean('dry-run') ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Validate that database URLs are configured
    if (!config.DEV_DATABASE_URL || !config.PROD_DATABASE_URL) {
      await interaction.editReply(
        '❌ Database sync not configured.\n\n' +
        'Both `DEV_DATABASE_URL` and `PROD_DATABASE_URL` environment variables must be set.\n' +
        'See `.env.example` for configuration details.'
      );
      return;
    }

    // Call API Gateway sync endpoint
    const gatewayUrl = config.API_GATEWAY_URL || config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/db-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dryRun,
        ownerId, // For authorization
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
      summary.push(JSON.stringify(result.changes, null, 2).slice(0, 1000)); // Limit preview
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
