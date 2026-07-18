/**
 * Preset Browse Handler
 * Handles /preset browse subcommand with optional search and filtering
 *
 * Replaces the old /preset list with enhanced functionality:
 * - Optional query parameter for searching by name/model
 * - Optional scope filter (all, global, mine, free)
 * - Optional capability filter (all, text, vision) — orthogonal to scope
 * - Pagination support for larger lists
 */

import {
  type EmbedBuilder,
  escapeMarkdown,
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { isFreeModelForUser, isFreeTierEligibleModel } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { presetBrowseOptions } from '@tzurot/common-types/generated/commandOptions';
import { type LlmConfigSummary } from '@tzurot/common-types/schemas/api/llm-config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { shortModelName } from '@tzurot/common-types/utils/modelNames';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { UserClient } from '@tzurot/clients';
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
  buildFilterToggleButton,
  createBrowseCustomIdHelpers,
  pluralize,
  formatFilterLabeled,
  type BrowseActionRow,
} from '../../utils/browse/index.js';
import {
  PRESET_DASHBOARD_CONFIG,
  flattenPresetData,
  buildPresetDashboardOptions,
  type FlattenedPresetData,
} from './config.js';
import { fetchPreset } from './api.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import {
  CAPABILITY_TOGGLE_DISPLAY,
  composeBrowseFilter,
  describeFilter,
  filterPresets,
  SCOPE_TOGGLE_DISPLAY,
  splitBrowseFilter,
  PRESET_CAPABILITY_FILTERS,
  PRESET_SCOPE_FILTERS,
  VALID_PRESET_FILTERS,
  type PresetBrowseFilter,
  type PresetCapabilityFilter,
  type PresetScopeFilter,
} from './browseFilter.js';

const logger = createLogger('preset-browse');

/** Browse customId helpers using shared factory (no sort for presets) */
const browseHelpers = createBrowseCustomIdHelpers<PresetBrowseFilter>({
  prefix: 'preset',
  validFilters: VALID_PRESET_FILTERS,
  includeSort: false,
});

/**
 * Check if custom ID is a preset browse interaction
 */
export function isPresetBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/**
 * Check if custom ID is a preset browse select interaction
 */
export function isPresetBrowseSelectInteraction(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
}

/**
 * Badge sequence for a preset (scope → vision → default → free). Shared by the
 * select-menu label and the embed line so the two can't drift.
 */
function presetBadgeArray(preset: LlmConfigSummary, isGuestMode: boolean): string[] {
  const badges: string[] = [];
  if (preset.isGlobal) {
    badges.push('🌐');
  } else if (preset.isOwned) {
    badges.push('🔒');
  } else {
    badges.push('👤');
  }
  if (preset.supportsVision) {
    badges.push('👁️');
  }
  if (preset.isDefault) {
    badges.push('⭐');
  }
  // 🆓 is audience-aware: guests see the conditionally-free piggyback model
  // as free (it is their free experience); key-holders pay on their own key.
  if (isFreeModelForUser(preset.model, isGuestMode)) {
    badges.push('🆓');
  }
  return badges;
}

function buildPresetBadges(preset: LlmConfigSummary, isGuestMode: boolean): string {
  return presetBadgeArray(preset, isGuestMode).join('') + ' ';
}

/**
 * Build the description for a preset's select menu option.
 * Shows the short model name plus an "(requires API key)" hint when
 * the user is in guest mode and the model isn't free.
 */
function buildPresetDescription(preset: LlmConfigSummary, isGuestMode: boolean): string {
  let description = shortModelName(preset.model);
  if (isGuestMode && !isFreeTierEligibleModel(preset.model)) {
    description += ' (requires API key)';
  }
  return description;
}

/**
 * Build pagination buttons (no sort toggle for presets) plus the
 * two-dimensional in-place filter: one cycle toggle PER AXIS, each holding
 * the other axis constant in the composite `scope.capability` token. Two
 * buttons beat a filter select here — the 12 composite states would make an
 * unwieldy select, and per-axis cycling matches the design system's toggle
 * affordance. Row budget: 3 pagination + 2 toggles = Discord's 5-button max.
 */
function buildBrowseButtons(
  currentPage: number,
  totalPages: number,
  filter: PresetBrowseFilter,
  query: string | null
): ReturnType<typeof buildSharedBrowseButtons> {
  const { scope, capability } = splitBrowseFilter(filter);
  const row = buildSharedBrowseButtons({
    currentPage,
    totalPages,
    filter,
    currentSort: 'name', // Preset browse doesn't use sort toggle
    query,
    buildCustomId: (page, f, _sort, q) => browseHelpers.build(page, f, 'name', q),
    buildInfoId: browseHelpers.buildInfo,
    showSortToggle: false, // Presets don't have sort toggle
  });
  row.addComponents(
    buildFilterToggleButton({
      filters: PRESET_SCOPE_FILTERS,
      display: SCOPE_TOGGLE_DISPLAY,
      current: scope,
      buildCustomId: (page, nextScope, _sort, q) =>
        browseHelpers.build(page, composeBrowseFilter(nextScope, capability), 'name', q),
      query,
    }),
    buildFilterToggleButton({
      filters: PRESET_CAPABILITY_FILTERS,
      display: CAPABILITY_TOGGLE_DISPLAY,
      current: capability,
      buildCustomId: (page, nextCapability, _sort, q) =>
        browseHelpers.build(page, composeBrowseFilter(scope, nextCapability), 'name', q),
      query,
    })
  );
  return row;
}

/**
 * Build the browse embed and components
 */
function buildBrowsePage(
  allPresets: LlmConfigSummary[],
  filter: PresetBrowseFilter,
  query: string | null,
  page: number,
  isGuestMode: boolean
): { embed: EmbedBuilder; components: BrowseActionRow[] } {
  const { scope, capability } = splitBrowseFilter(filter);
  const filtered = filterPresets(allPresets, scope, capability, query, isGuestMode);

  // Preamble: guest-mode warning + search/filter context.
  const preamble: string[] = [];
  if (isGuestMode) {
    preamble.push(
      '\u26A0\uFE0F **Guest Mode** - Limited to free models (\u{1F193}). Use `/settings apikey set` for full access.\n'
    );
  }
  const activeFilterLabel = describeFilter(scope, capability);
  if (query !== null) {
    preamble.push(`\u{1F50D} Searching: "${query}" \u2022 Filter: ${activeFilterLabel ?? 'All'}\n`);
  } else if (activeFilterLabel !== null) {
    preamble.push(`Filter: ${activeFilterLabel}\n`);
  }

  const freeCount = filtered.filter(c => isFreeModelForUser(c.model, isGuestMode)).length;
  const visionCount = filtered.filter(c => c.supportsVision).length;

  const { embed, pageItems, startIndex, totalPages, safePage } =
    buildBrowseListEmbed<LlmConfigSummary>({
      entityEmoji: '\u2699\uFE0F',
      titleNoun: 'Presets',
      items: filtered,
      page,
      itemsPerPage: ITEMS_PER_PAGE,
      preamble,
      formatRow: preset => {
        const safeName = escapeMarkdown(preset.name);
        const dimmed = isGuestMode && !isFreeTierEligibleModel(preset.model);
        return {
          badges: presetBadgeArray(preset, isGuestMode).join(''),
          name: safeName,
          // Guest-mode dims paid presets — the one styling exception (§2.4).
          nameMarkup: dimmed ? `~~${safeName}~~` : undefined,
          // Preset ids are detail-view territory, not typed anywhere — no techId.
          metadata: [`\`${shortModelName(preset.model)}\``],
        };
      },
      empty: {
        noItems: 'No presets exist yet \u2014 create one with `/preset create`.',
        noMatch: 'No presets match \u2014 clear the search or filter to see all.',
      },
      filterActive: query !== null || activeFilterLabel !== null,
      color: isGuestMode ? DISCORD_COLORS.WARNING : undefined,
      footerSegments: [
        pluralize(filtered.length, { singular: 'preset', plural: 'presets' }),
        activeFilterLabel !== null && formatFilterLabeled(activeFilterLabel),
      ],
      badgeLegend: `Global \u{1F310} \u00B7 Private \u{1F512} \u00B7 Other user \u{1F464} \u00B7 Vision \u{1F441}\uFE0F (${visionCount}) \u00B7 Default \u2B50 \u00B7 Free \u{1F193} (${freeCount})`,
    });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu — factory returns null on empty pageItems
  const selectRow = buildBrowseSelectMenu<LlmConfigSummary>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, filter, 'name', query),
    placeholder: 'Select a preset to view...',
    startIndex,
    formatItem: preset => ({
      label: `${buildPresetBadges(preset, isGuestMode)}${preset.name}`,
      value: preset.id,
      description: buildPresetDescription(preset, isGuestMode),
    }),
  });
  if (selectRow !== null) {
    components.push(selectRow);
  }

  // The button row always renders on filter-bearing browses (alias-pilot
  // norm): the filter toggles must stay reachable even on a single page —
  // and ESPECIALLY on an empty filtered list, where the toggle is the way
  // back out. Pagination buttons disable themselves at one page.
  components.push(buildBrowseButtons(safePage, totalPages, filter, query));

  return { embed, components };
}

/**
 * Fetches all of the user's presets in a single call; the
 * capability axis (text/vision) is applied client-side from each row's
 * `supportsVision` — capability is a model property, not a fetch-scope parameter.
 * Returns null on fetch failure.
 */
async function fetchPresets(userClient: UserClient): Promise<LlmConfigSummary[] | null> {
  const result = await userClient.listUserLlmConfigs();
  if (!result.ok) {
    logger.warn({ status: result.status }, 'Failed to fetch presets');
    return null;
  }
  return result.data.configs;
}

/**
 * Handle /preset browse [query?] [filter?] [capability?]
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = presetBrowseOptions(context.interaction);
  const query = options.query();
  const scope = (options.filter() ?? 'all') as PresetScopeFilter;
  const capability = (options.capability() ?? 'all') as PresetCapabilityFilter;
  const filter = composeBrowseFilter(scope, capability);

  try {
    // Fetch all presets (capability axis applied client-side) + wallet status.
    const { userClient } = clientsFor(context.interaction);
    const [presets, walletResult] = await Promise.all([
      fetchPresets(userClient),
      userClient.listWalletKeys(),
    ]);

    if (presets === null) {
      logger.warn({ userId }, 'Failed to browse presets');
      await context.editReply({
        content: renderSpec(CATALOG.error.transient("Couldn't load your presets right now.")),
      });
      return;
    }

    // Check if user is in guest mode (no active wallet keys)
    // Only show guest mode warning when we successfully verified no active keys
    // If wallet API failed, assume user might have keys (don't restrict them)
    if (!walletResult.ok) {
      logger.warn(
        { userId, error: walletResult.error },
        'Wallet check failed, assuming not guest mode'
      );
    }
    const isGuestMode = walletResult.ok && !walletResult.data.keys.some(k => k.isActive === true);

    const { embed, components } = buildBrowsePage(presets, filter, query, 0, isGuestMode);

    await context.editReply({ embeds: [embed], components });

    logger.info({ userId, count: presets.length, filter, query, isGuestMode }, 'Browse presets');
  } catch (error) {
    logger.error({ err: error, userId }, 'Error browsing presets');
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'presets', { operation: 'read' })),
    });
  }
}

/**
 * Build browse response for a given context
 * Reusable for pagination and back-from-dashboard navigation
 */
export async function buildBrowseResponse(
  userClient: UserClient,
  browseContext: {
    page: number;
    filter: PresetBrowseFilter;
    query: string | null;
  }
): Promise<{ embed: EmbedBuilder; components: BrowseActionRow[] } | null> {
  const { page, filter, query } = browseContext;

  // Re-fetch all presets (capability axis applied client-side) via typed client
  const [presets, walletResult] = await Promise.all([
    fetchPresets(userClient),
    userClient.listWalletKeys(),
  ]);

  if (presets === null) {
    return null;
  }

  // Only show guest mode when we successfully verified no active keys
  // If wallet API failed, assume user might have keys (don't restrict them)
  const isGuestMode = walletResult.ok && !walletResult.data.keys.some(k => k.isActive === true);

  return buildBrowsePage(presets, filter, query, page, isGuestMode);
}

// Register the preset browse rebuilder with the shared registry at module
// load time. Consumed by `renderPostActionScreen` (destructive-action success
// → direct re-render) and `handleSharedBackButton` (Back-to-Browse click).
registerBrowseRebuilder('preset', async (interaction, browseContext, successBanner) => {
  const { userClient } = clientsFor(interaction);
  const result = await buildBrowseResponse(userClient, {
    page: browseContext.page,
    filter: browseContext.filter as PresetBrowseFilter,
    query: browseContext.query ?? null,
  });
  if (result === null) {
    return null;
  }
  return {
    content: successBanner,
    embeds: [result.embed],
    components: result.components,
  };
});

/** Ephemeral nudge when a page fails to load (the prior view stays put). */
const PAGE_LOAD_FAILED_MSG = "⏳ Couldn't load that page — please try again.";

/**
 * Best-effort ephemeral nudge for a failed page-load. The followUp itself can
 * throw (e.g. Discord 10062 Unknown Interaction if the token expired during the
 * fetch); swallow + log so the handler stays unconditionally non-throwing — the
 * nudge is a courtesy, not a guarantee.
 */
async function sendPageLoadNudge(interaction: ButtonInteraction): Promise<void> {
  await interaction
    .followUp({ content: PAGE_LOAD_FAILED_MSG, flags: MessageFlags.Ephemeral })
    .catch(err =>
      logger.warn({ err, userId: interaction.user.id }, 'Failed to send page-load nudge')
    );
}

/**
 * Handle browse pagination button clicks
 */
export async function handleBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  // Ack FIRST (04-discord.md: the first await in a component handler must be
  // deferUpdate). A stale pre-deploy customId (bare-scope filter like `all`
  // instead of `all.all`) fails `parse` against VALID_PRESET_FILTERS — acking
  // before that guard avoids a "This interaction failed" on old browse buttons.
  await interaction.deferUpdate();

  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  try {
    const { userClient } = clientsFor(interaction);
    const result = await buildBrowseResponse(userClient, parsed);

    if (result === null) {
      logger.warn({ userId: interaction.user.id }, 'Failed to fetch presets for pagination');
      await sendPageLoadNudge(interaction);
      return;
    }

    await interaction.editReply({ embeds: [result.embed], components: result.components });
  } catch (error) {
    logger.error(
      { err: error, userId: interaction.user.id, ...parsed },
      'Error during browse pagination'
    );
    // Keep the existing view; surface a non-destructive ephemeral nudge.
    await sendPageLoadNudge(interaction);
  }
}

/**
 * Handle browse select menu - open preset dashboard
 */
export async function handleBrowseSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const presetId = interaction.values[0];
  const userId = interaction.user.id;

  // Parse browse context from customId
  const browseContext = browseHelpers.parseSelect(interaction.customId);

  await interaction.deferUpdate();

  try {
    // Fetch the preset
    const { userClient } = clientsFor(interaction);
    const preset = await fetchPreset(presetId, userClient);

    if (!preset) {
      await interaction.editReply({
        content: renderSpec(CATALOG.error.notFound('Preset')),
        embeds: [],
        components: [],
      });
      return;
    }

    // Flatten the data for dashboard display, including browse context for back navigation
    const flattenedData: FlattenedPresetData = {
      ...flattenPresetData(preset),
      browseContext: browseContext
        ? {
            source: 'browse',
            page: browseContext.page,
            filter: browseContext.filter,
            query: browseContext.query,
          }
        : undefined,
    };

    // Build dashboard embed and components using shared options builder
    const embed = buildDashboardEmbed(PRESET_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(
      PRESET_DASHBOARD_CONFIG,
      presetId,
      flattenedData,
      buildPresetDashboardOptions(flattenedData)
    );

    // Update the message with the dashboard
    await interaction.editReply({ embeds: [embed], components });

    // Create session for tracking (flattenedData already has browseContext)
    const sessionManager = getSessionManager();

    await sessionManager.set<FlattenedPresetData>({
      userId,
      entityType: 'preset',
      entityId: presetId,
      data: flattenedData,
      messageId: interaction.message.id,
      channelId: interaction.channelId,
    });

    logger.info({ userId, presetId, name: preset.name }, 'Opened dashboard from browse');
  } catch (error) {
    logger.error({ err: error, presetId }, 'Failed to open dashboard from browse');
    await interaction.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'preset', { operation: 'read' })),
      embeds: [],
      components: [],
    });
  }
}
