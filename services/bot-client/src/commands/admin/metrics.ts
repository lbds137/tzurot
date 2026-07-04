/**
 * Admin Metrics Subcommand
 * Handles /admin metrics - Renders the gateway /metrics endpoint as a
 * Discord embed for the bot owner.
 *
 * The /metrics endpoint is service-auth-protected and exposes operational
 * counters (BullMQ queue depth, dedup cache size, uptime). There's no
 * other in-bot consumer today, so this command is the human-facing window
 * into those counters when debugging or spot-checking the gateway.
 *
 * Gracefully degrades if the gateway is unreachable, mirroring the
 * /admin health pattern.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { serviceFetch } from '../../utils/serviceFetch.js';
import { formatDuration } from '../../utils/formatting.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-metrics');

interface GatewayMetricsResponse {
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    total: number;
  };
  cache: {
    size: number;
  };
  uptime: number;
  timestamp: string;
}

const METRICS_FIELD_NAME = '📊 Gateway Metrics';

export async function handleMetrics(context: DeferredCommandContext): Promise<void> {
  const embed = new EmbedBuilder().setTitle('📊 System Metrics').setColor(DISCORD_COLORS.BLURPLE);

  try {
    const response = await serviceFetch('/metrics');

    if (!response.ok) {
      embed.addFields({
        name: METRICS_FIELD_NAME,
        value: `⚠️ Gateway responded with HTTP ${response.status}`,
      });
      embed.setColor(DISCORD_COLORS.WARNING);
    } else {
      const metrics = (await response.json()) as GatewayMetricsResponse;

      embed.addFields(
        {
          name: '📥 Queue (in flight)',
          value: `Waiting: **${metrics.queue.waiting}** | Active: **${metrics.queue.active}** | Total: **${metrics.queue.total}**`,
        },
        {
          name: '📈 Queue (lifetime)',
          value: `Completed: **${metrics.queue.completed}** | Failed: **${metrics.queue.failed}**`,
        },
        {
          name: '💾 Dedup cache',
          value: `${metrics.cache.size} entries`,
        },
        {
          name: '⏱️ Gateway uptime',
          value: formatDuration(metrics.uptime),
        }
      );

      embed.setFooter({ text: `Snapshot: ${metrics.timestamp}` });
    }
  } catch (error) {
    logger.warn({ err: error }, 'Gateway metrics fetch failed');
    embed.addFields({
      name: METRICS_FIELD_NAME,
      value: '❌ Gateway unreachable',
    });
    embed.setColor(DISCORD_COLORS.WARNING);
  }

  // Single dispatch path for all branches (success / non-OK / fetch-threw).
  // Earlier shape had an inline editReply inside the non-OK branch — if THAT
  // throw fired (Discord interaction expired), it fell through to the outer
  // catch, which overwrote the non-OK fields with the "unreachable" message.
  // Wrong attribution. Single dispatch outside the try fixes it.
  await context.editReply({ embeds: [embed] });
}
