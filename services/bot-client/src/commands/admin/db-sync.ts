/**
 * Admin DB Sync Subcommand
 * Handles /admin db-sync
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 *
 * Output shape: a tight summary embed (totals + tables with activity) plus the
 * FULL untruncated report — per-table stats, row-level deletion detail, every
 * warning and info line — rendered inline as chunked ephemeral follow-ups
 * (owner decision: readable text never ships as a file download; house
 * pattern: /inspect's chunked views). Discord embed caps forced the old
 * single-embed layout to truncate lists; chunking has no such limit.
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { adminDbSyncOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { clientsFor } from '../../utils/gatewayClients.js';
import { escapeFenceBreaks } from '../../utils/fenceEscape.js';
import { sendChunkedReply } from '../../utils/chunkedReply.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-db-sync');

interface TableStats {
  devToProd?: number;
  prodToDev?: number;
  conflicts?: number;
  deleted?: number;
}

interface DeletionDetail {
  table: string;
  rowKey: string;
  target: 'dev' | 'prod';
}

interface SyncResult {
  timestamp?: string;
  schemaVersion?: string;
  stats?: Record<string, TableStats>;
  warnings?: string[];
  info?: string[];
  deletions?: DeletionDetail[];
  deletionsTruncated?: boolean;
}

function sumCounters(stats: Record<string, TableStats>): Required<TableStats> {
  const totals = { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 };
  for (const s of Object.values(stats)) {
    totals.devToProd += s.devToProd ?? 0;
    totals.prodToDev += s.prodToDev ?? 0;
    totals.conflicts += s.conflicts ?? 0;
    totals.deleted += s.deleted ?? 0;
  }
  return totals;
}

function hasActivity(s: TableStats): boolean {
  return (
    (s.devToProd ?? 0) > 0 ||
    (s.prodToDev ?? 0) > 0 ||
    (s.conflicts ?? 0) > 0 ||
    (s.deleted ?? 0) > 0
  );
}

/** Embed-cap backstop: the active-table list is otherwise unbounded as the
 * synced-table set grows; the chunked follow-up report is the full surface. */
const ACTIVE_TABLE_LINES_MAX = 30;

/** One `table: N dev→prod, M prod→dev[, ...]` line per table with activity. */
function buildActiveTableLines(stats: Record<string, TableStats>): string[] {
  const active = Object.entries(stats).filter(([, s]) => hasActivity(s));
  if (active.length === 0) {
    return ['', 'No changes — databases already in sync.'];
  }
  const lines = [''];
  for (const [table, s] of active.slice(0, ACTIVE_TABLE_LINES_MAX)) {
    const conflicts = (s.conflicts ?? 0) > 0 ? `, ${s.conflicts} conflicts` : '';
    const deleted = (s.deleted ?? 0) > 0 ? `, ${s.deleted} deleted` : '';
    lines.push(
      `\`${table}\`: ${s.devToProd ?? 0} dev→prod, ${s.prodToDev ?? 0} prod→dev${conflicts}${deleted}`
    );
  }
  if (active.length > ACTIVE_TABLE_LINES_MAX) {
    lines.push(`_…and ${active.length - ACTIVE_TABLE_LINES_MAX} more — see the report below._`);
  }
  return lines;
}

/**
 * The tight embed description: totals line + tables with activity only.
 * Full per-table detail (including quiet tables) lives in the chunked
 * follow-up report, so the embed can never outgrow Discord's description cap.
 */
export function buildSyncSummary(result: SyncResult, dryRun: boolean): string {
  const lines: string[] = [];

  if (result.schemaVersion !== undefined && result.schemaVersion.length > 0) {
    lines.push(`**Schema Version**: \`${result.schemaVersion}\``);
  }

  const stats = result.stats ?? {};
  const tableCount = Object.keys(stats).length;
  if (tableCount > 0) {
    const totals = sumCounters(stats);
    lines.push(
      '',
      `**${tableCount} tables** · ${totals.devToProd} dev→prod · ${totals.prodToDev} prod→dev · ${totals.conflicts} conflicts · ${totals.deleted} deleted`
    );
    lines.push(...buildActiveTableLines(stats));
  }

  const warningCount = result.warnings?.length ?? 0;
  if (warningCount > 0) {
    lines.push('', `⚠️ ${warningCount} warning(s) — full list in the report below`);
  }
  if (dryRun) {
    lines.push('', '*Dry run — no changes were applied.*');
  }

  return lines.join('\n');
}

/** The `## Per-table stats` section — every table, active or not. Fixed-width
 * rows in a code fence: Discord doesn't render markdown pipe-tables, and the
 * fence keeps columns aligned on mobile (same solve as /inspect's memory
 * inspector). */
function buildStatsSection(stats: Record<string, TableStats>): string[] {
  const entries = Object.entries(stats);
  const lines = ['', '## Per-table stats', ''];
  if (entries.length === 0) {
    lines.push('_No table stats returned._');
    return lines;
  }
  const tableWidth = Math.max(5, ...entries.map(([table]) => table.length));
  lines.push('```');
  lines.push(`${'Table'.padEnd(tableWidth)} dev→prod prod→dev conflicts deleted`);
  for (const [table, s] of entries) {
    lines.push(
      `${table.padEnd(tableWidth)} ${String(s.devToProd ?? 0).padStart(8)} ${String(s.prodToDev ?? 0).padStart(8)} ${String(s.conflicts ?? 0).padStart(9)} ${String(s.deleted ?? 0).padStart(7)}`
    );
  }
  lines.push('```');
  return lines;
}

/** The row-level deletions section, with dry-run framing and cap notes. */
function buildDeletionsSection(result: SyncResult, dryRun: boolean): string[] {
  const deletions = result.deletions ?? [];
  const heading = dryRun ? 'Deletions that would propagate' : 'Deletions queued for propagation';
  const capped = result.deletionsTruncated === true;
  const lines = ['', `## ${heading} (${deletions.length}${capped ? '+' : ''})`, ''];
  if (deletions.length === 0) {
    lines.push('None.');
    return lines;
  }
  for (const d of deletions) {
    // rowKeys are UUID surrogates today; the escape neutralizes 3+ backtick
    // runs (fence opens / splitMessage mis-pairing). A future free-text pk
    // with SINGLE backticks could still end the inline-code span early —
    // cosmetic only, revisit if a non-UUID pk ever joins SYNC_CONFIG.
    lines.push(`- \`${d.table}\` · \`${escapeFenceBreaks(d.rowKey)}\` → ${d.target}`);
  }
  if (capped) {
    lines.push(
      '',
      '_Row detail capped by the gateway; the per-table Deleted counts above are complete._'
    );
  }
  if (!dryRun) {
    lines.push(
      '',
      '_Rows listed were queued; the per-table Deleted counts reflect what actually executed (a propagation warning explains any gap)._'
    );
  }
  return lines;
}

/** A counted `## <title> (N)` bullet-list section; explicit `None.` when empty. */
function buildListSection(title: string, items: string[]): string[] {
  const lines = ['', `## ${title} (${items.length})`, ''];
  if (items.length === 0) {
    lines.push('None.');
    return lines;
  }
  for (const item of items) {
    // Warnings/info carry table names and row detail — content-derived text
    lines.push(`- ${escapeFenceBreaks(item)}`);
  }
  return lines;
}

/**
 * The full untruncated report sent inline below the summary embed: every
 * table's stats row, row-level deletion detail, and the complete
 * warnings/info lists. Exported for unit tests.
 */
export function buildSyncReportText(result: SyncResult, dryRun: boolean): string {
  const lines: string[] = [`# Database Sync Report${dryRun ? ' (dry run)' : ''}`, ''];

  lines.push(`- Run: ${result.timestamp ?? new Date().toISOString()}`);
  lines.push(`- Mode: ${dryRun ? 'DRY RUN — no changes applied' : 'LIVE'}`);
  if (result.schemaVersion !== undefined && result.schemaVersion.length > 0) {
    lines.push(`- Schema version: ${result.schemaVersion}`);
  }

  lines.push(...buildStatsSection(result.stats ?? {}));
  lines.push(...buildDeletionsSection(result, dryRun));
  lines.push(...buildListSection('Warnings', result.warnings ?? []));
  lines.push(...buildListSection('Info', result.info ?? []));

  lines.push('');
  return lines.join('\n');
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

    // `DbSyncResponse` (tightened, enumerated schema) is structurally
    // assignable to the lenient display interface above — annotated
    // assignment, no type assertion. SyncResult keeps every field optional
    // so the render guards read naturally.
    const result: SyncResult = apiResult.data;

    const embed = new EmbedBuilder()
      .setColor(dryRun ? DISCORD_COLORS.WARNING : DISCORD_COLORS.SUCCESS)
      .setTitle(dryRun ? '🔍 Database Sync Preview (Dry Run)' : '✅ Database Sync Complete')
      .setTimestamp()
      .setDescription(buildSyncSummary(result, dryRun));

    await context.editReply({ embeds: [embed] });

    // Full report flows below the summary as chunked ephemeral follow-ups —
    // 'followUp' mode leaves the embed message untouched. Report delivery
    // failing must not reach the outer catch: the sync itself already
    // succeeded, so "Database sync failed" would be a false claim.
    try {
      await sendChunkedReply({
        interaction: context,
        content: buildSyncReportText(result, dryRun),
        header: '',
        continuedHeader: '_(report continued)_\n',
        via: 'followUp',
      });
    } catch (error) {
      logger.error({ err: error }, 'Sync succeeded but report delivery failed');
      // The recovery notice failing too must ALSO not reach the outer catch —
      // it would report "sync failed" for a sync that succeeded. Nothing is
      // left to tell the user at that point except the log.
      await context
        .followUp({
          content: '⚠️ Full report delivery failed part-way — the summary above is complete.',
          flags: MessageFlags.Ephemeral,
        })
        .catch((followUpError: unknown) => {
          logger.error({ err: followUpError }, 'Report-failure notice also failed to send');
        });
    }
  } catch (error) {
    logger.error({ err: error }, 'Error during database sync');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'database sync', { failedAction: 'run the database sync' })
      ),
    });
  }
}
