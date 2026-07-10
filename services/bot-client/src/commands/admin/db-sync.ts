/**
 * Admin DB Sync Subcommand
 * Handles /admin db-sync
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { EmbedBuilder } from 'discord.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { DISCORD_COLORS, TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { adminDbSyncOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { clientsFor } from '../../utils/gatewayClients.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-db-sync');

interface SyncResult {
  schemaVersion?: string;
  stats?: Record<
    string,
    { devToProd?: number; prodToDev?: number; conflicts?: number; deleted?: number }
  >;
  warnings?: string[];
  info?: string[];
  changes?: unknown;
  totalPoints?: number;
  totalCollections?: number;
}

/**
 * Build the truncation suffix line emitted when a list overflows the embed
 * field limit. Returns the bare suffix string with no surrounding whitespace —
 * the caller is responsible for any leading newline that separates the suffix
 * from surviving items.
 */
function buildTruncationSuffix(omittedCount: number): string {
  return `…and ${omittedCount} more`;
}

/**
 * Format an array of strings as a newline-joined embed-field value, dropping
 * trailing items at line boundaries until the result fits within `fieldLimit`.
 *
 * Without this helper, a naive `.join('\n').slice(0, 1024)` chops mid-string —
 * the last entry visible to the user is silently truncated and any items past
 * the cut are invisible. The reader can't tell whether they're seeing the full
 * list or a fragment. With this helper, surviving items are intact and the
 * overflow is explicitly counted in the trailing `…and N more` line.
 *
 * **Precondition**: `fieldLimit` must exceed the maximum suffix length (a few
 * dozen bytes — `…and <count> more`). True in practice with Discord's 1024
 * embed-field cap; pathologically small limits (e.g., `fieldLimit < 30`) may
 * produce output that exceeds `fieldLimit`. No real caller violates this.
 */
export function formatListForEmbedField(items: readonly string[], fieldLimit: number): string {
  if (items.length === 0) {
    return '';
  }
  const joined = items.join('\n');
  if (joined.length <= fieldLimit) {
    return joined;
  }

  // Drop items from the tail until we have enough room for the survivors plus
  // a "…and N more" suffix. We size the suffix against the worst case (all
  // items omitted) up front so the loop's budget never tightens further as
  // omittedCount grows.
  const worstCaseSuffix = `\n${buildTruncationSuffix(items.length)}`;
  const survivorBudget = fieldLimit - worstCaseSuffix.length;

  const survivors: string[] = [];
  let runningLength = 0;
  for (const item of items) {
    const nextLength = runningLength === 0 ? item.length : runningLength + 1 + item.length;
    if (nextLength > survivorBudget) {
      break;
    }
    survivors.push(item);
    runningLength = nextLength;
  }
  const omittedCount = items.length - survivors.length;
  const survivorJoin = survivors.join('\n');
  return survivors.length === 0
    ? buildTruncationSuffix(omittedCount)
    : `${survivorJoin}\n${buildTruncationSuffix(omittedCount)}`;
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
      const deleted =
        stats.deleted !== undefined && stats.deleted !== null && stats.deleted > 0
          ? `, ${stats.deleted} deleted`
          : '';
      const conflicts =
        stats.conflicts !== undefined && stats.conflicts !== null && stats.conflicts > 0
          ? `, ${stats.conflicts} conflicts`
          : '';
      summary.push(
        `\`${table}\`: ${stats.devToProd ?? 0} dev→prod, ${stats.prodToDev ?? 0} prod→dev${conflicts}${deleted}`
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
  const options = adminDbSyncOptions(context.interaction);
  const dryRun = options['dry-run']() ?? false;
  const allowSchemaSkew = options['allow-schema-skew']() ?? false;

  try {
    const { ownerClient } = clientsFor(context.interaction);
    const apiResult = await ownerClient.dbSync({ dryRun, allowSchemaSkew });

    if (!apiResult.ok) {
      logger.error({ status: apiResult.status, error: apiResult.error }, 'DB sync failed');

      await context.editReply({
        content: renderSpec(
          CATALOG.error.validation(
            `Database sync failed (HTTP ${apiResult.status}):\n\`\`\`\n${apiResult.error}\n\`\`\``
          )
        ),
      });
      return;
    }

    // `DbSyncResponse` (now a tightened, enumerated schema) is structurally
    // assignable to the lenient display interface below — annotated assignment,
    // no type assertion. SyncResult keeps every field optional so the truthy
    // guards in buildSyncSummary read naturally.
    const result: SyncResult = apiResult.data;

    // Build result embed
    const embed = new EmbedBuilder()
      .setColor(dryRun ? DISCORD_COLORS.WARNING : DISCORD_COLORS.SUCCESS)
      .setTitle(dryRun ? '🔍 Database Sync Preview (Dry Run)' : '✅ Database Sync Complete')
      .setTimestamp()
      .setDescription(buildSyncSummary(result, dryRun));

    if (result.warnings && result.warnings.length > 0) {
      embed.addFields({
        name: '⚠️ Warnings',
        value: formatListForEmbedField(result.warnings, TEXT_LIMITS.DISCORD_EMBED_FIELD),
      });
    }

    if (result.info && result.info.length > 0) {
      embed.addFields({
        name: 'ℹ️ Excluded Tables',
        value: formatListForEmbedField(result.info, TEXT_LIMITS.DISCORD_EMBED_FIELD),
      });
    }

    await context.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error }, 'Error during database sync');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'database sync', { failedAction: 'run the database sync' })
      ),
    });
  }
}

/**
 * Handle /admin servers subcommand
 */
