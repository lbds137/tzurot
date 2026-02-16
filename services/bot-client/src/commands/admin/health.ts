/**
 * Admin Health Subcommand
 * Handles /admin health - Shows bot health and connected service status
 *
 * Combines gateway /health endpoint with Discord client metrics.
 * Gracefully degrades if gateway is unreachable.
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';
import { formatDuration } from '../../utils/formatting.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-health');

interface GatewayHealthResponse {
  status: string;
  services: {
    redis: boolean;
    queue: boolean;
    avatarStorage?: boolean;
  };
  avatars?: {
    status: string;
    count?: number;
  };
  timestamp: string;
  uptime: number;
}

function statusIcon(ok: boolean): string {
  return ok ? '✅' : '❌';
}

const GATEWAY_FIELD_NAME = '🗄️ Gateway';

export async function handleHealth(context: DeferredCommandContext): Promise<void> {
  const client = context.interaction.client;

  // Discord client metrics
  const wsPing = client.ws.ping;
  const guildCount = client.guilds.cache.size;
  const memberCount = client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0);
  const botUptime = client.uptime ?? 0;

  const embed = new EmbedBuilder()
    .setTitle('🏥 Bot Health Status')
    .setColor(DISCORD_COLORS.BLURPLE);

  // Discord section (always available)
  embed.addFields({
    name: '📡 Discord',
    value: `${statusIcon(wsPing >= 0)} Connected (${wsPing}ms ping) | Uptime: ${formatDuration(botUptime)}`,
  });

  // Gateway section
  try {
    const response = await adminFetch('/health');

    if (response.ok) {
      const health = (await response.json()) as GatewayHealthResponse;
      const gwStatus = health.status === 'healthy';

      embed.addFields({
        name: GATEWAY_FIELD_NAME,
        value: `${statusIcon(gwStatus)} ${health.status} | Uptime: ${formatDuration(health.uptime)}`,
      });

      // Services breakdown
      const serviceLines = [
        `Redis ${statusIcon(health.services.redis)}`,
        `Queue ${statusIcon(health.services.queue)}`,
      ];
      if (health.services.avatarStorage !== undefined) {
        const avatarCount = health.avatars?.count;
        const avatarSuffix = avatarCount !== undefined ? ` (${avatarCount} cached)` : '';
        serviceLines.push(`Avatars ${statusIcon(health.services.avatarStorage)}${avatarSuffix}`);
      }
      embed.addFields({ name: '🔌 Services', value: serviceLines.join(' | ') });
    } else {
      embed.addFields({
        name: GATEWAY_FIELD_NAME,
        value: `⚠️ Responded with HTTP ${response.status}`,
      });
      embed.setColor(DISCORD_COLORS.WARNING);
    }
  } catch (error) {
    logger.warn({ err: error }, 'Gateway health check failed');
    embed.addFields({
      name: GATEWAY_FIELD_NAME,
      value: '❌ Unreachable',
    });
    embed.setColor(DISCORD_COLORS.WARNING);
  }

  // Stats section
  embed.addFields({
    name: '📊 Stats',
    value: `Guilds: ${guildCount} | Members: ~${memberCount}`,
  });

  await context.editReply({ embeds: [embed] });
}
