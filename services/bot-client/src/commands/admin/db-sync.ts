/**
 * Admin DB Sync Subcommand
 * Handles /admin db-sync
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS, TEXT_LIMITS } from '@tzurot/common-types';
import { adminPostJson } from '../../utils/adminApiClient.js';

const logger = createLogger('admin-db-sync');

interface SyncResult {
  schemaVersion?: string;
  stats?: Record<string, { devToProd?: number; prodToDev?: number; conflicts?: number }>;
  warnings?: string[];
  changes?: unknown;
  totalPoints?: number;
  totalCollections?: number;
}

export async function handleDbSync(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  const dryRun = interaction.options.getBoolean('dry-run') ?? false;

  try {
    // Call API Gateway sync endpoint
    // (API gateway will validate that database URLs are configured)
    const response = await adminPostJson('/admin/db-sync', {
      dryRun,
      ownerId: interaction.user.id,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'DB sync failed');

      await interaction.editReply(
        `❌ Database sync failed (HTTP ${response.status}):\n\`\`\`\n${errorText}\n\`\`\``
      );
      return;
    }

    const result = (await response.json()) as SyncResult;

    // Build result embed
    const embed = new EmbedBuilder()
      .setColor(dryRun ? DISCORD_COLORS.WARNING : DISCORD_COLORS.SUCCESS)
      .setTitle(dryRun ? '🔍 Database Sync Preview (Dry Run)' : '✅ Database Sync Complete')
      .setTimestamp();

    // Add sync summary
    const summary: string[] = [];

    if (
      result.schemaVersion !== undefined &&
      result.schemaVersion !== null &&
      result.schemaVersion.length > 0
    ) {
      summary.push(`**Schema Version**: \`${result.schemaVersion}\``);
    }

    if (result.stats) {
      summary.push('\n**Sync Statistics**:');
      for (const [table, stats] of Object.entries(result.stats)) {
        summary.push(
          `\`${table}\`: ` +
            `${stats.devToProd ?? 0} dev→prod, ` +
            `${stats.prodToDev ?? 0} prod→dev` +
            (stats.conflicts !== undefined && stats.conflicts !== null && stats.conflicts > 0
              ? `, ${stats.conflicts} conflicts`
              : '')
        );
      }
    }

    if (dryRun === true && result.changes !== undefined && result.changes !== null) {
      summary.push('\n**Changes Preview**:');
      summary.push('```');
      summary.push(
        JSON.stringify(result.changes, null, 2).slice(0, TEXT_LIMITS.ADMIN_SUMMARY_TRUNCATE)
      );
      summary.push('```');
      summary.push('\n*Run without `--dry-run` to apply these changes.*');
    }

    embed.setDescription(summary.join('\n'));

    if (result.warnings && result.warnings.length > 0) {
      embed.addFields({
        name: '⚠️ Warnings',
        value: result.warnings.join('\n').slice(0, TEXT_LIMITS.DISCORD_EMBED_FIELD),
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error }, 'Error during database sync');
    await interaction.editReply(
      '❌ Error during database sync.\n' + 'Check API gateway logs for details.'
    );
  }
}

/**
 * Handle /admin servers subcommand
 */
