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
  EmbedBuilder,
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
  buildBrowseSelectMenu,
  createBrowseCustomIdHelpers,
  joinFooter,
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
  composeBrowseFilter,
  describeFilter,
  splitBrowseFilter,
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
 * Apply the scope + capability axes + search query — all client-side. Browse
 * fetches every config; capability ('vision'/'text') is a
 * model-`supportsVision` check applied here, not a fetch-scope parameter.
 */
function filterPresets(
  presets: LlmConfigSummary[],
  scope: PresetScopeFilter,
  capability: PresetCapabilityFilter,
  query: string | null,
  isGuestMode: boolean
): LlmConfigSummary[] {
  let filtered = presets;

  // Capability axis: the model's vision capability ('vision' = vision-capable,
  // 'text' = text-only, 'all' = no filter).
  if (capability === 'vision') {
    filtered = filtered.filter(c => c.supportsVision);
  } else if (capability === 'text') {
    filtered = filtered.filter(c => !c.supportsVision);
  }

  switch (scope) {
    case 'global':
      filtered = filtered.filter(c => c.isGlobal);
      break;
    case 'mine':
      filtered = filtered.filter(c => c.isOwned);
      break;
    case 'free':
      // Audience-aware: a guest's 'free' scope means "what I can use for
      // free" and includes the conditionally-free piggyback model.
      filtered = filtered.filter(c => isFreeModelForUser(c.model, isGuestMode));
      break;
    case 'all':
    default:
      // No scope filter
      break;
  }

  // Apply search query
  if (query !== null && query.length > 0) {
    const lowerQuery = query.toLowerCase();
    filtered = filtered.filter(
      c =>
        c.name.toLowerCase().includes(lowerQuery) ||
        c.model.toLowerCase().includes(lowerQuery) ||
        (c.description?.toLowerCase().includes(lowerQuery) ?? false)
    );
  }

  return filtered;
}

/**
 * Format a preset line with badges
 */
function formatPresetLine(c: LlmConfigSummary, isGuestMode: boolean, index: number): string {
  const badgeStr = presetBadgeArray(c, isGuestMode).join('');
  const shortModel = shortModelName(c.model);
  const safeName = escapeMarkdown(c.name);

  // In guest mode, dim paid presets
  const nameStyle =
    isGuestMode && !isFreeTierEligibleModel(c.model) ? `~~${safeName}~~` : `**${safeName}**`;

  return `${index + 1}. ${badgeStr} ${nameStyle}\n   └ \`${shortModel}\``;
}

/**
 * Build pagination buttons using shared utility (no sort toggle for presets)
 */
function buildBrowseButtons(
  currentPage: number,
  totalPages: number,
  filter: PresetBrowseFilter,
  query: string | null
): ReturnType<typeof buildSharedBrowseButtons> {
  return buildSharedBrowseButtons({
    currentPage,
    totalPages,
    filter,
    currentSort: 'name', // Preset browse doesn't use sort toggle
    query,
    buildCustomId: (page, f, _sort, q) => browseHelpers.build(page, f, 'name', q),
    buildInfoId: browseHelpers.buildInfo,
    showSortToggle: false, // Presets don't have sort toggle
  });
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
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const startIdx = safePage * ITEMS_PER_PAGE;
  const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, filtered.length);
  const pageItems = filtered.slice(startIdx, endIdx);

  const embed = new EmbedBuilder()
    .setTitle('🔧 Preset Browser')
    .setColor(isGuestMode ? DISCORD_COLORS.WARNING : DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  // Build description
  const lines: string[] = [];

  // Guest mode warning
  if (isGuestMode) {
    lines.push(
      '⚠️ **Guest Mode** - Limited to free models (🆓). Use `/settings apikey set` for full access.\n'
    );
  }

  // Search/filter info
  const activeFilterLabel = describeFilter(scope, capability);
  if (query !== null) {
    lines.push(`🔍 Searching: "${query}" • Filter: ${activeFilterLabel ?? 'All'}\n`);
  } else if (activeFilterLabel !== null) {
    lines.push(`Filter: ${activeFilterLabel}\n`);
  }

  // Preset list
  if (pageItems.length === 0) {
    lines.push('_No presets match your search._');
  } else {
    for (let i = 0; i < pageItems.length; i++) {
      lines.push(formatPresetLine(pageItems[i], isGuestMode, startIdx + i));
    }
  }

  embed.setDescription(lines.join('\n'));

  // Footer with legend
  const freeCount = filtered.filter(c => isFreeModelForUser(c.model, isGuestMode)).length;
  const visionCount = filtered.filter(c => c.supportsVision).length;
  embed.setFooter({
    text: joinFooter(
      pluralize(filtered.length, { singular: 'preset', plural: 'presets' }),
      activeFilterLabel !== null && formatFilterLabeled(activeFilterLabel),
      `🌐 Global  🔒 Private  👤 Other user  👁️ Vision (${visionCount})  ⭐ Default  🆓 Free (${freeCount})`
    ),
  });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu — factory returns null on empty pageItems
  const selectRow = buildBrowseSelectMenu<LlmConfigSummary>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, filter, 'name', query),
    placeholder: 'Select a preset to view...',
    startIndex: startIdx,
    formatItem: preset => ({
      label: `${buildPresetBadges(preset, isGuestMode)}${preset.name}`,
      value: preset.id,
      description: buildPresetDescription(preset, isGuestMode),
    }),
  });
  if (selectRow !== null) {
    components.push(selectRow);
  }

  // Add pagination buttons if multiple pages
  if (totalPages > 1) {
    components.push(buildBrowseButtons(safePage, totalPages, filter, query));
  }

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
