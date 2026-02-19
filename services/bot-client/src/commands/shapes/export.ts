/**
 * Shapes Export Subcommand
 *
 * Starts an async export job for shapes.inc character data.
 * The export runs in the background via ai-worker. Users check
 * progress with /shapes status and download via the provided link.
 *
 * startExport() is also called by the detail view's export buttons
 * (interactionHandlers.ts) for button-triggered exports.
 */

import { EmbedBuilder, type MessageComponentInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';
import { sanitizeErrorForDiscord } from '../../utils/errorSanitization.js';

const logger = createLogger('shapes-export');

interface ExportJobResponse {
  success: boolean;
  exportJobId: string;
  sourceSlug: string;
  format: string;
  status: string;
  downloadUrl: string;
}

export interface ExportParams {
  slug: string;
  format: 'json' | 'markdown';
}

/**
 * Start an export job from a button interaction (detail view).
 * Acknowledges the interaction with update(), then calls the API.
 * On error, shows an error message via editReply and returns false.
 * On success, returns true — caller is responsible for showing the result.
 */
export async function startExport(
  interaction: MessageComponentInteraction,
  userId: string,
  params: ExportParams
): Promise<boolean> {
  const { slug, format } = params;

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(DISCORD_COLORS.WARNING)
        .setTitle('\u23F3 Starting Export...')
        .setDescription(`Exporting **${slug}** as ${format.toUpperCase()}...`),
    ],
    components: [],
  });

  const result = await callGatewayApi<ExportJobResponse>('/user/shapes/export', {
    method: 'POST',
    userId,
    body: { slug, format },
    timeout: GATEWAY_TIMEOUTS.DEFERRED,
  });

  if (!result.ok) {
    let message: string;
    if (result.status === 401 || result.status === 403) {
      message = '\u274C Session expired. Use `/shapes auth` to re-authenticate.';
    } else if (result.status === 409) {
      message = `\u23F3 An export for **${slug}** is already in progress.`;
    } else {
      message = `\u274C Export failed: ${sanitizeErrorForDiscord(result.error)}`;
    }
    await interaction.editReply({ content: message, embeds: [], components: [] });
    return false;
  }

  logger.info({ userId, slug, format }, '[Shapes] Export job started (detail)');
  return true;
}

/**
 * Handle /shapes export <slug> subcommand
 * Starts an async export job and tells the user to check /shapes status
 */
export async function handleExport(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const slug = context.interaction.options.getString('slug', true).trim().toLowerCase();
  const formatRaw = context.interaction.options.getString('format') ?? 'json';
  const format = formatRaw === 'markdown' ? 'markdown' : 'json';

  try {
    const result = await callGatewayApi<ExportJobResponse>('/user/shapes/export', {
      method: 'POST',
      userId,
      body: { slug, format },
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!result.ok) {
      await handleExportError(context, result, slug);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('\uD83D\uDCE4 Export Started')
      .setDescription(
        `Exporting **${slug}** from shapes.inc as ${format.toUpperCase()}.\n\n` +
          'This runs in the background and may take several minutes ' +
          'for characters with many memories.\n\n' +
          'Use `/shapes status` to check progress and get the download link.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, slug, format }, '[Shapes] Export job started');
  } catch (error) {
    logger.error({ err: error, userId, slug }, '[Shapes] Unexpected error starting export');
    await context.editReply({
      embeds: [],
      content: '\u274C An unexpected error occurred. Please try again.',
    });
  }
}

interface ErrorResult {
  status: number;
  error: string;
}

function handleExportError(
  context: DeferredCommandContext,
  result: ErrorResult,
  slug: string
): Promise<void> {
  let message: string;

  if (result.status === 401 || result.status === 403) {
    message =
      '\u274C No shapes.inc credentials found.\n\n' +
      'Use `/shapes auth` to store your session cookie first.';
  } else if (result.status === 409) {
    message = `\u23F3 An export for **${slug}** is already in progress. Wait for it to complete.`;
  } else {
    message = `\u274C Export failed: ${sanitizeErrorForDiscord(result.error)}`;
  }

  return context.editReply({ embeds: [], content: message }).then(() => undefined);
}
