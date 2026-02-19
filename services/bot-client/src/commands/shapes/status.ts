/**
 * Shapes Status Subcommand
 *
 * Shows credential status, import history, and export history for shapes.inc.
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';
import {
  formatImportJobStatus,
  formatExportJobStatus,
  type ImportJobsResponse,
  type ExportJobsResponse,
} from './statusFormatters.js';

const logger = createLogger('shapes-status');

interface AuthStatusResponse {
  hasCredentials: boolean;
  service: string;
  storedAt?: string;
  lastUsedAt?: string;
}

/**
 * Handle /shapes status subcommand
 * Shows credential status, import history, and export history
 */
export async function handleStatus(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    // Fetch auth status, import history, and export history in parallel
    const [authResult, importJobsResult, exportJobsResult] = await Promise.all([
      callGatewayApi<AuthStatusResponse>('/user/shapes/auth/status', {
        userId,
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }),
      callGatewayApi<ImportJobsResponse>('/user/shapes/import/jobs', {
        userId,
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }),
      callGatewayApi<ExportJobsResponse>('/user/shapes/export/jobs', {
        userId,
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      }),
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

    // Import history
    if (importJobsResult.ok && importJobsResult.data.jobs.length > 0) {
      const jobLines = importJobsResult.data.jobs.slice(0, 5).map(formatImportJobStatus);
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

    // Export history
    if (exportJobsResult.ok && exportJobsResult.data.jobs.length > 0) {
      const jobLines = exportJobsResult.data.jobs.slice(0, 5).map(formatExportJobStatus);
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

    logger.debug({ userId, hasCredentials }, '[Shapes] Status displayed');
  } catch (error) {
    logger.error({ err: error, userId }, '[Shapes] Unexpected error fetching status');
    await context.editReply({ content: '\u274C An unexpected error occurred. Please try again.' });
  }
}
