/**
 * Channel List Subcommand
 * Handles /channel list
 *
 * Lists all channels with activated personalities.
 * Features:
 * - Server-scoped filtering (shows only current server by default)
 * - Manage Messages permission required
 * - Admin --all flag for cross-server view (grouped by server)
 * - Interactive pagination with buttons
 * - Sort toggle (chronological vs alphabetical)
 * - Lazy backfill of missing guildId data
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
  type ListChannelActivationsResponse,
  type ActivatedChannel,
  DISCORD_COLORS,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { requireManageMessagesDeferred } from '../../utils/permissions.js';
import { ChannelCustomIds, type ChannelListSortType } from '../../utils/customIds.js';

const logger = createLogger('channel-list');

/** Channels per page for pagination (single guild mode) */
const CHANNELS_PER_PAGE = 10;

/** Channels per page for all-servers mode (slightly smaller to account for guild headers) */
export const CHANNELS_PER_PAGE_ALL_SERVERS = 8;

/** Button collector timeout in milliseconds (60 seconds) */
const COLLECTOR_TIMEOUT_MS = 60_000;

/**
 * Format a single activation for display
 */
function formatActivation(activation: ActivatedChannel): string {
  const channelMention = `<#${activation.channelId}>`;
  const activatedDate = new Date(activation.createdAt).toLocaleDateString();
  const safeName = escapeMarkdown(activation.personalityName);
  return `${channelMention} → **${safeName}** (\`${activation.personalitySlug}\`)\n  _Activated: ${activatedDate}_`;
}

/**
 * Sort activations by the specified sort type
 * When isAllServers=true, groups by guild first, then sorts within each guild
 */
function sortActivations(
  activations: ActivatedChannel[],
  sortType: ChannelListSortType,
  client: Client,
  isAllServers = false
): ActivatedChannel[] {
  const sorted = [...activations];

  // Helper to get channel name for sorting
  const getChannelName = (activation: ActivatedChannel): string => {
    const channel = client.channels.cache.get(activation.channelId) as TextChannel | undefined;
    return channel?.name ?? activation.channelId;
  };

  // Helper to get guild name for sorting
  const getGuildName = (activation: ActivatedChannel): string => {
    if (activation.guildId === null) {
      return 'zzz_unknown'; // Sort unknown guilds last
    }
    const guild = client.guilds.cache.get(activation.guildId);
    return guild?.name ?? activation.guildId;
  };

  // Secondary sort function (within guild or for single-guild mode)
  const secondarySort = (a: ActivatedChannel, b: ActivatedChannel): number => {
    if (sortType === 'name') {
      return getChannelName(a).localeCompare(getChannelName(b));
    } else {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  };

  if (isAllServers) {
    // Group by guild first, then sort within each guild
    sorted.sort((a, b) => {
      const guildCompare = getGuildName(a).localeCompare(getGuildName(b));
      if (guildCompare !== 0) {
        return guildCompare;
      }
      return secondarySort(a, b);
    });
  } else {
    // Single guild mode - just use secondary sort
    sorted.sort(secondarySort);
  }

  return sorted;
}

/**
 * Represents a page of guild activations for all-servers view
 *
 * Note: guildName stores the raw (unescaped) name. Escaping is done at display time
 * in buildEmbedAllServers() to keep data structures clean and allow future reuse.
 */
export interface GuildPage {
  guildId: string;
  guildName: string; // Raw name - escape with escapeMarkdown() when displaying
  activations: ActivatedChannel[];
  isContinuation: boolean; // True if this continues from previous page
  isComplete: boolean; // True if this is the last page for this guild
}

/**
 * Build guild-aware pages for all-servers view
 * Each page contains channels from a single guild only.
 * Large guilds are split across multiple pages with continuation indicators.
 */
export function buildGuildPages(activations: ActivatedChannel[], client: Client): GuildPage[] {
  const pages: GuildPage[] = [];

  // Group by guild (activations are already sorted by guild)
  const guildGroups: { guildId: string; guildName: string; activations: ActivatedChannel[] }[] = [];
  let currentGroup: (typeof guildGroups)[0] | null = null;

  for (const activation of activations) {
    const guildId = activation.guildId ?? 'unknown';
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- explicit null check required for type narrowing
    if (currentGroup === null || currentGroup.guildId !== guildId) {
      const guild = guildId !== 'unknown' ? client.guilds.cache.get(guildId) : undefined;
      const guildName: string = guild?.name ?? `Unknown Server (${guildId})`;
      currentGroup = { guildId, guildName, activations: [] };
      guildGroups.push(currentGroup);
    }
    currentGroup.activations.push(activation);
  }

  // Split each guild into pages
  for (const group of guildGroups) {
    const totalChannels = group.activations.length;
    let offset = 0;

    while (offset < totalChannels) {
      const pageActivations = group.activations.slice(
        offset,
        offset + CHANNELS_PER_PAGE_ALL_SERVERS
      );
      const isContinuation = offset > 0;
      const isComplete = offset + pageActivations.length >= totalChannels;

      pages.push({
        guildId: group.guildId,
        guildName: group.guildName,
        activations: pageActivations,
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
  activations: ActivatedChannel[],
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

  const lines = pageActivations.map(formatActivation);
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

  const channelList = guildPage.activations
    .map(a => `<#${a.channelId}> → **${escapeMarkdown(a.personalityName)}**`)
    .join('\n');

  embed.setDescription(channelList || 'No activated channels found.');

  // Build footer with context
  const sortLabel = sortType === 'date' ? 'by date' : 'alphabetically';
  const channelCount = guildPage.activations.length;
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
  activations: ActivatedChannel[],
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
 * Handle /channel list command
 */
export async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler

  // Check permission - require Manage Messages
  if (!(await requireManageMessagesDeferred(interaction))) {
    return;
  }

  const showAll = interaction.options.getBoolean('all') ?? false;
  const guildId = interaction.guildId;

  // Check --all permission (bot owner only)
  if (showAll) {
    // Note: requireBotOwner handles the error message
    if (!(await requireBotOwner(interaction))) {
      return;
    }
  }

  try {
    // Build query path with optional guildId filter
    const queryPath = showAll ? '/user/channel/list' : `/user/channel/list?guildId=${guildId}`;

    const result = await callGatewayApi<ListChannelActivationsResponse>(queryPath, {
      userId: interaction.user.id,
      method: 'GET',
    });

    if (!result.ok) {
      logger.warn(
        {
          userId: interaction.user.id,
          error: result.error,
          status: result.status,
        },
        '[Channel] List failed'
      );

      await interaction.editReply(`❌ Failed to list activations: ${result.error}`);
      return;
    }

    let { activations } = result.data;

    // Lazy backfill missing guildIds
    await backfillMissingGuildIds(activations, interaction.client, interaction.user.id);

    // For current server view, filter again after backfill (in case some got resolved)
    if (!showAll && guildId !== null) {
      activations = activations.filter(a => a.guildId === guildId);
    }

    if (activations.length === 0) {
      const scopeMessage = showAll
        ? 'No channels have activated personalities across all servers.'
        : 'No channels have activated personalities in this server.';

      await interaction.editReply(
        `📍 ${scopeMessage}\n\n` + 'Use `/channel activate` in a channel to set up auto-responses.'
      );
      return;
    }

    // Initial sort: chronological (newest first), grouped by guild if showing all
    const sortType: ChannelListSortType = 'date';
    const sortedActivations = sortActivations(activations, sortType, interaction.client, showAll);

    // Build initial embed and components based on mode
    let embed: EmbedBuilder;
    let totalPages: number;

    if (showAll) {
      // All-servers mode: use guild-aware pagination
      const guildPages = buildGuildPages(sortedActivations, interaction.client);
      totalPages = guildPages.length;
      embed = buildEmbedAllServers(guildPages, 0, sortType, activations.length);
    } else {
      // Single guild mode: use simple pagination
      totalPages = Math.ceil(sortedActivations.length / CHANNELS_PER_PAGE);
      embed = buildEmbedSingleGuild(sortedActivations, 0, sortType);
    }

    // Always show buttons (sort toggle useful even with 1 page)
    const components = [buildButtons(0, totalPages, sortType)];

    const response = await interaction.editReply({ embeds: [embed], components });

    logger.info(
      {
        userId: interaction.user.id,
        count: activations.length,
        showAll,
      },
      '[Channel] Listed activations'
    );

    // Set up button collector for pagination and sorting
    if (components.length > 0) {
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
          // Sort toggle - use the new sort from the button
          newPage = 0; // Reset to first page when changing sort
        }

        const newSortedActivations = sortActivations(
          activations,
          newSort,
          interaction.client,
          showAll
        );

        let newEmbed: EmbedBuilder;
        let newTotalPages: number;

        if (showAll) {
          // All-servers mode: use guild-aware pagination
          const newGuildPages = buildGuildPages(newSortedActivations, interaction.client);
          newTotalPages = newGuildPages.length;
          newEmbed = buildEmbedAllServers(newGuildPages, newPage, newSort, activations.length);
        } else {
          // Single guild mode: use simple pagination
          newTotalPages = Math.ceil(newSortedActivations.length / CHANNELS_PER_PAGE);
          newEmbed = buildEmbedSingleGuild(newSortedActivations, newPage, newSort);
        }

        const newComponents = [buildButtons(newPage, newTotalPages, newSort)];

        void buttonInteraction.update({ embeds: [newEmbed], components: newComponents });
      });

      collector.on('end', () => {
        // Disable buttons after timeout
        void interaction.editReply({ components: [] }).catch(() => {
          // Ignore errors if message was deleted
        });
      });
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
