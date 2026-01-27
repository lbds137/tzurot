/**
 * Channel Browse Subcommand - Handles /channel browse
 *
 * Replaces /channel list with enhanced functionality:
 * - Optional query parameter for searching by personality name
 * - Filter parameter (current server or all servers for bot owners)
 * - Consistent browse pattern with pagination
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import type { ButtonInteraction, TextChannel, Client } from 'discord.js';
import { EmbedBuilder, ButtonBuilder, ActionRowBuilder, escapeMarkdown } from 'discord.js';
import {
  buildBrowseButtons as buildSharedBrowseButtons,
  createBrowseCustomIdHelpers,
  type BrowseSortType,
} from '../../utils/browse/index.js';
import {
  createLogger,
  isBotOwner,
  type ListChannelSettingsResponse,
  type ChannelSettings,
  DISCORD_COLORS,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { requireManageMessagesContext } from '../../utils/permissions.js';
import { createListComparator, type ListSortType } from '../../utils/listSorting.js';
import { CHANNELS_PER_PAGE, CHANNELS_PER_PAGE_ALL_SERVERS, type GuildPage } from './listTypes.js';

const logger = createLogger('channel-browse');

/** Browse filter options */
export type ChannelBrowseFilter = 'current' | 'all';

/** Valid filters for channel browse */
const VALID_FILTERS = ['current', 'all'] as const;

/** Browse customId helpers using shared factory */
const browseHelpers = createBrowseCustomIdHelpers<ChannelBrowseFilter>({
  prefix: 'channel',
  validFilters: VALID_FILTERS,
});

/** Default sort type */
const DEFAULT_SORT: BrowseSortType = 'date';

/**
 * Check if custom ID is a channel browse interaction
 */
export function isChannelBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

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
 */
function createChannelComparator(
  client: Client
): (sortType: ListSortType) => (a: ChannelSettings, b: ChannelSettings) => number {
  const getChannelName = (s: ChannelSettings): string => {
    const channel = client.channels.cache.get(s.channelId) as TextChannel | undefined;
    return channel?.name ?? s.channelId;
  };

  return createListComparator<ChannelSettings>(getChannelName, s => s.createdAt);
}

/**
 * Sort channel settings by the specified sort type.
 */
function sortChannelSettings(
  settings: ChannelSettings[],
  sortType: BrowseSortType,
  client: Client,
  isAllServers = false
): ChannelSettings[] {
  const sorted = [...settings];
  const comparator = createChannelComparator(client);

  const getGuildName = (s: ChannelSettings): string => {
    if (s.guildId === null) {
      return 'zzz_unknown';
    }
    const guild = client.guilds.cache.get(s.guildId);
    return guild?.name ?? s.guildId;
  };

  if (isAllServers) {
    sorted.sort((a, b) => {
      const guildCompare = getGuildName(a).localeCompare(getGuildName(b));
      if (guildCompare !== 0) {
        return guildCompare;
      }
      return comparator(sortType)(a, b);
    });
  } else {
    sorted.sort(comparator(sortType));
  }

  return sorted;
}

/**
 * Filter channel settings by query
 */
function filterByQuery(settings: ChannelSettings[], query: string | null): ChannelSettings[] {
  if (query === null || query.length === 0) {
    return settings;
  }

  const lowerQuery = query.toLowerCase();
  return settings.filter(
    s =>
      (s.personalityName?.toLowerCase().includes(lowerQuery) ?? false) ||
      (s.personalitySlug?.toLowerCase().includes(lowerQuery) ?? false)
  );
}

/**
 * Build guild-aware pages for all-servers view
 */
function buildGuildPages(activations: ChannelSettings[], client: Client): GuildPage[] {
  const pages: GuildPage[] = [];

  const guildGroups: { guildId: string; guildName: string; settings: ChannelSettings[] }[] = [];
  let currentGroup: (typeof guildGroups)[0] | null = null;

  for (const activation of activations) {
    const guildId = activation.guildId ?? 'unknown';
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- explicit null check required
    if (currentGroup === null || currentGroup.guildId !== guildId) {
      const guild = guildId !== 'unknown' ? client.guilds.cache.get(guildId) : undefined;
      const guildName: string = guild?.name ?? `Unknown Server (${guildId})`;
      currentGroup = { guildId, guildName, settings: [] };
      guildGroups.push(currentGroup);
    }
    currentGroup.settings.push(activation);
  }

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
 * Build pagination and sort buttons using shared utility
 */
function buildBrowseButtons(
  currentPage: number,
  totalPages: number,
  filter: ChannelBrowseFilter,
  currentSort: BrowseSortType,
  query: string | null
): ReturnType<typeof buildSharedBrowseButtons> {
  return buildSharedBrowseButtons({
    currentPage,
    totalPages,
    filter,
    currentSort,
    query,
    buildCustomId: browseHelpers.build,
    buildInfoId: browseHelpers.buildInfo,
  });
}

/**
 * Build embed for single guild view
 */
function buildEmbedSingleGuild(
  activations: ChannelSettings[],
  page: number,
  sortType: BrowseSortType,
  query: string | null
): EmbedBuilder {
  const totalPages = Math.max(1, Math.ceil(activations.length / CHANNELS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * CHANNELS_PER_PAGE;
  const pageActivations = activations.slice(start, start + CHANNELS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setTitle('📍 Channel Browser')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  const lines: string[] = [];

  // Search info
  if (query !== null) {
    lines.push(`🔍 Searching: "${query}"\n`);
  }

  if (pageActivations.length === 0) {
    if (query !== null) {
      lines.push('_No channels match your search._');
    } else {
      lines.push('_No activated channels in this server._');
      lines.push('\nUse `/channel activate` to set up auto-responses.');
    }
  } else {
    lines.push(...pageActivations.map(formatChannelSettings));
  }

  embed.setDescription(lines.join('\n\n'));

  const sortLabel = sortType === 'date' ? 'by date' : 'alphabetically';
  embed.setFooter({
    text: `${activations.length} activated • Sorted ${sortLabel}`,
  });

  return embed;
}

/**
 * Build embed for all servers view
 */
function buildEmbedAllServers(
  guildPages: GuildPage[],
  page: number,
  sortType: BrowseSortType,
  totalChannels: number,
  query: string | null
): EmbedBuilder {
  const totalPages = guildPages.length;
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const guildPage = guildPages[safePage];

  let title = `📍 ${escapeMarkdown(guildPage.guildName)}`;
  if (guildPage.isContinuation) {
    title += ' (continued)';
  }

  const embed = new EmbedBuilder().setTitle(title).setColor(DISCORD_COLORS.BLURPLE).setTimestamp();

  const lines: string[] = [];

  // Search info
  if (query !== null) {
    lines.push(`🔍 Searching: "${query}"\n`);
  }

  const channelList = guildPage.settings
    .map(a => `<#${a.channelId}> → **${escapeMarkdown(a.personalityName ?? 'Unknown')}**`)
    .join('\n');

  lines.push(channelList || '_No activated channels found._');
  embed.setDescription(lines.join('\n'));

  const sortLabel = sortType === 'date' ? 'by date' : 'alphabetically';
  const channelCount = guildPage.settings.length;
  const guildStatus =
    guildPage.isContinuation || !guildPage.isComplete
      ? ` (${channelCount} shown)`
      : ` (${channelCount} channels)`;

  embed.setFooter({
    text: `${totalChannels} total across all servers • Sorted ${sortLabel}${guildStatus}`,
  });

  return embed;
}

/** Options for building browse page */
interface BuildBrowsePageOptions {
  activations: ChannelSettings[];
  page: number;
  filter: ChannelBrowseFilter;
  sortType: BrowseSortType;
  query: string | null;
  client: Client;
}

/**
 * Build the browse page embed and components
 */
function buildBrowsePage(options: BuildBrowsePageOptions): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
  totalPages: number;
} {
  const { activations, page, filter, sortType, query, client } = options;
  const isAllServers = filter === 'all';

  if (isAllServers) {
    const guildPages = buildGuildPages(activations, client);
    const totalPages = Math.max(1, guildPages.length);
    const embed = buildEmbedAllServers(guildPages, page, sortType, activations.length, query);
    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    if (totalPages > 1 || activations.length > 0) {
      components.push(buildBrowseButtons(page, totalPages, filter, sortType, query));
    }

    return { embed, components, totalPages };
  }

  const totalPages = Math.max(1, Math.ceil(activations.length / CHANNELS_PER_PAGE));
  const embed = buildEmbedSingleGuild(activations, page, sortType, query);
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (totalPages > 1 || activations.length > 0) {
    components.push(buildBrowseButtons(page, totalPages, filter, sortType, query));
  }

  return { embed, components, totalPages };
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
        await callGatewayApi('/user/channel/update-guild', {
          userId,
          method: 'PATCH',
          body: {
            channelId: activation.channelId,
            guildId: channel.guild.id,
          },
        });
        activation.guildId = channel.guild.id;
      }
    } catch (error) {
      logger.debug(
        { channelId: activation.channelId, error },
        '[Channel] Could not backfill guildId (channel may be deleted)'
      );
    }
  }
}

/**
 * Handle /channel browse [query?] [filter?]
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const { interaction } = context;

  // Check permission - require Manage Messages
  if (!(await requireManageMessagesContext(context))) {
    return;
  }

  const query = context.getOption<string>('query') ?? null;
  const filterStr = context.getOption<string>('filter') ?? 'current';
  const filter = filterStr as ChannelBrowseFilter;

  // Check owner permission for 'all' filter
  if (filter === 'all' && !isBotOwner(context.user.id)) {
    await context.editReply('❌ The "All Servers" filter is only available to bot owners.');
    return;
  }

  try {
    // Build query path with optional guildId filter
    const queryPath =
      filter === 'all' ? '/user/channel/list' : `/user/channel/list?guildId=${context.guildId}`;

    const result = await callGatewayApi<ListChannelSettingsResponse>(queryPath, {
      userId: context.user.id,
      method: 'GET',
    });

    if (!result.ok) {
      logger.warn(
        { userId: context.user.id, error: result.error, status: result.status },
        '[Channel] Browse failed'
      );
      await context.editReply(`❌ Failed to browse channels: ${result.error}`);
      return;
    }

    let { settings } = result.data;

    // Lazy backfill missing guildIds
    await backfillMissingGuildIds(settings, interaction.client, context.user.id);

    // For current server view, filter again after backfill
    if (filter === 'current' && context.guildId !== null) {
      settings = settings.filter(s => s.guildId === context.guildId);
    }

    // Apply query filter
    const filteredSettings = filterByQuery(settings, query);

    // Sort settings
    const sortedSettings = sortChannelSettings(
      filteredSettings,
      DEFAULT_SORT,
      interaction.client,
      filter === 'all'
    );

    // Build initial page
    const { embed, components } = buildBrowsePage({
      activations: sortedSettings,
      page: 0,
      filter,
      sortType: DEFAULT_SORT,
      query,
      client: interaction.client,
    });

    await context.editReply({ embeds: [embed], components });

    logger.info(
      { userId: context.user.id, count: settings.length, filter, query },
      '[Channel] Browse channels'
    );
  } catch (error) {
    logger.error({ err: error, userId: context.user.id }, '[Channel] Browse error');
    await context.editReply('❌ An unexpected error occurred while browsing channels.');
  }
}

/**
 * Handle browse pagination button clicks
 */
export async function handleBrowsePagination(
  interaction: ButtonInteraction,
  guildId: string | null
): Promise<void> {
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  const { page, filter, sort, query } = parsed;
  const userId = interaction.user.id;

  // Check owner permission for 'all' filter
  if (filter === 'all' && !isBotOwner(userId)) {
    return;
  }

  try {
    const queryPath =
      filter === 'all' ? '/user/channel/list' : `/user/channel/list?guildId=${guildId}`;

    const result = await callGatewayApi<ListChannelSettingsResponse>(queryPath, {
      userId,
      method: 'GET',
    });

    if (!result.ok) {
      logger.warn({ userId }, '[Channel] Failed to fetch channels for pagination');
      return;
    }

    let { settings } = result.data;

    // For current server view, filter by guild
    if (filter === 'current' && guildId !== null) {
      settings = settings.filter(s => s.guildId === guildId);
    }

    // Apply query filter
    const filteredSettings = filterByQuery(settings, query);

    // Sort settings
    const sortedSettings = sortChannelSettings(
      filteredSettings,
      sort,
      interaction.client,
      filter === 'all'
    );

    // Build requested page
    const { embed, components } = buildBrowsePage({
      activations: sortedSettings,
      page,
      filter,
      sortType: sort,
      query,
      client: interaction.client,
    });

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error(
      { err: error, userId, page, filter, sort },
      '[Channel] Failed to load browse page'
    );
    // Keep existing content on error
  }
}
