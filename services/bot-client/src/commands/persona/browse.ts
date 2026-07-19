/**
 * Persona Browse Handler
 *
 * Handles /persona browse subcommand
 * Shows a paginated list of user's personas with select menu to edit
 */

import {
  escapeMarkdown,
  type EmbedBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
  registerBrowseRebuilder,
} from '../../utils/dashboard/index.js';
import {
  ITEMS_PER_PAGE,
  buildBrowseButtons as buildSharedBrowseButtons,
  buildBrowseListEmbed,
  buildBrowseSelectMenu,
  createBrowseCustomIdHelpers,
  pluralize,
  formatSortNatural,
  formatSortVerbatim,
  type BrowseSortType,
  type BrowseActionRow,
} from '../../utils/browse/index.js';
import { createListComparator } from '../../utils/listSorting.js';

import {
  PERSONA_DASHBOARD_CONFIG,
  flattenPersonaData,
  buildPersonaDashboardOptions,
  type FlattenedPersonaData,
} from './config.js';
import { fetchPersona } from './api.js';
import type { PersonaSummary } from './types.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

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

  const { embed, pageItems, startIndex, totalPages, safePage } =
    buildBrowseListEmbed<PersonaSummary>({
      entityEmoji: '👤',
      titleNoun: 'Personas',
      items: sortedPersonas,
      page,
      itemsPerPage: ITEMS_PER_PAGE,
      formatRow: persona => ({
        badges: persona.isDefault ? '⭐' : undefined,
        name: escapeMarkdown(persona.name),
        metadata:
          persona.preferredName !== null &&
          persona.preferredName !== undefined &&
          persona.preferredName !== ''
            ? [`Goes by ${escapeMarkdown(persona.preferredName)}`]
            : undefined,
      }),
      empty: {
        noItems: "You don't have any personas yet — create your first with `/persona create`.",
      },
      footerSegments: [
        pluralize(sortedPersonas.length, { singular: 'persona', plural: 'personas' }),
        sortType === 'date'
          ? formatSortNatural('date')
          : formatSortVerbatim('Sorted alphabetically'),
      ],
      badgeLegend: 'Default ⭐',
    });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu — factory returns null on empty pageItems
  const selectRow = buildBrowseSelectMenu<PersonaSummary>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, 'all', sortType, null),
    placeholder: 'Select a persona to view/edit...',
    startIndex,
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
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.listPersonas();

    if (!result.ok) {
      logger.warn({ userId, error: result.error }, 'Failed to fetch personas');
      await context.editReply({
        content: renderSpec(classifyGatewayFailure(result, 'personas', { operation: 'read' })),
      });
      return;
    }

    const { embed, components } = buildBrowsePage(result.data.personas, 0, DEFAULT_SORT);

    await context.editReply({ embeds: [embed], components });

    logger.info({ userId, count: result.data.personas.length }, 'Browse personas');
  } catch (error) {
    logger.error({ err: error, userId }, 'Failed to browse personas');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'personas', { operation: 'read' }))
    );
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

    const { userClient } = clientsFor(interaction);
    const result = await userClient.listPersonas();

    if (!result.ok) {
      logger.warn({ userId, error: result.error }, 'Failed to fetch personas for pagination');
      return;
    }

    const { embed, components } = buildBrowsePage(result.data.personas, page, sort);
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, 'Failed to load browse page');
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
    const { userClient } = clientsFor(interaction);
    const persona = await fetchPersona(personaId, userClient, userId);

    if (!persona) {
      await interaction.editReply({
        content: renderSpec(CATALOG.error.notFound('Persona')),
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

    logger.info({ userId, personaId, name: persona.name }, 'Opened dashboard from browse');
  } catch (error) {
    logger.error({ err: error, personaId }, 'Failed to open dashboard from browse');
    await interaction.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'persona', { operation: 'read' })),
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
  userClient: UserClient,
  userId: string,
  page: number,
  sort: BrowseSortType
): Promise<{ embed: EmbedBuilder; components: BrowseActionRow[] } | null> {
  const result = await userClient.listPersonas();

  if (!result.ok) {
    logger.warn({ userId, error: result.error }, 'Failed to fetch personas for back navigation');
    return null;
  }

  return buildBrowsePage(result.data.personas, page, sort);
}

// Register the persona browse rebuilder with the shared registry at module
// load time. Consumed by `renderPostActionScreen` (destructive-action success
// → direct re-render) and `handleSharedBackButton` (Back-to-Browse click).
// See `utils/dashboard/browseRebuilderRegistry.ts` for why the registry lives
// in module memory rather than on the session.
registerBrowseRebuilder('persona', async (interaction, browseContext, successBanner) => {
  const { userClient } = clientsFor(interaction);
  const result = await buildBrowseResponse(
    userClient,
    interaction.user.id,
    browseContext.page,
    (browseContext.sort ?? DEFAULT_SORT) as BrowseSortType
  );
  if (result === null) {
    return null;
  }
  return {
    content: successBanner,
    embeds: [result.embed],
    components: result.components,
  };
});
