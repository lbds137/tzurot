/**
 * Admin DB Sync Subcommand
 * Handles /admin db-sync
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  TEXT_LIMITS,
  adminDbSyncOptions,
} from '@tzurot/common-types';
import { adminPostJson } from '../../utils/adminApiClient.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-db-sync');

interface SyncResult {
  schemaVersion?: string;
  stats?: Record<string, { devToProd?: number; prodToDev?: number; conflicts?: number }>;
  warnings?: string[];
  info?: string[];
  changes?: unknown;
  totalPoints?: number;
  totalCollections?: number;
}

/**
 * Build the summary description for the sync result embed
 */
function buildSyncSummary(result: SyncResult, dryRun: boolean): string {
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
      const conflicts =
        stats.conflicts !== undefined && stats.conflicts !== null && stats.conflicts > 0
          ? `, ${stats.conflicts} conflicts`
          : '';
      summary.push(
        `\`${table}\`: ${stats.devToProd ?? 0} dev→prod, ${stats.prodToDev ?? 0} prod→dev${conflicts}`
      );
    }
  }

  if (dryRun && result.changes !== undefined && result.changes !== null) {
    summary.push('\n**Changes Preview**:');
    summary.push('```');
    summary.push(
      JSON.stringify(result.changes, null, 2).slice(0, TEXT_LIMITS.ADMIN_SUMMARY_TRUNCATE)
    );
    summary.push('```');
    summary.push('\n*Run without `--dry-run` to apply these changes.*');
  }

  return summary.join('\n');
}

export async function handleDbSync(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = adminDbSyncOptions(context.interaction);
  const dryRun = options['dry-run']() ?? false;

  try {
    // Call API Gateway sync endpoint
    // (API gateway will validate that database URLs are configured)
    const response = await adminPostJson('/admin/db-sync', {
      dryRun,
      ownerId: userId,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'DB sync failed');

      await context.editReply({
        content: `❌ Database sync failed (HTTP ${response.status}):\n\`\`\`\n${errorText}\n\`\`\``,
      });
      return;
    }

    const result = (await response.json()) as SyncResult;

    // Build result embed
    const embed = new EmbedBuilder()
      .setColor(dryRun ? DISCORD_COLORS.WARNING : DISCORD_COLORS.SUCCESS)
      .setTitle(dryRun ? '🔍 Database Sync Preview (Dry Run)' : '✅ Database Sync Complete')
      .setTimestamp()
      .setDescription(buildSyncSummary(result, dryRun));

    if (result.warnings && result.warnings.length > 0) {
      embed.addFields({
        name: '⚠️ Warnings',
        value: result.warnings.join('\n').slice(0, TEXT_LIMITS.DISCORD_EMBED_FIELD),
      });
    }

    if (result.info && result.info.length > 0) {
      embed.addFields({
        name: 'ℹ️ Excluded Tables',
        value: result.info.join('\n').slice(0, TEXT_LIMITS.DISCORD_EMBED_FIELD),
      });
    }

    await context.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error }, 'Error during database sync');
    await context.editReply({
      content: '❌ Error during database sync.\nCheck API gateway logs for details.',
    });
  }
}

/**
 * Handle /admin servers subcommand
 */
