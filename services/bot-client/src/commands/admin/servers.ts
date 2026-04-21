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
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction, Guild } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  buildBrowseButtons,
  buildBrowseSelectMenu,
  createBrowseCustomIdHelpers,
  joinFooter,
  formatSortNatural,
  formatSortVerbatim,
  type BrowseSortToggle,
  type BrowseActionRow,
} from '../../utils/browse/index.js';

const logger = createLogger('admin-servers');

/** Servers per page for pagination */
const SERVERS_PER_PAGE = 10;

/** Sort options — custom union widens `TSort` from the factory's default `BrowseSortType`. */
type ServerBrowseSortType = 'members' | 'name';

/** Default sort type */
const DEFAULT_SORT: ServerBrowseSortType = 'members';

/** Filter type — admin/servers shows all servers, no filtering concept. */
type ServerBrowseFilter = 'all';

/**
 * Browse customId helpers using the shared factory.
 *
 * Two generic parameters are used here because admin/servers has a
 * custom sort type (`'members' | 'name'`) that doesn't match the
 * standard `BrowseSortType = 'name' | 'date'`. Passing `validSorts`
 * is required when widening `TSort` — the factory's default only
 * applies to the standard type.
 *
 * The "Back to List" button in the detail view reuses the browse
 * customId (`browseHelpers.build(page, 'all', sort, null)`) so its
 * click routes through the same pagination handler as regular page
 * navigation. Before this migration, admin had a separate `::back::`
 * prefix and a duplicate handler — now deleted.
 */
const browseHelpers = createBrowseCustomIdHelpers<ServerBrowseFilter, ServerBrowseSortType>({
  prefix: 'admin-servers',
  validFilters: ['all'],
  validSorts: ['members', 'name'],
});

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
 * Check if a customId is an admin-servers browse PAGINATION button.
 *
 * After the Session 5 Part B migration, the "Back to List" button on
 * the server details view also uses the browse customId shape (see
 * `buildServerDetailsEmbed`), so this single guard catches regular
 * pagination clicks and back-button clicks.
 *
 * Exported for admin/index.ts button router.
 */
export function isServersBrowsePagination(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/**
 * Check if a customId is an admin-servers browse SELECT menu.
 *
 * Exported for admin/index.ts select menu router. Kept as a separate
 * function from `isServersBrowsePagination` because Discord.js dispatches
 * button and select menu interactions to different handlers — each
 * router should only match the prefixes it can actually receive.
 */
export function isServersBrowseSelect(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
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
 * Sort toggle for admin/servers' custom `'members' | 'name'` sort space.
 *
 * The shared `buildBrowseButtons` factory requires callers that widen
 * `TSort` beyond the default `BrowseSortType` to provide a matching
 * `sortToggle` at compile time. This constant is that toggle:
 *
 * - `next('members') → 'name'` and vice versa (binary flip)
 * - `labelFor('name')` shows "Sort A-Z" with 🔤 (A-Z is the action the
 *   button performs when currentSort is 'members')
 * - `labelFor('members')` shows "Sort by Members" with 👥 (the action
 *   when currentSort is 'name')
 *
 * The button shows the label/emoji for the *next* sort — i.e., the
 * action the button performs — not the current sort. See
 * `buildBrowseButtons` in `utils/browse/buttonBuilder.ts` for details.
 */
const SERVERS_SORT_TOGGLE: BrowseSortToggle<ServerBrowseSortType> = {
  next: current => (current === 'members' ? 'name' : 'members'),
  labelFor: sort =>
    sort === 'name'
      ? { label: 'Sort A-Z', emoji: '🔤' }
      : { label: 'Sort by Members', emoji: '👥' },
};

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
  embed.setFooter({
    text: joinFooter(
      `${formatMemberCount(totalMembers)} total members`,
      sortType === 'members'
        ? formatSortNatural('member count')
        : formatSortVerbatim('Sorted alphabetically')
    ),
  });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu if there are items on this page. The factory returns
  // null on empty input — the explicit length check is redundant with that
  // but kept for symmetry with the embed-renders-empty-state path above.
  const selectRow = buildBrowseSelectMenu<GuildInfo>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, 'all', sortType, null),
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
    components.push(
      buildBrowseButtons<ServerBrowseFilter, ServerBrowseSortType>({
        currentPage: safePage,
        totalPages,
        filter: 'all',
        currentSort: sortType,
        query: null,
        buildCustomId: browseHelpers.build,
        buildInfoId: browseHelpers.buildInfo,
        sortToggle: SERVERS_SORT_TOGGLE,
      })
    );
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

  // Back button — reuses the browse customId so clicking back routes
  // through the same pagination handler as regular page navigation.
  // Before the Session 5 Part B migration, admin had a separate
  // `::back::` prefix with a duplicate handler; now simplified away.
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(browseHelpers.build(page, 'all', sort, null))
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

    logger.info({ count: guilds.length }, 'Browse servers');
  } catch (error) {
    logger.error({ err: error }, 'Error listing servers');
    await context.editReply({ content: '❌ Failed to retrieve server list.' });
  }
}

/**
 * Handle browse pagination button clicks.
 *
 * Also handles "Back to List" clicks from the detail view — the back
 * button uses the same customId shape as pagination (see the comment
 * on browseHelpers above), so a single handler covers both cases.
 */
export async function handleServersBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    // Stale pre-migration click: `isServersBrowsePagination` is a prefix
    // match (`admin-servers::browse::`) which is unchanged from the old
    // 4-part format, but `parse()` rejects the wrong segment count and
    // returns null. We can't handle this click, so we silently return
    // without acking — Discord shows "This interaction failed" after the
    // 3-second timeout. Acceptable trade-off: stale clicks are bounded
    // to the deploy window (Discord interactions expire in ~15 min) and
    // the alternative (acking + showing an error) costs a round-trip
    // to display a message the user can't act on anyway.
    return;
  }

  await interaction.deferUpdate();

  try {
    const guildsCache = interaction.client.guilds.cache;
    const guilds = Array.from(guildsCache.values()).map(getGuildInfo);

    const { embed, components } = buildBrowsePage(guilds, parsed.page, parsed.sort);
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error }, 'Failed to load servers browse page');
  }
}

/**
 * Handle select menu - show server details
 */
export async function handleServersSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const parsed = browseHelpers.parseSelect(interaction.customId);
  if (parsed === null) {
    // Stale or malformed customId — silently return without acking. See
    // the equivalent guard in `handleServersBrowsePagination` above for
    // the full reasoning. Note: the `::browse-select::` prefix is NEW
    // (introduced by this PR), so the stale-click window here is the
    // narrower "post-deploy with cached interaction" case rather than
    // the full pre-migration history.
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

    logger.info({ guildId, guildName: guild.name }, 'View server details');
  } catch (error) {
    logger.error({ err: error, guildId }, 'Failed to load server details');
    await interaction.editReply({
      content: '❌ Failed to load server details.',
      embeds: [],
      components: [],
    });
  }
}
