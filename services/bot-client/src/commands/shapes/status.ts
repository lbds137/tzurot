/**
 * Shapes Status Subcommand
 *
 * Shows credential status, import history, and export history for shapes.inc.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  formatImportJobStatus,
  formatExportJobStatus,
  adaptImportJob,
  adaptExportJob,
} from './statusFormatters.js';

const logger = createLogger('shapes-status');

/**
 * Handle /shapes status subcommand
 * Shows credential status, import history, and export history
 */
export async function handleStatus(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    // Fetch auth status, import history, and export history in parallel
    const { userClient } = clientsFor(context.interaction);
    const [authResult, importJobsResult, exportJobsResult] = await Promise.all([
      userClient.getShapesAuthStatus(),
      userClient.listShapesImportJobs(),
      userClient.listShapesExportJobs(),
    ]);

    const hasCredentials = authResult.ok && authResult.data.hasCredentials;

    const embed = new EmbedBuilder()
      .setColor(hasCredentials ? DISCORD_COLORS.SUCCESS : DISCORD_COLORS.WARNING)
      .setTitle('\uD83D\uDD17 Shapes.inc Status')
      .setTimestamp();

    // Credential status
    const credentialStatus = hasCredentials
      ? '\u2705 Authenticated \u2014 credentials stored securely'
      : '\u274C Not authenticated \u2014 use `/shapes auth` to connect';
    embed.addFields({ name: 'Credentials', value: credentialStatus });

    // Import history — distinguish "fetch failed" from "genuinely empty" so a
    // transient gateway error (503/auth drop) doesn't masquerade as "no imports
    // yet" and make a user think their history vanished.
    if (!importJobsResult.ok) {
      logger.warn(
        { userId, status: importJobsResult.status, error: importJobsResult.error },
        'Failed to load shapes import history'
      );
      embed.addFields({
        name: 'Import History',
        value: '⚠️ Could not load import history right now. Please try again in a moment.',
      });
    } else if (importJobsResult.data.jobs.length > 0) {
      const jobLines = importJobsResult.data.jobs
        .slice(0, 5)
        .map(adaptImportJob)
        .map(formatImportJobStatus);
      embed.addFields({
        name: `Import History (${importJobsResult.data.jobs.length})`,
        value: jobLines.join('\n\n'),
      });
    } else {
      embed.addFields({
        name: 'Import History',
        value: 'No imports yet. Use `/shapes import <slug>` to get started.',
      });
    }

    // Export history — same fetch-failed vs. empty distinction as imports.
    if (!exportJobsResult.ok) {
      logger.warn(
        { userId, status: exportJobsResult.status, error: exportJobsResult.error },
        'Failed to load shapes export history'
      );
      embed.addFields({
        name: 'Export History',
        value: '⚠️ Could not load export history right now. Please try again in a moment.',
      });
    } else if (exportJobsResult.data.jobs.length > 0) {
      const jobLines = exportJobsResult.data.jobs
        .slice(0, 5)
        .map(adaptExportJob)
        .map(formatExportJobStatus);
      embed.addFields({
        name: `Export History (${exportJobsResult.data.jobs.length})`,
        value: jobLines.join('\n\n'),
      });
    } else {
      embed.addFields({
        name: 'Export History',
        value: 'No exports yet. Use `/shapes export <slug>` to get started.',
      });
    }

    await context.editReply({ embeds: [embed] });

    logger.debug({ userId, hasCredentials }, 'Status displayed');
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error fetching status');
    await context.editReply({ content: '\u274C An unexpected error occurred. Please try again.' });
  }
}
