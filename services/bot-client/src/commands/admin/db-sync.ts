/**
 * Admin DB Sync Subcommand
 * Handles /admin db-sync
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 *
 * Output shape: a tight summary embed (totals + tables with activity) with the
 * FULL untruncated report — per-table stats, row-level deletion detail, every
 * warning and info line — hidden behind a "Show details" button by default
 * (owner call: the report should stay out of the way unless wanted). The
 * report text is stashed in Redis and revealed on click as chunked ephemeral
 * follow-ups (readable text never ships as a file download; house pattern:
 * /inspect's chunked views). When the stash is unavailable the report falls
 * back to the pre-button inline delivery, so details are never silently lost.
 *
 * The report RENDERER itself lives in `utils/dbSyncSummary.ts` — the nightly
 * scheduler attaches the same report to its owner-channel post, and a
 * `services/` module must not import from `commands/`. Which of the two
 * deliveries the summary embed promises is passed in as `ReportDelivery`.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
} from 'discord.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { adminDbSyncOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { clientsFor } from '../../utils/gatewayClients.js';
import { sendChunkedReply } from '../../utils/chunkedReply.js';
import {
  buildSyncReportText,
  buildSyncSummary,
  type ReportDelivery,
  type SyncResult,
} from '../../utils/dbSyncSummary.js';
import { storeDbSyncReport, fetchDbSyncReport } from './dbSyncReportStore.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { ackUpdate } from '../../ux/render/reply.js';

const logger = createLogger('admin-db-sync');

/** Custom-id prefix for the details reveal (command::action::id per 04-discord). */
const DB_SYNC_DETAILS_PREFIX = 'admin-dbsync::details::';

/** Pure prefix check — safe to run before the ack. */
export function isDbSyncDetailsButton(customId: string): boolean {
  return customId.startsWith(DB_SYNC_DETAILS_PREFIX);
}

/**
 * "Show details" click: reveal the stashed full report as chunked ephemeral
 * follow-ups. The report stays available until the stash TTL — re-clicking
 * re-shows it, which is harmless and saves one-shot bookkeeping.
 */
export async function handleDbSyncDetailsButton(interaction: ButtonInteraction): Promise<void> {
  // Ack FIRST (04-discord) — the Redis fetch happens after.
  await ackUpdate(interaction);

  const key = interaction.customId.slice(DB_SYNC_DETAILS_PREFIX.length);
  const report = await fetchDbSyncReport(key);
  if (report === null) {
    await interaction.followUp({
      content: '⏰ This report has expired — re-run `/admin db-sync` for fresh details.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Same guard as handleDbSync's inline fallback: a first-chunk delivery
  // failure must not escape to CommandHandler's catch-all — its recovery
  // editReply (after a deferUpdate ack) would clobber the still-valid summary
  // embed with a generic error. Log + best-effort notice instead.
  try {
    await sendChunkedReply({
      interaction,
      content: report,
      header: '',
      continuedHeader: '_(report continued)_\n',
      via: 'followUp',
    });
  } catch (error) {
    logger.error({ err: error }, 'Details reveal delivery failed');
    await interaction
      .followUp({
        content: '⚠️ Report delivery failed — try the button again.',
        flags: MessageFlags.Ephemeral,
      })
      .catch((noticeError: unknown) => {
        logger.debug({ err: noticeError }, 'Reveal-failure notice also failed to send');
      });
  }
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

    // Default view is the embed alone; the full report hides behind a
    // "Show details" button (owner call: it should stay out of the way unless
    // wanted). The report text is stashed in Redis and the button carries the
    // key — a failed stash falls back to the pre-button inline delivery so
    // the details are never silently lost.
    //
    // The stash attempt comes BEFORE the embed because it decides which
    // delivery the summary's "see the report …" sentences may promise.
    const reportText = buildSyncReportText(result, dryRun);
    const reportKey = await storeDbSyncReport(reportText);
    const delivery: ReportDelivery = reportKey !== null ? 'button' : 'below';

    const embed = new EmbedBuilder()
      .setColor(dryRun ? DISCORD_COLORS.WARNING : DISCORD_COLORS.SUCCESS)
      .setTitle(dryRun ? '🔍 Database Sync Preview (Dry Run)' : '✅ Database Sync Complete')
      .setTimestamp()
      .setDescription(buildSyncSummary(result, dryRun, delivery));

    if (reportKey !== null) {
      const detailsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${DB_SYNC_DETAILS_PREFIX}${reportKey}`)
          .setLabel('Show details')
          .setEmoji('📄')
          .setStyle(ButtonStyle.Secondary)
      );
      await context.editReply({ embeds: [embed], components: [detailsRow] });
      return;
    }

    await context.editReply({ embeds: [embed] });

    // Stash unavailable: full report flows below the summary as chunked
    // ephemeral follow-ups — 'followUp' mode leaves the embed message
    // untouched. Report delivery failing must not reach the outer catch: the
    // sync itself already succeeded, so "Database sync failed" would be a
    // false claim.
    try {
      await sendChunkedReply({
        interaction: context,
        content: reportText,
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
