/**
 * Admin Stop Sequences Subcommand
 * Handles /admin stop-sequences - Shows stop sequence activation statistics
 *
 * Reads stats from gateway (which reads from Redis, written by ai-worker).
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-stop-sequences');

interface StopSequenceStatsResponse {
  totalActivations: number;
  bySequence: Record<string, number>;
  byModel: Record<string, number>;
  startedAt: string;
}

/** Format milliseconds into a human-readable duration */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

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
    const response = await adminFetch('/admin/stop-sequences');

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Stop sequence query failed');
      await context.editReply({
        content: `❌ Failed to retrieve stop sequence stats (HTTP ${response.status})`,
      });
      return;
    }

    const stats = (await response.json()) as StopSequenceStatsResponse;
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

    // By Sequence table
    const sequenceEntries = sortedEntries(stats.bySequence);
    if (sequenceEntries.length > 0) {
      const lines = sequenceEntries.map(([seq, count]) => `\`${displaySequence(seq)}\` — ${count}`);
      embed.addFields({ name: 'By Sequence', value: lines.join('\n') });
    }

    // By Model table
    const modelEntries = sortedEntries(stats.byModel);
    if (modelEntries.length > 0) {
      const lines = modelEntries.map(([model, count]) => `\`${stripProvider(model)}\` — ${count}`);
      embed.addFields({ name: 'By Model', value: lines.join('\n') });
    }

    await context.editReply({ embeds: [embed] });

    logger.info(
      { totalActivations: stats.totalActivations },
      '[StopSequences] Returned stats embed'
    );
  } catch (error) {
    logger.error({ err: error }, 'Error retrieving stop sequence stats');
    await context.editReply({
      content: '❌ Error retrieving stop sequence statistics. Please try again later.',
    });
  }
}
