/**
 * Channel List Subcommand - Handles /channel list
 */

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  TextChannel,
  Client,
} from 'discord.js';
import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  escapeMarkdown,
} from 'discord.js';
import {
  createLogger,
  requireBotOwner,
  type ListChannelSettingsResponse,
  type ChannelSettings,
  DISCORD_COLORS,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { requireManageMessagesDeferred } from '../../utils/permissions.js';
import { ChannelCustomIds, type ChannelListSortType } from '../../utils/customIds.js';
import { createListComparator, type ListSortType } from '../../utils/listSorting.js';
import {
  CHANNELS_PER_PAGE,
  CHANNELS_PER_PAGE_ALL_SERVERS,
  COLLECTOR_TIMEOUT_MS,
  type GuildPage,
} from './listTypes.js';

// Re-export for backward compatibility
export { CHANNELS_PER_PAGE_ALL_SERVERS, type GuildPage } from './listTypes.js';

const logger = createLogger('channel-list');

/**
 * Format a single channel settings entry for display
 */
function formatChannelSettings(settings: ChannelSettings): string {
  const channelMention = `<#${settings.channelId}>`;
  const activatedDate = new Date(settings.createdAt).toLocaleDateString();
  const safeName = escapeMarkdown(settings.personalityName ?? 'Unknown');
  return `${channelMention} → **${safeName}** (\`${settings.personalitySlug}\`)\n  _Activated: ${activatedDate}_`;
}

/**
 * Create a channel comparator with access to client cache for name lookups.
 * Uses shared listSorting utility for consistent sort behavior.
 */
function createChannelComparator(
  client: Client
): (sortType: ListSortType) => (a: ChannelSettings, b: ChannelSettings) => number {
  // Helper to get channel name for sorting (needs client for cache lookup)
  const getChannelName = (s: ChannelSettings): string => {
    const channel = client.channels.cache.get(s.channelId) as TextChannel | undefined;
    return channel?.name ?? s.channelId;
  };

  return createListComparator<ChannelSettings>(getChannelName, s => s.createdAt);
}

/**
 * Sort channel settings by the specified sort type.
 * When isAllServers=true, groups by guild first, then sorts within each guild.
 */
function sortChannelSettings(
  settings: ChannelSettings[],
  sortType: ChannelListSortType,
  client: Client,
  isAllServers = false
): ChannelSettings[] {
  const sorted = [...settings];
  const comparator = createChannelComparator(client);

  // Helper to get guild name for sorting
  const getGuildName = (s: ChannelSettings): string => {
    if (s.guildId === null) {
      return 'zzz_unknown'; // Sort unknown guilds last
    }
    const guild = client.guilds.cache.get(s.guildId);
    return guild?.name ?? s.guildId;
  };

  if (isAllServers) {
    // Group by guild first, then sort within each guild
    sorted.sort((a, b) => {
      const guildCompare = getGuildName(a).localeCompare(getGuildName(b));
      if (guildCompare !== 0) {
        return guildCompare;
      }
      return comparator(sortType)(a, b);
    });
  } else {
    // Single guild mode - use shared comparator directly
    sorted.sort(comparator(sortType));
  }

  return sorted;
}

/**
 * Build guild-aware pages for all-servers view
 * Each page contains channels from a single guild only.
 * Large guilds are split across multiple pages with continuation indicators.
 */
export function buildGuildPages(activations: ChannelSettings[], client: Client): GuildPage[] {
  const pages: GuildPage[] = [];

  // Group by guild (activations are already sorted by guild)
  const guildGroups: { guildId: string; guildName: string; settings: ChannelSettings[] }[] = [];
  let currentGroup: (typeof guildGroups)[0] | null = null;

  for (const activation of activations) {
    const guildId = activation.guildId ?? 'unknown';
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- explicit null check required for type narrowing
    if (currentGroup === null || currentGroup.guildId !== guildId) {
      const guild = guildId !== 'unknown' ? client.guilds.cache.get(guildId) : undefined;
      const guildName: string = guild?.name ?? `Unknown Server (${guildId})`;
      currentGroup = { guildId, guildName, settings: [] };
      guildGroups.push(currentGroup);
    }
    currentGroup.settings.push(activation);
  }

  // Split each guild into pages
  for (const group of guildGroups) {
    const totalChannels = group.settings.length;
    let offset = 0;

    while (offset < totalChannels) {
      const pageSettings = group.settings.slice(offset, offset + CHANNELS_PER_PAGE_ALL_SERVERS);
      const isContinuation = offset > 0;
      const isComplete = offset + pageSettings.length >= totalChannels;

      pages.push({
        guildId: group.guildId,
        guildName: group.guildName,
        settings: pageSettings,
        isContinuation,
        isComplete,
      });

      offset += CHANNELS_PER_PAGE_ALL_SERVERS;
    }
  }

  return pages;
}

/**
 * Build pagination and sort buttons
 */
function buildButtons(
  currentPage: number,
  totalPages: number,
  currentSort: ChannelListSortType
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  // Previous button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(ChannelCustomIds.listPage(currentPage - 1, currentSort))
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0)
  );

  // Page indicator (disabled)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(ChannelCustomIds.listInfo())
      .setLabel(`Page ${currentPage + 1} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  // Next button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(ChannelCustomIds.listPage(currentPage + 1, currentSort))
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  // Sort toggle button
  const newSort: ChannelListSortType = currentSort === 'date' ? 'name' : 'date';
  const sortLabel = currentSort === 'date' ? '🔤 Sort A-Z' : '📅 Sort by Date';
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(ChannelCustomIds.sortToggle(currentPage, newSort))
      .setLabel(sortLabel)
      .setStyle(ButtonStyle.Primary)
  );

  return row;
}

/**
 * Build embed for a page of activations (single guild mode)
 */
function buildEmbedSingleGuild(
  activations: ChannelSettings[],
  page: number,
  sortType: ChannelListSortType
): EmbedBuilder {
  const totalPages = Math.max(1, Math.ceil(activations.length / CHANNELS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * CHANNELS_PER_PAGE;
  const pageActivations = activations.slice(start, start + CHANNELS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setTitle('📍 Activated Channels')
    .setColor(DISCORD_COLORS.BLURPLE);

  const lines = pageActivations.map(formatChannelSettings);
  embed.setDescription(lines.join('\n\n') || 'No activated channels in this server.');

  const sortLabel = sortType === 'date' ? 'by date' : 'alphabetically';
  embed.setFooter({
    text: `${activations.length} total • Sorted ${sortLabel} • Page ${safePage + 1} of ${totalPages}`,
  });

  return embed;
}

/**
 * Build embed for a guild page (all-servers mode)
 */
function buildEmbedAllServers(
  guildPages: GuildPage[],
  page: number,
  sortType: ChannelListSortType,
  totalChannels: number
): EmbedBuilder {
  const totalPages = guildPages.length;
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const guildPage = guildPages[safePage];

  // Build title with continuation indicator
  let title = `📍 ${escapeMarkdown(guildPage.guildName)}`;
  if (guildPage.isContinuation) {
    title += ' (continued)';
  }

  const embed = new EmbedBuilder().setTitle(title).setColor(DISCORD_COLORS.BLURPLE);

  const channelList = guildPage.settings
    .map(a => `<#${a.channelId}> → **${escapeMarkdown(a.personalityName ?? 'Unknown')}**`)
    .join('\n');

  embed.setDescription(channelList || 'No activated channels found.');

  // Build footer with context
  const sortLabel = sortType === 'date' ? 'by date' : 'alphabetically';
  const channelCount = guildPage.settings.length;
  const guildStatus =
    guildPage.isContinuation || !guildPage.isComplete
      ? ` (${channelCount} shown)`
      : ` (${channelCount} channels)`;

  embed.setFooter({
    text: `${totalChannels} total across all servers • Sorted ${sortLabel} • Page ${safePage + 1} of ${totalPages}${guildStatus}`,
  });

  return embed;
}

/**
 * Perform lazy backfill of missing guildId for activations
 */
async function backfillMissingGuildIds(
  activations: ChannelSettings[],
  client: Client,
  userId: string
): Promise<void> {
  const needsBackfill = activations.filter(a => a.guildId === null);

  if (needsBackfill.length === 0) {
    return;
  }

  logger.info(
    { count: needsBackfill.length },
    '[Channel] Backfilling missing guildIds for legacy activations'
  );

  for (const activation of needsBackfill) {
    try {
      const channel = await client.channels.fetch(activation.channelId);
      if (channel === null) {
        continue;
      }
      if ('guild' in channel && channel.guild !== null) {
        // Update in gateway
        await callGatewayApi('/user/channel/update-guild', {
          userId,
          method: 'PATCH',
          body: {
            channelId: activation.channelId,
            guildId: channel.guild.id,
          },
        });
        // Update local for display
        activation.guildId = channel.guild.id;
      }
    } catch (error) {
      // Channel may have been deleted - skip silently
      logger.debug(
        { channelId: activation.channelId, error },
        '[Channel] Could not backfill guildId (channel may be deleted)'
      );
    }
  }
}

/**
 * Get empty state message when no activations found
 */
function getEmptyStateMessage(showAll: boolean): string {
  const scope = showAll
    ? 'No channels have activated personalities across all servers.'
    : 'No channels have activated personalities in this server.';
  return `📍 ${scope}\n\nUse \`/channel activate\` in a channel to set up auto-responses.`;
}

interface PageViewOptions {
  activations: ChannelSettings[];
  sortedActivations: ChannelSettings[];
  page: number;
  sortType: ChannelListSortType;
  showAll: boolean;
  client: Client;
}

/**
 * Build embed and calculate total pages for current view
 */
function buildPageView(opts: PageViewOptions): { embed: EmbedBuilder; totalPages: number } {
  if (opts.showAll) {
    const guildPages = buildGuildPages(opts.sortedActivations, opts.client);
    return {
      embed: buildEmbedAllServers(guildPages, opts.page, opts.sortType, opts.activations.length),
      totalPages: guildPages.length,
    };
  }
  return {
    embed: buildEmbedSingleGuild(opts.sortedActivations, opts.page, opts.sortType),
    totalPages: Math.ceil(opts.sortedActivations.length / CHANNELS_PER_PAGE),
  };
}

/**
 * Set up button collector for pagination and sorting
 */
function setupPaginationCollector(
  interaction: ChatInputCommandInteraction,
  response: Awaited<ReturnType<ChatInputCommandInteraction['editReply']>>,
  activations: ChannelSettings[],
  showAll: boolean
): void {
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COLLECTOR_TIMEOUT_MS,
    filter: i => i.user.id === interaction.user.id,
  });

  collector.on('collect', (buttonInteraction: ButtonInteraction) => {
    const parsed = ChannelCustomIds.parse(buttonInteraction.customId);
    if (parsed === null) {
      return;
    }

    let newPage = parsed.page ?? 0;
    const newSort = parsed.sort ?? 'date';

    if (parsed.action === 'sort') {
      newPage = 0; // Reset to first page when changing sort
    }

    const newSortedActivations = sortChannelSettings(
      activations,
      newSort,
      interaction.client,
      showAll
    );
    const { embed, totalPages } = buildPageView({
      activations,
      sortedActivations: newSortedActivations,
      page: newPage,
      sortType: newSort,
      showAll,
      client: interaction.client,
    });

    const newComponents = [buildButtons(newPage, totalPages, newSort)];
    void buttonInteraction.update({ embeds: [embed], components: newComponents });
  });

  collector.on('end', () => {
    void interaction.editReply({ components: [] }).catch(() => {
      // Ignore errors if message was deleted
    });
  });
}

/**
 * Handle /channel list command
 */
export async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler

  // Check permission - require Manage Messages
  if (!(await requireManageMessagesDeferred(interaction))) {
    return;
  }

  const showAll = interaction.options.getBoolean('all') ?? false;

  // Check --all permission (bot owner only)
  if (showAll && !(await requireBotOwner(interaction))) {
    return;
  }

  try {
    // Build query path with optional guildId filter
    const queryPath = showAll
      ? '/user/channel/list'
      : `/user/channel/list?guildId=${interaction.guildId}`;

    const result = await callGatewayApi<ListChannelSettingsResponse>(queryPath, {
      userId: interaction.user.id,
      method: 'GET',
    });

    if (!result.ok) {
      logger.warn(
        { userId: interaction.user.id, error: result.error, status: result.status },
        '[Channel] List failed'
      );
      await interaction.editReply(`❌ Failed to list settings: ${result.error}`);
      return;
    }

    let { settings } = result.data;

    // Lazy backfill missing guildIds
    await backfillMissingGuildIds(settings, interaction.client, interaction.user.id);

    // For current server view, filter again after backfill (in case some got resolved)
    if (!showAll && interaction.guildId !== null) {
      settings = settings.filter(s => s.guildId === interaction.guildId);
    }

    if (settings.length === 0) {
      await interaction.editReply(getEmptyStateMessage(showAll));
      return;
    }

    // Initial sort: chronological (newest first), grouped by guild if showing all
    const sortType: ChannelListSortType = 'date';
    const sortedSettings = sortChannelSettings(settings, sortType, interaction.client, showAll);

    // Build initial embed and components
    const { embed, totalPages } = buildPageView({
      activations: settings,
      sortedActivations: sortedSettings,
      page: 0,
      sortType,
      showAll,
      client: interaction.client,
    });
    const components = [buildButtons(0, totalPages, sortType)];

    const response = await interaction.editReply({ embeds: [embed], components });

    logger.info(
      { userId: interaction.user.id, count: settings.length, showAll },
      '[Channel] Listed channel settings'
    );

    // Set up button collector for pagination and sorting
    if (components.length > 0) {
      setupPaginationCollector(interaction, response, settings, showAll);
    }
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: interaction.user.id,
      },
      '[Channel] List error'
    );
    await interaction.editReply('❌ An unexpected error occurred while listing activations.');
  }
}
