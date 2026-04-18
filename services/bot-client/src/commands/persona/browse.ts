/**
 * Persona Browse Handler
 *
 * Handles /persona browse subcommand
 * Shows a paginated list of user's personas with select menu to edit
 */

import { EmbedBuilder } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, type ListPersonasResponse } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  callGatewayApi,
  GATEWAY_TIMEOUTS,
  toGatewayUser,
  type GatewayUser,
} from '../../utils/userGatewayClient.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import {
  ITEMS_PER_PAGE,
  buildBrowseButtons as buildSharedBrowseButtons,
  buildBrowseSelectMenu,
  createBrowseCustomIdHelpers,
  joinFooter,
  pluralize,
  formatSortNatural,
  formatSortVerbatim,
  type BrowseSortType,
  type BrowseActionRow,
} from '../../utils/browse/index.js';
import { createListComparator } from '../../utils/listSorting.js';

/** API endpoint for persona list operations */
const PERSONA_LIST_ENDPOINT = '/user/persona';
import {
  PERSONA_DASHBOARD_CONFIG,
  flattenPersonaData,
  buildPersonaDashboardOptions,
  type FlattenedPersonaData,
} from './config.js';
import { fetchPersona } from './api.js';
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
 * Format a persona for the select menu — returns the unprefixed label
 * (numbering is added by the buildBrowseSelectMenu factory).
 */
function formatPersonaSelectLabel(persona: PersonaSummary): string {
  const defaultBadge = persona.isDefault ? '⭐' : '';
  const nameBadge =
    persona.preferredName !== null &&
    persona.preferredName !== undefined &&
    persona.preferredName !== ''
      ? `(${persona.preferredName})`
      : '';
  // .trim() collapses extra whitespace when defaultBadge or nameBadge are empty
  return `${defaultBadge} ${persona.name} ${nameBadge}`.trim();
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
  embed.setFooter({
    text: joinFooter(
      pluralize(sortedPersonas.length, { singular: 'persona', plural: 'personas' }),
      sortType === 'date' ? formatSortNatural('date') : formatSortVerbatim('Sorted alphabetically'),
      '\u2B50 Default'
    ),
  });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu — factory returns null on empty pageItems
  const selectRow = buildBrowseSelectMenu<PersonaSummary>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, 'all', sortType, null),
    placeholder: 'Select a persona to view/edit...',
    startIndex: startIdx,
    formatItem: persona => ({
      label: formatPersonaSelectLabel(persona),
      value: persona.id,
      description: persona.isDefault ? 'Default persona' : 'Click to edit',
    }),
  });
  if (selectRow !== null) {
    components.push(selectRow);
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
    const result = await callGatewayApi<ListPersonasResponse>(PERSONA_LIST_ENDPOINT, {
      user: toGatewayUser(context.user),
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

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
    const result = await callGatewayApi<ListPersonasResponse>(PERSONA_LIST_ENDPOINT, {
      user: toGatewayUser(interaction.user),
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

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
    const persona = await fetchPersona(personaId, toGatewayUser(interaction.user));

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
  user: GatewayUser,
  page: number,
  sort: BrowseSortType
): Promise<{ embed: EmbedBuilder; components: BrowseActionRow[] } | null> {
  const result = await callGatewayApi<ListPersonasResponse>(PERSONA_LIST_ENDPOINT, {
    user,
    timeout: GATEWAY_TIMEOUTS.DEFERRED,
  });

  if (!result.ok) {
    logger.warn(
      { userId: user.discordId, error: result.error },
      '[Persona] Failed to fetch personas for back navigation'
    );
    return null;
  }

  return buildBrowsePage(result.data.personas, page, sort);
}
