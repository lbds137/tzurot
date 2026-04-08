/**
 * Admin Servers Subcommand
 * Handles /admin servers with browse pattern
 *
 * Features:
 * - Paginated server list (10 per page)
 * - Select menu to view server details
 * - Sort by name or member count
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import {
  EmbedBuilder,
  escapeMarkdown,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction, Guild } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { buildBrowseSelectMenu } from '../../utils/browse/index.js';

const logger = createLogger('admin-servers');

/** Servers per page for pagination */
const SERVERS_PER_PAGE = 10;

/** Sort options */
type ServerBrowseSortType = 'name' | 'members';

/** Default sort type */
const DEFAULT_SORT: ServerBrowseSortType = 'members';

/** Custom ID prefixes */
const BROWSE_PREFIX = 'admin-servers::browse';
const SELECT_PREFIX = 'admin-servers::select';
const BACK_PREFIX = 'admin-servers::back';

/**
 * Guild info for display
 */
interface GuildInfo {
  id: string;
  name: string;
  memberCount: number;
  ownerId: string | null;
  createdAt: Date;
  icon: string | null;
}

/**
 * Extract guild info for display
 */
function getGuildInfo(guild: Guild): GuildInfo {
  return {
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount,
    ownerId: guild.ownerId,
    createdAt: guild.createdAt,
    icon: guild.iconURL({ size: 64 }),
  };
}

/**
 * Sort guilds by the specified type
 */
function sortGuilds(guilds: GuildInfo[], sortType: ServerBrowseSortType): GuildInfo[] {
  const sorted = [...guilds];
  if (sortType === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // Sort by member count descending
    sorted.sort((a, b) => b.memberCount - a.memberCount);
  }
  return sorted;
}

/**
 * Build custom ID for browse pagination
 */
function buildBrowseCustomId(page: number, sort: ServerBrowseSortType): string {
  return `${BROWSE_PREFIX}::${page}::${sort}`;
}

/**
 * Parse browse custom ID
 */
export function parseBrowseCustomId(
  customId: string
): { page: number; sort: ServerBrowseSortType } | null {
  if (!customId.startsWith(BROWSE_PREFIX)) {
    return null;
  }

  const parts = customId.split('::');
  if (parts.length < 4) {
    return null;
  }

  const page = parseInt(parts[2], 10);
  const sort = parts[3] as ServerBrowseSortType;

  if (isNaN(page)) {
    return null;
  }

  if (!['name', 'members'].includes(sort)) {
    return null;
  }

  return { page, sort };
}

/**
 * Build custom ID for select menu
 */
function buildSelectCustomId(page: number, sort: ServerBrowseSortType): string {
  return `${SELECT_PREFIX}::${page}::${sort}`;
}

/**
 * Parse select custom ID
 */
export function parseSelectCustomId(
  customId: string
): { page: number; sort: ServerBrowseSortType } | null {
  if (!customId.startsWith(SELECT_PREFIX)) {
    return null;
  }

  const parts = customId.split('::');
  if (parts.length < 4) {
    return null;
  }

  const page = parseInt(parts[2], 10);
  const sort = parts[3] as ServerBrowseSortType;

  if (isNaN(page)) {
    return null;
  }

  return { page, sort };
}

/**
 * Build custom ID for back button
 */
function buildBackCustomId(page: number, sort: ServerBrowseSortType): string {
  return `${BACK_PREFIX}::${page}::${sort}`;
}

/**
 * Parse back custom ID
 */
export function parseBackCustomId(
  customId: string
): { page: number; sort: ServerBrowseSortType } | null {
  if (!customId.startsWith(BACK_PREFIX)) {
    return null;
  }

  const parts = customId.split('::');
  if (parts.length < 4) {
    return null;
  }

  const page = parseInt(parts[2], 10);
  const sort = parts[3] as ServerBrowseSortType;

  if (isNaN(page)) {
    return null;
  }

  return { page, sort };
}

/**
 * Check if custom ID is a servers browse interaction
 */
export function isServersBrowseInteraction(customId: string): boolean {
  return (
    customId.startsWith(BROWSE_PREFIX) ||
    customId.startsWith(SELECT_PREFIX) ||
    customId.startsWith(BACK_PREFIX)
  );
}

/**
 * Format member count for display
 */
function formatMemberCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Build pagination and sort buttons
 */
function buildButtons(
  currentPage: number,
  totalPages: number,
  currentSort: ServerBrowseSortType
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  // Previous button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildBrowseCustomId(currentPage - 1, currentSort))
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0)
  );

  // Page indicator (disabled)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${BROWSE_PREFIX}::info`)
      .setLabel(`Page ${currentPage + 1} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  // Next button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildBrowseCustomId(currentPage + 1, currentSort))
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  // Sort toggle button
  const newSort: ServerBrowseSortType = currentSort === 'members' ? 'name' : 'members';
  const sortEmoji = currentSort === 'members' ? '🔤' : '👥';
  const sortLabel = currentSort === 'members' ? 'Sort A-Z' : 'Sort by Members';
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildBrowseCustomId(currentPage, newSort))
      .setLabel(sortLabel)
      .setEmoji(sortEmoji)
      .setStyle(ButtonStyle.Primary)
  );

  return row;
}

/** Union type for action rows */
type BrowseActionRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

/**
 * Build the browse embed and components
 */
function buildBrowsePage(
  guilds: GuildInfo[],
  page: number,
  sortType: ServerBrowseSortType
): {
  embed: EmbedBuilder;
  components: BrowseActionRow[];
} {
  // Sort guilds
  const sortedGuilds = sortGuilds(guilds, sortType);

  const totalPages = Math.max(1, Math.ceil(sortedGuilds.length / SERVERS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const startIdx = safePage * SERVERS_PER_PAGE;
  const endIdx = Math.min(startIdx + SERVERS_PER_PAGE, sortedGuilds.length);
  const pageItems = sortedGuilds.slice(startIdx, endIdx);

  // Build description lines
  const lines: string[] = [];

  if (sortedGuilds.length === 0) {
    lines.push('_Bot is not in any servers._');
  } else {
    pageItems.forEach((guild, index) => {
      const num = startIdx + index + 1;
      lines.push(
        `**${num}.** ${escapeMarkdown(guild.name)}\n` +
          `    └ ${formatMemberCount(guild.memberCount)} members • \`${guild.id}\``
      );
    });
  }

  // Calculate total members
  const totalMembers = guilds.reduce((sum, g) => sum + g.memberCount, 0);

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle(`📋 Server List (${guilds.length} total)`)
    .setColor(DISCORD_COLORS.BLURPLE)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  // Footer
  const sortLabel = sortType === 'members' ? 'by member count' : 'alphabetically';
  embed.setFooter({
    text: `${formatMemberCount(totalMembers)} total members • Sorted ${sortLabel}`,
  });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu if there are items on this page. The factory returns
  // null on empty input — the explicit length check is redundant with that
  // but kept for symmetry with the embed-renders-empty-state path above.
  const selectRow = buildBrowseSelectMenu<GuildInfo>({
    items: pageItems,
    customId: buildSelectCustomId(safePage, sortType),
    placeholder: 'Select a server to view details...',
    startIndex: startIdx,
    formatItem: guild => ({
      label: `${guild.name} (${formatMemberCount(guild.memberCount)})`,
      value: guild.id,
      description: `ID: ${guild.id}`,
    }),
  });
  if (selectRow !== null) {
    components.push(selectRow);
  }

  // Add pagination buttons if items exist
  if (sortedGuilds.length > 0) {
    components.push(buildButtons(safePage, totalPages, sortType));
  }

  return { embed, components };
}

/**
 * Build server details embed
 */
function buildServerDetailsEmbed(
  guild: GuildInfo,
  page: number,
  sort: ServerBrowseSortType
): {
  embed: EmbedBuilder;
  components: BrowseActionRow[];
} {
  const embed = new EmbedBuilder()
    .setTitle(`🏠 ${escapeMarkdown(guild.name)}`)
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  if (guild.icon !== null) {
    embed.setThumbnail(guild.icon);
  }

  embed.addFields(
    { name: 'Server ID', value: `\`${guild.id}\``, inline: true },
    { name: 'Members', value: formatMemberCount(guild.memberCount), inline: true },
    {
      name: 'Owner ID',
      value: guild.ownerId !== null ? `\`${guild.ownerId}\`` : 'Unknown',
      inline: true,
    },
    {
      name: 'Created',
      value: `<t:${Math.floor(guild.createdAt.getTime() / 1000)}:R>`,
      inline: true,
    }
  );

  // Back button
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildBackCustomId(page, sort))
      .setLabel('Back to List')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, components: [row] };
}

/**
 * Handle /admin servers - show browse page
 */
export async function handleServers(context: DeferredCommandContext): Promise<void> {
  try {
    const guildsCache = context.interaction.client.guilds.cache;
    const guilds = Array.from(guildsCache.values()).map(getGuildInfo);

    const { embed, components } = buildBrowsePage(guilds, 0, DEFAULT_SORT);
    await context.editReply({ embeds: [embed], components });

    logger.info({ count: guilds.length }, '[Admin] Browse servers');
  } catch (error) {
    logger.error({ err: error }, '[Admin] Error listing servers');
    await context.editReply({ content: '❌ Failed to retrieve server list.' });
  }
}

/**
 * Handle browse pagination button clicks
 */
export async function handleServersBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseBrowseCustomId(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  try {
    const guildsCache = interaction.client.guilds.cache;
    const guilds = Array.from(guildsCache.values()).map(getGuildInfo);

    const { embed, components } = buildBrowsePage(guilds, parsed.page, parsed.sort);
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error }, '[Admin] Failed to load servers browse page');
  }
}

/**
 * Handle select menu - show server details
 */
export async function handleServersSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const parsed = parseSelectCustomId(interaction.customId);
  if (parsed === null) {
    return;
  }

  const guildId = interaction.values[0];
  await interaction.deferUpdate();

  try {
    const guild = interaction.client.guilds.cache.get(guildId);
    if (guild === undefined) {
      await interaction.editReply({
        content: '❌ Server not found. It may have been removed.',
        embeds: [],
        components: [],
      });
      return;
    }

    const guildInfo = getGuildInfo(guild);
    const { embed, components } = buildServerDetailsEmbed(guildInfo, parsed.page, parsed.sort);
    await interaction.editReply({ embeds: [embed], components });

    logger.info({ guildId, guildName: guild.name }, '[Admin] View server details');
  } catch (error) {
    logger.error({ err: error, guildId }, '[Admin] Failed to load server details');
    await interaction.editReply({
      content: '❌ Failed to load server details.',
      embeds: [],
      components: [],
    });
  }
}

/**
 * Handle back button - return to browse list
 */
export async function handleServersBack(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseBackCustomId(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  try {
    const guildsCache = interaction.client.guilds.cache;
    const guilds = Array.from(guildsCache.values()).map(getGuildInfo);

    const { embed, components } = buildBrowsePage(guilds, parsed.page, parsed.sort);
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error }, '[Admin] Failed to return to servers browse');
  }
}
