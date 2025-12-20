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

/** Channels per page for pagination */
const CHANNELS_PER_PAGE = 10;

/** Button collector timeout in milliseconds (60 seconds) */
const COLLECTOR_TIMEOUT_MS = 60_000;

/**
 * Format a single activation for display
 */
function formatActivation(activation: ActivatedChannel): string {
  const channelMention = `<#${activation.channelId}>`;
  const activatedDate = new Date(activation.createdAt).toLocaleDateString();
  return `${channelMention} → **${activation.personalityName}** (\`${activation.personalitySlug}\`)\n  _Activated: ${activatedDate}_`;
}

/**
 * Sort activations by the specified sort type
 */
function sortActivations(
  activations: ActivatedChannel[],
  sortType: ChannelListSortType,
  client: Client
): ActivatedChannel[] {
  const sorted = [...activations];

  if (sortType === 'name') {
    // Sort alphabetically by channel name
    sorted.sort((a, b) => {
      const channelA = client.channels.cache.get(a.channelId) as TextChannel | undefined;
      const channelB = client.channels.cache.get(b.channelId) as TextChannel | undefined;
      const nameA = channelA?.name ?? a.channelId;
      const nameB = channelB?.name ?? b.channelId;
      return nameA.localeCompare(nameB);
    });
  } else {
    // Sort chronologically (newest first)
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  return sorted;
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
 * Build embed for a page of activations
 */
function buildEmbed(
  activations: ActivatedChannel[],
  page: number,
  sortType: ChannelListSortType,
  isAllServers: boolean,
  client: Client
): EmbedBuilder {
  const totalPages = Math.max(1, Math.ceil(activations.length / CHANNELS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * CHANNELS_PER_PAGE;
  const pageActivations = activations.slice(start, start + CHANNELS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setTitle('📍 Activated Channels')
    .setColor(DISCORD_COLORS.BLURPLE);

  if (isAllServers) {
    // Group by server for admin view
    const byGuild = new Map<string, ActivatedChannel[]>();
    for (const activation of pageActivations) {
      const gid = activation.guildId ?? 'unknown';
      if (!byGuild.has(gid)) {
        byGuild.set(gid, []);
      }
      byGuild.get(gid)!.push(activation);
    }

    const sections: string[] = [];
    for (const [guildId, guildActivations] of byGuild) {
      const guild = client.guilds.cache.get(guildId);
      const guildName = guild?.name ?? `Unknown Server (${guildId})`;

      const channelList = guildActivations
        .map(a => `  <#${a.channelId}> → **${a.personalityName}**`)
        .join('\n');

      sections.push(`**${guildName}**\n${channelList}`);
    }

    embed.setDescription(sections.join('\n\n') || 'No activated channels found.');
  } else {
    // Simple list for current server view
    const lines = pageActivations.map(formatActivation);
    embed.setDescription(lines.join('\n\n') || 'No activated channels in this server.');
  }

  const sortLabel = sortType === 'date' ? 'by date' : 'alphabetically';
  embed.setFooter({
    text: `${activations.length} total • Sorted ${sortLabel} • Page ${safePage + 1} of ${totalPages}`,
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

    // Initial sort: chronological (newest first)
    const sortType: ChannelListSortType = 'date';
    const sortedActivations = sortActivations(activations, sortType, interaction.client);

    const totalPages = Math.ceil(sortedActivations.length / CHANNELS_PER_PAGE);
    const embed = buildEmbed(sortedActivations, 0, sortType, showAll, interaction.client);
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

        const newSortedActivations = sortActivations(activations, newSort, interaction.client);
        const newTotalPages = Math.ceil(newSortedActivations.length / CHANNELS_PER_PAGE);
        const newEmbed = buildEmbed(
          newSortedActivations,
          newPage,
          newSort,
          showAll,
          interaction.client
        );
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
