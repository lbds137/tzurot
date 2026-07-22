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

import {
  type ButtonInteraction,
  type Client,
  EmbedBuilder,
  type ButtonBuilder,
  type ActionRowBuilder,
  escapeMarkdown,
} from 'discord.js';
import {
  buildBrowseButtons as buildSharedBrowseButtons,
  buildFilterToggleButton,
  createBrowseCustomIdHelpers,
  joinFooter,
  formatSortNatural,
  formatSortVerbatim,
  type BrowseSortType,
} from '../../utils/browse/index.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { ENTITY_EMOJI, entityTitle } from '@tzurot/common-types/constants/uxVocabulary';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { channelBrowseOptions } from '@tzurot/common-types/generated/commandOptions';
import { type ChannelSettings } from '@tzurot/common-types/schemas/api/channel';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { type UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { requireManageMessagesContext } from '../../utils/permissions.js';
import {
  CHANNELS_PER_PAGE,
  FILTER_TOGGLE_DISPLAY,
  VALID_CHANNEL_FILTERS,
  type ChannelBrowseFilter,
  type GuildPage,
} from './listTypes.js';
import {
  buildGuildPages,
  filterByQuery,
  formatChannelSettings,
  sortChannelSettings,
} from './browseHelpers.js';
import { ackUpdate } from '../../ux/render/reply.js';

const logger = createLogger('channel-browse');

/** Browse customId helpers using shared factory */
const browseHelpers = createBrowseCustomIdHelpers<ChannelBrowseFilter>({
  prefix: 'channel',
  validFilters: VALID_CHANNEL_FILTERS,
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
 * Build pagination and sort buttons using shared utility, plus the
 * in-place filter toggle (current ↔ all servers). The 'all' filter is
 * bot-owner-only, so the toggle only renders for the owner — showing it
 * to everyone else would be a dead affordance (the pagination handler
 * gates the click, leaving a button that visibly does nothing).
 */
interface ChannelBrowseButtonsOptions {
  currentPage: number;
  totalPages: number;
  filter: ChannelBrowseFilter;
  currentSort: BrowseSortType;
  query: string | null;
  showFilterToggle: boolean;
}

function buildBrowseButtons(
  options: ChannelBrowseButtonsOptions
): ReturnType<typeof buildSharedBrowseButtons> {
  const { currentPage, totalPages, filter, currentSort, query, showFilterToggle } = options;
  const row = buildSharedBrowseButtons({
    currentPage,
    totalPages,
    filter,
    currentSort,
    query,
    buildCustomId: browseHelpers.build,
    buildInfoId: browseHelpers.buildInfo,
  });
  if (showFilterToggle) {
    row.addComponents(
      buildFilterToggleButton({
        filters: VALID_CHANNEL_FILTERS,
        display: FILTER_TOGGLE_DISPLAY,
        current: filter,
        buildCustomId: browseHelpers.build,
        sort: currentSort,
        query,
      })
    );
  }
  return row;
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
    .setTitle(entityTitle('channel', 'Channel Browser'))
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

  embed.setFooter({
    text: joinFooter(
      `${activations.length} activated`,
      sortType === 'date' ? formatSortNatural('date') : formatSortVerbatim('Sorted alphabetically')
    ),
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
  // Zero activations anywhere: without this guard, safePage clamps to -1
  // and guildPages[-1] throws. The always-rendered filter toggle makes
  // this path directly reachable (toggle to All Servers on an empty bot).
  if (guildPages.length === 0) {
    return new EmbedBuilder()
      .setTitle(entityTitle('channel', 'Channel Browser'))
      .setColor(DISCORD_COLORS.BLURPLE)
      .setDescription(
        query !== null
          ? '_No channels match your search in any server._'
          : '_No activated channels in any server._\n\nUse `/channel activate` to set up auto-responses.'
      )
      .setFooter({ text: '0 total across all servers' })
      .setTimestamp();
  }

  const totalPages = guildPages.length;
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const guildPage = guildPages[safePage];

  let title = `${ENTITY_EMOJI.channel} ${escapeMarkdown(guildPage.guildName)}`;
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

  const channelCount = guildPage.settings.length;
  const guildStatus =
    guildPage.isContinuation || !guildPage.isComplete
      ? `(${channelCount} shown)`
      : `(${channelCount} channels)`;
  const sortPhrase =
    sortType === 'date' ? formatSortNatural('date') : formatSortVerbatim('Sorted alphabetically');

  // guildStatus annotates the sort phrase (no delimiter between them)
  embed.setFooter({
    text: joinFooter(`${totalChannels} total across all servers`, `${sortPhrase} ${guildStatus}`),
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
  /** Owner-only affordance: the all-servers toggle renders only for the bot owner. */
  showFilterToggle: boolean;
}

/**
 * Build the browse page embed and components
 */
function buildBrowsePage(options: BuildBrowsePageOptions): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
  totalPages: number;
} {
  const { activations, page, filter, sortType, query, client, showFilterToggle } = options;
  const isAllServers = filter === 'all';

  if (isAllServers) {
    const guildPages = buildGuildPages(activations, client);
    const totalPages = Math.max(1, guildPages.length);
    const embed = buildEmbedAllServers(guildPages, page, sortType, activations.length, query);
    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    // Always render: the filter toggle must stay reachable even when this
    // view is empty (the other filter's view may not be).
    components.push(
      buildBrowseButtons({
        currentPage: page,
        totalPages,
        filter,
        currentSort: sortType,
        query,
        showFilterToggle,
      })
    );

    return { embed, components, totalPages };
  }

  const totalPages = Math.max(1, Math.ceil(activations.length / CHANNELS_PER_PAGE));
  const embed = buildEmbedSingleGuild(activations, page, sortType, query);
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Always render: the filter toggle must stay reachable even when this
  // view is empty (the other filter's view may not be).
  components.push(
    buildBrowseButtons({
      currentPage: page,
      totalPages,
      filter,
      currentSort: sortType,
      query,
      showFilterToggle,
    })
  );

  return { embed, components, totalPages };
}

/**
 * Perform lazy backfill of missing guildId for activations
 */
async function backfillMissingGuildIds(
  activations: ChannelSettings[],
  client: Client,
  userClient: UserClient
): Promise<void> {
  const needsBackfill = activations.filter(a => a.guildId === null);

  if (needsBackfill.length === 0) {
    return;
  }

  logger.info(
    { count: needsBackfill.length },
    'Backfilling missing guildIds for legacy activations'
  );

  for (const activation of needsBackfill) {
    try {
      const channel = await client.channels.fetch(activation.channelId);
      if (channel === null) {
        continue;
      }
      if ('guild' in channel && channel.guild !== null) {
        await userClient.updateChannelGuild({
          channelId: activation.channelId,
          guildId: channel.guild.id,
        });
        activation.guildId = channel.guild.id;
      }
    } catch (error) {
      logger.debug(
        { channelId: activation.channelId, error },
        'Could not backfill guildId (channel may be deleted)'
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

  const options = channelBrowseOptions(interaction);
  const query = options.query();
  const filter = (options.filter() ?? 'current') as ChannelBrowseFilter;

  // Check owner permission for 'all' filter
  if (filter === 'all' && !isBotOwner(context.user.id)) {
    await context.editReply(
      renderSpec(
        CATALOG.error.permissionDenied(
          'use the "All Servers" filter — it is only available to bot owners'
        )
      )
    );
    return;
  }

  const { userClient } = clientsFor(context.interaction);

  try {
    // `context.guildId ?? ''` preserves pre-encode-sweep behavior when the
    // command is invoked in a DM (guildId null) — the gateway rejects
    // empty-guildId requests, so the outcome is the same. A proper
    // "reject in DM" guard belongs upstream if this path is reachable.
    const result = await userClient.listUserChannels(
      filter === 'all' ? {} : { guildId: context.guildId ?? '' }
    );

    if (!result.ok) {
      logger.warn(
        { userId: context.user.id, error: result.error, status: result.status },
        'Browse failed'
      );
      await context.editReply(
        renderSpec(classifyGatewayFailure(result, 'channels', { operation: 'read' }))
      );
      return;
    }

    let { settings } = result.data;

    // Lazy backfill missing guildIds
    await backfillMissingGuildIds(settings, interaction.client, userClient);

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
      showFilterToggle: isBotOwner(context.user.id),
    });

    await context.editReply({ embeds: [embed], components });

    logger.info(
      { userId: context.user.id, count: settings.length, filter, query },
      'Browse channels'
    );
  } catch (error) {
    logger.error({ err: error, userId: context.user.id }, 'Browse error');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'channels', { operation: 'read' }))
    );
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

  await ackUpdate(interaction);

  const { page, filter, sort, query } = parsed;
  const userId = interaction.user.id;

  // Check owner permission for 'all' filter
  if (filter === 'all' && !isBotOwner(userId)) {
    return;
  }

  const { userClient } = clientsFor(interaction);

  try {
    // See matching comment in the primary browse handler above for the
    // `?? ''` fallback rationale.
    const result = await userClient.listUserChannels(
      filter === 'all' ? {} : { guildId: guildId ?? '' }
    );

    if (!result.ok) {
      logger.warn({ userId }, 'Failed to fetch channels for pagination');
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
      showFilterToggle: isBotOwner(userId),
    });

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, userId, page, filter, sort }, 'Failed to load browse page');
    // Keep existing content on error
  }
}
