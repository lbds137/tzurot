/**
 * Admin Stop Sequences Subcommand
 * Handles /admin stop-sequences - Shows stop sequence activation statistics
 *
 * Reads stats from gateway (which reads from Redis, written by ai-worker).
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { clientsFor } from '../../utils/gatewayClients.js';
import { formatDuration } from '../../utils/formatting.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-stop-sequences');

/** Max entries per embed field to stay under Discord's 1024-char field limit */
const MAX_FIELD_ENTRIES = 15;

/** Sort entries by count descending */
function sortedEntries(record: Record<string, number>): [string, number][] {
  return Object.entries(record).sort(([, a], [, b]) => b - a);
}

/** Format a sequence string for display (make newlines visible) */
function displaySequence(seq: string): string {
  return seq.replace(/\n/g, '\\n');
}

/** Strip provider prefix from model name (e.g., "openai/gpt-4" → "gpt-4") */
function stripProvider(model: string): string {
  const slashIndex = model.indexOf('/');
  return slashIndex >= 0 ? model.slice(slashIndex + 1) : model;
}

export async function handleStopSequences(context: DeferredCommandContext): Promise<void> {
  try {
    const { ownerClient } = clientsFor(context.interaction);
    const result = await ownerClient.getStopSequencesStats();

    if (!result.ok) {
      logger.error({ status: result.status, error: result.error }, 'Stop sequence query failed');
      await context.editReply({
        content: `❌ Failed to retrieve stop sequence stats (HTTP ${result.status})`,
      });
      return;
    }

    const stats = result.data;
    const trackingDuration = formatDuration(Date.now() - new Date(stats.startedAt).getTime());

    const embed = new EmbedBuilder()
      .setTitle('🛑 Stop Sequence Stats')
      .setColor(DISCORD_COLORS.BLURPLE);

    if (stats.totalActivations === 0) {
      embed.setDescription(`No activations recorded.\nTracking since: ${trackingDuration} ago`);
      await context.editReply({ embeds: [embed] });
      return;
    }

    embed.setDescription(
      `**Total Activations:** ${stats.totalActivations}\n**Tracking:** ${trackingDuration}`
    );

    // By Sequence table (truncated to prevent Discord 1024-char field overflow)
    const sequenceEntries = sortedEntries(stats.bySequence);
    if (sequenceEntries.length > 0) {
      const shown = sequenceEntries.slice(0, MAX_FIELD_ENTRIES);
      const lines = shown.map(([seq, count]) => `\`${displaySequence(seq)}\` — ${count}`);
      if (sequenceEntries.length > MAX_FIELD_ENTRIES) {
        lines.push(`*...and ${sequenceEntries.length - MAX_FIELD_ENTRIES} more*`);
      }
      embed.addFields({ name: 'By Sequence', value: lines.join('\n') });
    }

    // By Model table (truncated to prevent Discord 1024-char field overflow)
    const modelEntries = sortedEntries(stats.byModel);
    if (modelEntries.length > 0) {
      const shown = modelEntries.slice(0, MAX_FIELD_ENTRIES);
      const lines = shown.map(([model, count]) => `\`${stripProvider(model)}\` — ${count}`);
      if (modelEntries.length > MAX_FIELD_ENTRIES) {
        lines.push(`*...and ${modelEntries.length - MAX_FIELD_ENTRIES} more*`);
      }
      embed.addFields({ name: 'By Model', value: lines.join('\n') });
    }

    await context.editReply({ embeds: [embed] });

    logger.info({ totalActivations: stats.totalActivations }, 'Returned stats embed');
  } catch (error) {
    logger.error({ err: error }, 'Error retrieving stop sequence stats');
    await context.editReply({
      content: '❌ Error retrieving stop sequence statistics. Please try again later.',
    });
  }
}
