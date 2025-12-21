/**
 * Character Command - List Handlers
 *
 * Handles the /character list command and pagination.
 */

import {
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ActionRowBuilder,
  escapeMarkdown,
} from 'discord.js';
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import { createLogger, type EnvConfig, DISCORD_COLORS } from '@tzurot/common-types';
import { CharacterCustomIds } from '../../utils/customIds.js';
import { fetchUserCharacters, fetchPublicCharacters, fetchUsernames } from './api.js';
import type { CharacterData } from './config.js';

const logger = createLogger('character-list');

/** Characters per page for pagination */
const CHARACTERS_PER_PAGE = 15;

/**
 * Format a character line for the list
 */
function formatCharacterLine(
  c: CharacterData,
  creatorNames?: Map<string, string>,
  showCreator = false
): string {
  const visibility = c.isPublic ? '🌐' : '🔒';
  const displayName = escapeMarkdown(c.displayName ?? c.name);

  if (showCreator && creatorNames) {
    const creatorName = c.ownerId !== null ? (creatorNames.get(c.ownerId) ?? 'Unknown') : 'System';
    return `${visibility} **${displayName}** (\`${c.slug}\`) — by ${escapeMarkdown(creatorName)}`;
  }

  return `${visibility} **${displayName}** (\`${c.slug}\`)`;
}

/**
 * Build pagination buttons for character list
 */
function buildListPaginationButtons(
  currentPage: number,
  totalPages: number
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.listPage(currentPage - 1))
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.listInfo())
      .setLabel(`Page ${currentPage + 1} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.listPage(currentPage + 1))
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  return row;
}

/**
 * Build the paginated character list embed and components
 */
function buildCharacterListPage(
  ownCharacters: CharacterData[],
  publicCharacters: CharacterData[],
  creatorNames: Map<string, string>,
  userId: string,
  page: number
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[]; totalPages: number } {
  // Combine all characters with a marker for which section they're in
  const allItems: { char: CharacterData; isOwn: boolean }[] = [
    ...ownCharacters.map(c => ({ char: c, isOwn: true })),
    ...publicCharacters.filter(c => c.ownerId !== userId).map(c => ({ char: c, isOwn: false })),
  ];

  const totalPages = Math.max(1, Math.ceil(allItems.length / CHARACTERS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const startIdx = safePage * CHARACTERS_PER_PAGE;
  const endIdx = Math.min(startIdx + CHARACTERS_PER_PAGE, allItems.length);
  const pageItems = allItems.slice(startIdx, endIdx);

  // Build description with items on this page
  const lines: string[] = [];

  // Group by section on this page
  const ownOnPage = pageItems.filter(i => i.isOwn);
  const publicOnPage = pageItems.filter(i => !i.isOwn);

  if (ownOnPage.length > 0 || (safePage === 0 && ownCharacters.length === 0)) {
    if (safePage === 0) {
      lines.push(`**📝 Your Characters (${ownCharacters.length})**`);
    }
    if (ownCharacters.length === 0) {
      lines.push("_You don't have any characters yet._");
      lines.push('Use `/character create` to create your first one!');
    } else {
      for (const item of ownOnPage) {
        lines.push(formatCharacterLine(item.char));
      }
    }
  }

  if (publicOnPage.length > 0) {
    if (ownOnPage.length > 0) {
      lines.push(''); // Separator
    }
    const othersCount = publicCharacters.filter(c => c.ownerId !== userId).length;
    if (startIdx <= ownCharacters.length) {
      lines.push(`**🌍 Global Characters (${othersCount})**`);
    }
    for (const item of publicOnPage) {
      lines.push(formatCharacterLine(item.char, creatorNames, true));
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📚 Character List')
    .setDescription(lines.join('\n') || 'No characters found.')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setFooter({ text: `Total: ${allItems.length} characters` });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (totalPages > 1) {
    components.push(buildListPaginationButtons(safePage, totalPages));
  }

  return { embed, components, totalPages };
}

/**
 * Handle list subcommand - show user's characters and global characters
 */
export async function handleList(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  try {
    // Fetch user's own characters and all public characters
    const [ownCharacters, publicCharacters] = await Promise.all([
      fetchUserCharacters(interaction.user.id, config),
      fetchPublicCharacters(interaction.user.id, config),
    ]);

    // Fetch creator usernames for public characters
    const othersPublic = publicCharacters.filter(c => c.ownerId !== interaction.user.id);
    const creatorIds = [...new Set(othersPublic.map(c => c.ownerId).filter(Boolean))] as string[];
    const creatorNames = await fetchUsernames(interaction.client, creatorIds);

    // Build first page
    const { embed, components } = buildCharacterListPage(
      ownCharacters,
      publicCharacters,
      creatorNames,
      interaction.user.id,
      0
    );

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error }, 'Failed to list characters');
    await interaction.editReply('❌ Failed to load characters. Please try again.');
  }
}

/**
 * Handle list pagination button clicks
 */
export async function handleListPagination(
  interaction: ButtonInteraction,
  page: number,
  config: EnvConfig
): Promise<void> {
  await interaction.deferUpdate();

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

    // Build requested page
    const { embed, components } = buildCharacterListPage(
      ownCharacters,
      publicCharacters,
      creatorNames,
      interaction.user.id,
      page
    );

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, page }, 'Failed to load character list page');
    // Keep existing content on error - user can try again
  }
}
