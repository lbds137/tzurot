/**
 * /settings data export — full-account data export (data portability).
 *
 * Starts an async export job (ai-worker assembles the payload) and shows the
 * download link. One active job per user: on 409 the handler fetches the
 * current job's status instead, so re-running the command doubles as a
 * status check.
 */

import { EmbedBuilder, time, TimestampStyles } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { sanitizeErrorForDiscord } from '../../../utils/errorSanitization.js';

const logger = createLogger('settings-data-export');

function expiryLine(expiresAt: string | Date): string {
  const expiry = new Date(expiresAt);
  return `The link expires ${time(expiry, TimestampStyles.RelativeTime)} — download before then.`;
}

async function showCurrentJobStatus(context: DeferredCommandContext): Promise<void> {
  const { userClient } = clientsFor(context.interaction);
  const statusResult = await userClient.getAccountExportStatus();

  if (!statusResult.ok || statusResult.data.job === null) {
    await context.editReply({
      content: '⏳ An account export is already in progress. Try again in a minute.',
    });
    return;
  }

  const job = statusResult.data.job;
  const embed = new EmbedBuilder()
    .setColor(job.status === 'completed' ? DISCORD_COLORS.SUCCESS : DISCORD_COLORS.WARNING)
    .setTitle('📦 Account Export Status')
    .setDescription(
      job.status === 'completed' && job.downloadUrl !== null
        ? `Your export is ready.\n\n[Download your data](${job.downloadUrl})\n\n${expiryLine(job.expiresAt)}`
        : `Your export is **${job.status}**. Re-run this command to check again.`
    )
    .setTimestamp();

  await context.editReply({ embeds: [embed] });
}

/** Handle /settings data export */
export async function handleDataExport(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.startAccountExport({});

    if (!result.ok) {
      if (result.status === 409) {
        await showCurrentJobStatus(context);
        return;
      }
      await context.editReply({
        content: `❌ Export failed to start: ${sanitizeErrorForDiscord(result.error)}`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('📦 Account Export Started')
      .setDescription(
        'Your full account data is being assembled — profile, personas, ' +
          'characters, conversation history, memories, facts, and settings ' +
          '(secret material like API keys is never included).\n\n' +
          `When it finishes, download it here:\n[Download your data](${result.data.downloadUrl})\n\n` +
          `${expiryLine(result.data.expiresAt)} ` +
          'If the link says the export is not ready yet, wait a moment and try it again.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });
    logger.info({ userId }, 'Account export started');
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error starting account export');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
