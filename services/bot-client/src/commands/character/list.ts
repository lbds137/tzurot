/**
 * Character Command - List Handlers
 *
 * Handles the /character list command and pagination.
 * Groups characters by owner BEFORE pagination to ensure
 * users' characters stay together across page boundaries.
 */

import {
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ActionRowBuilder,
  escapeMarkdown,
} from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import { createLogger, type EnvConfig, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { CharacterCustomIds, type CharacterListSortType } from '../../utils/customIds.js';
import { createListComparator } from '../../utils/listSorting.js';
import { fetchUserCharacters, fetchPublicCharacters, fetchUsernames } from './api.js';
import type { CharacterData } from './config.js';

const logger = createLogger('character-list');

/** Characters per page for pagination */
const CHARACTERS_PER_PAGE = 15;

/** Default sort type */
const DEFAULT_SORT: CharacterListSortType = 'date';

/**
 * List item with group markers for rendering.
 * The isGroupStart flag indicates where to render section headers.
 */
interface ListItem {
  char: CharacterData;
  isOwn: boolean;
  isGroupStart: boolean;
  groupHeader?: string;
}

/**
 * Create a character comparator for sorting.
 * Uses shared listSorting utility for consistent sort behavior.
 */
const characterComparator = createListComparator<CharacterData>(
  c => c.displayName ?? c.name,
  c => c.updatedAt
);

/**
 * Format a character line for the list
 */
function formatCharacterLine(c: CharacterData): string {
  const visibility = c.isPublic ? '🌐' : '🔒';
  const displayName = escapeMarkdown(c.displayName ?? c.name);
  return `${visibility} **${displayName}** (\`${c.slug}\`)`;
}

/**
 * Create sorted, grouped list items ready for pagination.
 * Groups are sorted by owner name, characters within groups by sort type.
 * This ensures owner groups stay together across page boundaries.
 */
function createListItems(
  ownCharacters: CharacterData[],
  publicCharacters: CharacterData[],
  creatorNames: Map<string, string>,
  userId: string,
  sortType: CharacterListSortType
): ListItem[] {
  const items: ListItem[] = [];

  // Sort own characters
  const sortedOwn = [...ownCharacters].sort(characterComparator(sortType));

  // Add own characters (first group)
  for (let i = 0; i < sortedOwn.length; i++) {
    items.push({
      char: sortedOwn[i],
      isOwn: true,
      isGroupStart: i === 0,
      groupHeader: i === 0 ? `**📝 Your Characters (${ownCharacters.length})**` : undefined,
    });
  }

  // Filter to other users' public characters
  const othersPublic = publicCharacters.filter(c => c.ownerId !== userId);
  if (othersPublic.length === 0) {
    return items;
  }

  // Group by owner
  const byOwner = new Map<string, CharacterData[]>();
  for (const char of othersPublic) {
    const ownerId = char.ownerId ?? 'system';
    const existing = byOwner.get(ownerId) ?? [];
    existing.push(char);
    byOwner.set(ownerId, existing);
  }

  // Sort characters within each owner group
  for (const chars of byOwner.values()) {
    chars.sort(characterComparator(sortType));
  }

  // Sort owner groups by owner name
  const sortedOwnerGroups = [...byOwner.entries()]
    .map(([ownerId, chars]) => ({
      ownerId,
      ownerName: ownerId === 'system' ? 'System' : (creatorNames.get(ownerId) ?? 'Unknown'),
      chars,
    }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  // Add section header for "Other Users' Characters"
  let isFirstOthersGroup = true;
  for (const group of sortedOwnerGroups) {
    for (let i = 0; i < group.chars.length; i++) {
      const isGroupStart = i === 0;
      let groupHeader: string | undefined;

      if (isGroupStart) {
        if (isFirstOthersGroup) {
          // First group of others gets the section header
          groupHeader = `**🌍 Other Users' Characters (${othersPublic.length})**\n\n__${escapeMarkdown(group.ownerName)}__`;
          isFirstOthersGroup = false;
        } else {
          // Subsequent groups just get owner subheader
          groupHeader = `\n__${escapeMarkdown(group.ownerName)}__`;
        }
      }

      items.push({
        char: group.chars[i],
        isOwn: false,
        isGroupStart,
        groupHeader,
      });
    }
  }

  return items;
}

/**
 * Build pagination and sort buttons for character list
 */
function buildListButtons(
  currentPage: number,
  totalPages: number,
  currentSort: CharacterListSortType
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  // Previous button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.listPage(currentPage - 1, currentSort))
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0)
  );

  // Page indicator (disabled)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.listInfo())
      .setLabel(`Page ${currentPage + 1} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  // Next button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.listPage(currentPage + 1, currentSort))
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  // Sort toggle button
  const newSort: CharacterListSortType = currentSort === 'date' ? 'name' : 'date';
  const sortLabel = currentSort === 'date' ? '🔤 Sort A-Z' : '📅 Sort by Date';
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.sortToggle(currentPage, newSort))
      .setLabel(sortLabel)
      .setStyle(ButtonStyle.Primary)
  );

  return row;
}

/**
 * Build the paginated character list embed and components.
 * Uses pre-grouped items to ensure owner groups stay together.
 */
function buildCharacterListPage(
  allItems: ListItem[],
  ownCount: number,
  page: number,
  sortType: CharacterListSortType
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(allItems.length / CHARACTERS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const startIdx = safePage * CHARACTERS_PER_PAGE;
  const endIdx = Math.min(startIdx + CHARACTERS_PER_PAGE, allItems.length);
  const pageItems = allItems.slice(startIdx, endIdx);

  // Build description with items on this page
  const lines: string[] = [];

  // Handle empty state on first page
  if (safePage === 0 && ownCount === 0) {
    lines.push(`**📝 Your Characters (0)**`);
    lines.push("_You don't have any characters yet._");
    lines.push('Use `/character create` to create your first one!');
    if (pageItems.length > 0 && !pageItems[0].isOwn) {
      lines.push('');
    }
  }

  // Render page items with their group headers
  for (const item of pageItems) {
    if (item.groupHeader !== undefined) {
      // Add separator before "Other Users" section if coming from own chars
      if (!item.isOwn && lines.length > 0 && !lines[lines.length - 1].startsWith('**🌍')) {
        lines.push('');
      }
      lines.push(item.groupHeader);
    }
    lines.push(formatCharacterLine(item.char));
  }

  const sortLabel = sortType === 'date' ? 'by date' : 'alphabetically';
  const embed = new EmbedBuilder()
    .setTitle('📚 Character List')
    .setDescription(lines.join('\n') || 'No characters found.')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setFooter({ text: `${allItems.length} characters • Sorted ${sortLabel}` });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (totalPages > 1 || allItems.length > 0) {
    components.push(buildListButtons(safePage, totalPages, sortType));
  }

  return { embed, components, totalPages };
}

/**
 * Handle list subcommand - show user's characters and global characters
 */
export async function handleList(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const userId = context.user.id;

  try {
    // Fetch user's own characters and all public characters
    const [ownCharacters, publicCharacters] = await Promise.all([
      fetchUserCharacters(userId, config),
      fetchPublicCharacters(userId, config),
    ]);

    // Fetch creator usernames for public characters
    const othersPublic = publicCharacters.filter(c => c.ownerId !== userId);
    const creatorIds = [...new Set(othersPublic.map(c => c.ownerId).filter(Boolean))] as string[];
    const creatorNames = await fetchUsernames(context.interaction.client, creatorIds);

    // Create sorted, grouped items (grouping happens BEFORE pagination)
    const allItems = createListItems(
      ownCharacters,
      publicCharacters,
      creatorNames,
      userId,
      DEFAULT_SORT
    );

    // Build first page
    const { embed, components } = buildCharacterListPage(
      allItems,
      ownCharacters.length,
      0,
      DEFAULT_SORT
    );

    await context.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error }, 'Failed to list characters');
    await context.editReply('❌ Failed to load characters. Please try again.');
  }
}

/**
 * Handle list pagination and sort toggle button clicks
 */
export async function handleListPagination(
  interaction: ButtonInteraction,
  page: number,
  sortType: CharacterListSortType | undefined,
  config: EnvConfig
): Promise<void> {
  await interaction.deferUpdate();

  // Use provided sort or default
  const effectiveSort = sortType ?? DEFAULT_SORT;

  try {
    // Re-fetch character data
    const [ownCharacters, publicCharacters] = await Promise.all([
      fetchUserCharacters(interaction.user.id, config),
      fetchPublicCharacters(interaction.user.id, config),
    ]);

    // Fetch creator usernames for public characters
    const othersPublic = publicCharacters.filter(c => c.ownerId !== interaction.user.id);
    const creatorIds = [...new Set(othersPublic.map(c => c.ownerId).filter(Boolean))] as string[];
    const creatorNames = await fetchUsernames(interaction.client, creatorIds);

    // Create sorted, grouped items with the specified sort
    const allItems = createListItems(
      ownCharacters,
      publicCharacters,
      creatorNames,
      interaction.user.id,
      effectiveSort
    );

    // Build requested page
    const { embed, components } = buildCharacterListPage(
      allItems,
      ownCharacters.length,
      page,
      effectiveSort
    );

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error(
      { err: error, page, sortType: effectiveSort },
      'Failed to load character list page'
    );
    // Keep existing content on error - user can try again
  }
}
