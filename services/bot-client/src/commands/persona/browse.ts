/**
 * Persona Browse Handler
 *
 * Handles /persona browse subcommand
 * Shows a paginated list of user's personas with select menu to edit
 */

import {
  ButtonBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, type ListPersonasResponse } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import {
  ITEMS_PER_PAGE,
  truncateForSelect,
  buildBrowseButtons as buildSharedBrowseButtons,
  createBrowseCustomIdHelpers,
  type BrowseSortType,
} from '../../utils/browse/index.js';
import { createListComparator } from '../../utils/listSorting.js';
import {
  PERSONA_DASHBOARD_CONFIG,
  flattenPersonaData,
  type FlattenedPersonaData,
} from './config.js';
import { fetchPersona } from './api.js';
import { buildPersonaDashboardOptions } from './dashboard.js';
import type { PersonaSummary } from './types.js';

const logger = createLogger('persona-browse');

/** Persona browse doesn't use filters, so we use a single 'all' value */
type PersonaBrowseFilter = 'all';

/** Browse customId helpers using shared factory */
const browseHelpers = createBrowseCustomIdHelpers<PersonaBrowseFilter>({
  prefix: 'persona',
  validFilters: ['all'] as const,
});

/** Default sort type */
const DEFAULT_SORT: BrowseSortType = 'name';

/** Create comparator for persona sorting using shared utility */
const personaComparator = createListComparator<PersonaSummary>(
  persona => persona.name,
  persona => persona.createdAt
);

/**
 * Sort personas by the specified type using shared sorting utility
 */
function sortPersonas(personas: PersonaSummary[], sortType: BrowseSortType): PersonaSummary[] {
  return [...personas].sort(personaComparator(sortType));
}

/**
 * Build select menu for choosing a persona from the list
 */
function buildBrowseSelectMenu(
  pageItems: PersonaSummary[],
  startIdx: number,
  page: number,
  sort: BrowseSortType
): ActionRowBuilder<StringSelectMenuBuilder> {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(browseHelpers.buildSelect(page, 'all', sort, null))
    .setPlaceholder('Select a persona to view/edit...')
    .setMinValues(1)
    .setMaxValues(1);

  pageItems.forEach((persona, index) => {
    const num = startIdx + index + 1;

    // Build badges
    const defaultBadge = persona.isDefault ? '⭐' : '';
    const nameBadge =
      persona.preferredName !== null &&
      persona.preferredName !== undefined &&
      persona.preferredName !== ''
        ? `(${persona.preferredName})`
        : '';

    // Label: "1. ⭐ Persona Name (PreferredName)"
    const label = truncateForSelect(`${num}. ${defaultBadge} ${persona.name} ${nameBadge}`.trim());

    // Description
    const description = persona.isDefault ? 'Default persona' : 'Click to edit';

    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(persona.id)
        .setDescription(description)
    );
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}

/**
 * Build pagination and sort buttons using shared utility
 */
function buildBrowseButtons(
  currentPage: number,
  totalPages: number,
  currentSort: BrowseSortType
): ReturnType<typeof buildSharedBrowseButtons> {
  return buildSharedBrowseButtons({
    currentPage,
    totalPages,
    filter: 'all', // Persona browse doesn't use filters
    currentSort,
    query: null, // Persona browse doesn't use query
    buildCustomId: browseHelpers.build,
    buildInfoId: browseHelpers.buildInfo,
  });
}

/** Union type for action rows */
type BrowseActionRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

/**
 * Build the browse embed and components
 */
function buildBrowsePage(
  personas: PersonaSummary[],
  page: number,
  sortType: BrowseSortType
): {
  embed: EmbedBuilder;
  components: BrowseActionRow[];
} {
  // Sort personas
  const sortedPersonas = sortPersonas(personas, sortType);

  const totalPages = Math.max(1, Math.ceil(sortedPersonas.length / ITEMS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const startIdx = safePage * ITEMS_PER_PAGE;
  const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, sortedPersonas.length);
  const pageItems = sortedPersonas.slice(startIdx, endIdx);

  // Build description lines
  const lines: string[] = [];

  if (sortedPersonas.length === 0) {
    lines.push("_You don't have any personas yet._");
    lines.push('');
    lines.push('Use `/persona create` to create your first persona!');
  } else {
    pageItems.forEach((persona, index) => {
      const num = startIdx + index + 1;
      const defaultBadge = persona.isDefault ? '⭐' : '  ';
      const preferredName =
        persona.preferredName !== null &&
        persona.preferredName !== undefined &&
        persona.preferredName !== ''
          ? ` (${persona.preferredName})`
          : '';
      lines.push(`${defaultBadge} **${num}.** ${persona.name}${preferredName}`);
    });
  }

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle('👤 Your Personas')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  // Footer
  const sortLabel = sortType === 'date' ? 'by date' : 'alphabetically';
  embed.setFooter({ text: `${sortedPersonas.length} personas • Sorted ${sortLabel} • ⭐ Default` });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu if there are items on this page
  if (pageItems.length > 0) {
    components.push(buildBrowseSelectMenu(pageItems, startIdx, safePage, sortType));
  }

  // Add pagination buttons if multiple pages or items exist
  if (totalPages > 1 || sortedPersonas.length > 0) {
    components.push(buildBrowseButtons(safePage, totalPages, sortType));
  }

  return { embed, components };
}

/**
 * Handle /persona browse
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    // Fetch user's personas via gateway API
    const result = await callGatewayApi<ListPersonasResponse>('/user/persona', { userId });

    if (!result.ok) {
      logger.warn({ userId, error: result.error }, '[Persona] Failed to fetch personas');
      await context.editReply({
        content: '❌ Failed to load your personas. Please try again later.',
      });
      return;
    }

    // Build first page
    const { embed, components } = buildBrowsePage(result.data.personas, 0, DEFAULT_SORT);

    await context.editReply({ embeds: [embed], components });

    logger.info({ userId, count: result.data.personas.length }, '[Persona] Browse personas');
  } catch (error) {
    logger.error({ err: error, userId }, '[Persona] Failed to browse personas');
    await context.editReply('❌ Failed to load personas. Please try again.');
  }
}

/**
 * Handle browse pagination button clicks
 */
export async function handleBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  try {
    const userId = interaction.user.id;
    const page = parsed.page;
    const sort = parsed.sort;

    // Fetch fresh data
    const result = await callGatewayApi<ListPersonasResponse>('/user/persona', { userId });

    if (!result.ok) {
      logger.warn(
        { userId, error: result.error },
        '[Persona] Failed to fetch personas for pagination'
      );
      return;
    }

    const { embed, components } = buildBrowsePage(result.data.personas, page, sort);
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error(
      { err: error, userId: interaction.user.id },
      '[Persona] Failed to load browse page'
    );
    // Keep existing content on error
  }
}

/**
 * Handle browse select menu - open persona dashboard
 */
export async function handleBrowseSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const personaId = interaction.values[0];
  const userId = interaction.user.id;

  // Parse browse context from customId (contains page and sort)
  const parsed = browseHelpers.parseSelect(interaction.customId);
  const page = parsed?.page ?? 0;
  const sort = parsed?.sort ?? DEFAULT_SORT;

  await interaction.deferUpdate();

  try {
    // Fetch the persona with full data
    const persona = await fetchPersona(personaId, userId);

    if (!persona) {
      await interaction.editReply({
        content: '❌ Persona not found.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Flatten for dashboard
    const flattenedData = flattenPersonaData(persona);

    // Add browse context for back navigation
    flattenedData.browseContext = {
      source: 'browse',
      page,
      filter: 'all', // Persona browse doesn't have filters
      sort,
    };

    // Build dashboard embed and components using shared options builder
    const embed = buildDashboardEmbed(PERSONA_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(
      PERSONA_DASHBOARD_CONFIG,
      personaId,
      flattenedData,
      buildPersonaDashboardOptions(flattenedData)
    );

    // Update the message with the dashboard
    await interaction.editReply({ embeds: [embed], components });

    // Create session for tracking - includes browse context for back navigation
    const sessionManager = getSessionManager();
    await sessionManager.set<FlattenedPersonaData>({
      userId,
      entityType: 'persona',
      entityId: personaId,
      data: flattenedData,
      messageId: interaction.message.id,
      channelId: interaction.channelId,
    });

    logger.info(
      { userId, personaId, name: persona.name },
      '[Persona] Opened dashboard from browse'
    );
  } catch (error) {
    logger.error({ err: error, personaId }, '[Persona] Failed to open dashboard from browse');
    await interaction.editReply({
      content: '❌ Failed to load persona. Please try again.',
      embeds: [],
      components: [],
    });
  }
}

/**
 * Check if custom ID is a persona browse interaction
 */
export function isPersonaBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/**
 * Check if custom ID is a persona browse select interaction
 */
export function isPersonaBrowseSelectInteraction(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
}

/**
 * Build browse response for back navigation
 * Fetches personas and builds the embed/components for a given page/sort
 */
export async function buildBrowseResponse(
  userId: string,
  page: number,
  sort: BrowseSortType
): Promise<{ embed: EmbedBuilder; components: BrowseActionRow[] } | null> {
  const result = await callGatewayApi<ListPersonasResponse>('/user/persona', { userId });

  if (!result.ok) {
    logger.warn(
      { userId, error: result.error },
      '[Persona] Failed to fetch personas for back navigation'
    );
    return null;
  }

  return buildBrowsePage(result.data.personas, page, sort);
}
