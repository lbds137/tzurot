/**
 * Shapes Detail View
 *
 * Builds the detail embed for a single shape, showing import/export
 * job status and action buttons. The slug is stored in the embed footer
 * to stay within Discord's 100-char custom ID limit.
 */

import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';
import { ShapesCustomIds } from '../../utils/customIds.js';
import {
  formatCompactImportStatus,
  formatCompactExportStatus,
  type ImportJob,
  type ExportJob,
  type ImportJobsResponse,
  type ExportJobsResponse,
} from './statusFormatters.js';

const logger = createLogger('shapes-detail');

interface JobStatus {
  latestImport: ImportJob | null;
  latestExport: ExportJob | null;
}

/** Fetch the latest import and export job for a specific slug */
async function fetchJobStatusForSlug(userId: string, slug: string): Promise<JobStatus> {
  const [importResult, exportResult] = await Promise.all([
    callGatewayApi<ImportJobsResponse>('/user/shapes/import/jobs', {
      userId,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    }),
    callGatewayApi<ExportJobsResponse>('/user/shapes/export/jobs', {
      userId,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    }),
  ]);

  let latestImport: ImportJob | null = null;
  if (importResult.ok) {
    const matching = importResult.data.jobs.filter(j => j.sourceSlug === slug);
    if (matching.length > 0) {
      latestImport = matching[0];
    }
  }

  let latestExport: ExportJob | null = null;
  if (exportResult.ok) {
    const matching = exportResult.data.jobs.filter(j => j.sourceSlug === slug);
    if (matching.length > 0) {
      latestExport = matching[0];
    }
  }

  return { latestImport, latestExport };
}

/** Build the action button rows for the detail view */
function buildDetailButtons(): ActionRowBuilder<ButtonBuilder>[] {
  // Row 1: Import + Export actions
  const importFullBtn = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.detailImport('full'))
    .setLabel('Import Full')
    .setEmoji('\uD83D\uDCE5')
    .setStyle(ButtonStyle.Primary);

  const importMemoryBtn = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.detailImport('memory_only'))
    .setLabel('Memory Only')
    .setEmoji('\uD83D\uDCE5')
    .setStyle(ButtonStyle.Primary);

  const exportJsonBtn = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.detailExport('json'))
    .setLabel('JSON')
    .setEmoji('\uD83D\uDCE4')
    .setStyle(ButtonStyle.Secondary);

  const exportMdBtn = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.detailExport('markdown'))
    .setLabel('Markdown')
    .setEmoji('\uD83D\uDCE4')
    .setStyle(ButtonStyle.Secondary);

  // Row 2: Refresh + Back
  const refreshBtn = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.detailRefresh())
    .setLabel('Refresh')
    .setEmoji('\uD83D\uDD04')
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.detailBack())
    .setLabel('Back')
    .setEmoji('\u25C0\uFE0F')
    .setStyle(ButtonStyle.Secondary);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      importFullBtn,
      importMemoryBtn,
      exportJsonBtn,
      exportMdBtn
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(refreshBtn, backBtn),
  ];
}

/**
 * Build the shape detail embed with job status and action buttons.
 *
 * @param userId - Discord user ID for fetching job status
 * @param slug - Shape slug (stored in embed footer)
 * @returns Embed and component rows ready for interaction.update() or editReply()
 */
export async function buildShapeDetailEmbed(
  userId: string,
  slug: string
): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] }> {
  let jobStatus: JobStatus;
  try {
    jobStatus = await fetchJobStatusForSlug(userId, slug);
  } catch (error) {
    logger.error({ err: error, userId, slug }, '[Shapes] Failed to fetch job status');
    jobStatus = { latestImport: null, latestExport: null };
  }

  const importLine =
    jobStatus.latestImport !== null
      ? formatCompactImportStatus(jobStatus.latestImport)
      : 'No imports yet';

  const exportLine =
    jobStatus.latestExport !== null
      ? formatCompactExportStatus(jobStatus.latestExport)
      : 'No exports yet';

  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle(`\uD83D\uDD17 ${slug}`)
    .setDescription(
      `\uD83D\uDCE5 **Import**: ${importLine}\n` +
        `\uD83D\uDCE4 **Export**: ${exportLine}\n\n` +
        'Select an action below, or refresh to check job progress.'
    )
    .setFooter({ text: `slug:${slug}` })
    .setTimestamp();

  return { embed, components: buildDetailButtons() };
}
