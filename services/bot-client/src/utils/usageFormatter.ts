/**
 * Shared utility for formatting usage statistics into Discord embeds
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types';

/**
 * Base usage stats structure (shared between user and admin)
 */
interface BaseUsageStats {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokens: number;
  byProvider: Record<string, { requests: number; tokensIn: number; tokensOut: number }>;
  byModel: Record<string, { requests: number; tokensIn: number; tokensOut: number }>;
  byRequestType: Record<string, { requests: number; tokensIn: number; tokensOut: number }>;
}

/**
 * Admin-specific stats (extends base with global data)
 */
export interface AdminUsageStats extends BaseUsageStats {
  timeframe: string;
  periodStart: string | null;
  periodEnd: string;
  uniqueUsers: number;
  topUsers: { discordId: string; requests: number; tokens: number }[];
}

/**
 * Format token count with K/M suffix for readability
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toLocaleString();
}

/**
 * Add provider breakdown to embed
 */
function addProviderBreakdown(
  embed: EmbedBuilder,
  byProvider: BaseUsageStats['byProvider'],
  maxItems = 5
): void {
  const providers = Object.keys(byProvider);
  if (providers.length === 0) {
    return;
  }

  const providerLines = providers
    .sort((a, b) => byProvider[b].requests - byProvider[a].requests)
    .slice(0, maxItems)
    .map(provider => {
      const p = byProvider[provider];
      return `**${provider}**: ${p.requests} req • ${formatTokens(p.tokensIn + p.tokensOut)} tokens`;
    });

  embed.addFields({
    name: 'By Provider',
    value: providerLines.join('\n'),
    inline: false,
  });
}

/**
 * Add request type breakdown to embed
 */
function addRequestTypeBreakdown(
  embed: EmbedBuilder,
  byRequestType: BaseUsageStats['byRequestType']
): void {
  const requestTypes = Object.keys(byRequestType);
  if (requestTypes.length === 0) {
    return;
  }

  const typeLines = requestTypes
    .sort((a, b) => byRequestType[b].requests - byRequestType[a].requests)
    .map(type => {
      const t = byRequestType[type];
      return `**${type}**: ${t.requests} requests`;
    });

  embed.addFields({
    name: 'By Type',
    value: typeLines.join('\n'),
    inline: false,
  });
}

/**
 * Add top models breakdown to embed
 */
function addModelBreakdown(
  embed: EmbedBuilder,
  byModel: BaseUsageStats['byModel'],
  maxItems = 5,
  includeTokens = true
): void {
  const models = Object.keys(byModel);
  if (models.length === 0) {
    return;
  }

  const modelLines = models
    .sort((a, b) => byModel[b].requests - byModel[a].requests)
    .slice(0, maxItems)
    .map(model => {
      const m = byModel[model];
      const shortModel = model.includes('/') ? model.split('/').pop() : model;
      if (includeTokens) {
        return `**${shortModel}**: ${m.requests} req • ${formatTokens(m.tokensIn + m.tokensOut)} tokens`;
      }
      return `**${shortModel}**: ${m.requests} req`;
    });

  embed.addFields({
    name: 'Top Models',
    value: modelLines.join('\n'),
    inline: false,
  });
}

/**
 * Add top users breakdown to embed (admin only)
 */
function addTopUsersBreakdown(
  embed: EmbedBuilder,
  topUsers: AdminUsageStats['topUsers'],
  maxItems = 5
): void {
  if (topUsers.length === 0) {
    return;
  }

  const userLines = topUsers.slice(0, maxItems).map((user, index) => {
    return `${index + 1}. <@${user.discordId}>: ${user.requests} req • ${formatTokens(user.tokens)} tokens`;
  });

  embed.addFields({
    name: 'Top Users',
    value: userLines.join('\n'),
    inline: false,
  });
}

/**
 * Build a usage stats embed for admin-level stats (global)
 */
export function buildAdminUsageEmbed(stats: AdminUsageStats): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('📊 Global API Usage Statistics')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setDescription(`**Timeframe:** ${stats.timeframe}`)
    .setTimestamp();

  if (stats.totalRequests === 0) {
    embed.addFields({
      name: 'No Usage',
      value: 'No API requests have been made in this period.',
      inline: false,
    });
  } else {
    embed.addFields(
      {
        name: 'Total Requests',
        value: stats.totalRequests.toLocaleString(),
        inline: true,
      },
      {
        name: 'Tokens In',
        value: formatTokens(stats.totalTokensIn),
        inline: true,
      },
      {
        name: 'Tokens Out',
        value: formatTokens(stats.totalTokensOut),
        inline: true,
      },
      {
        name: 'Unique Users',
        value: stats.uniqueUsers.toLocaleString(),
        inline: true,
      }
    );

    addProviderBreakdown(embed, stats.byProvider);
    addRequestTypeBreakdown(embed, stats.byRequestType);
    addModelBreakdown(embed, stats.byModel, 5, true);
    addTopUsersBreakdown(embed, stats.topUsers);
  }

  embed.setFooter({
    text: 'Global statistics across all users',
  });

  return embed;
}
