/**
 * Preset Browse Handler
 * Handles /preset browse subcommand with optional search and filtering
 *
 * Replaces the old /preset list with enhanced functionality:
 * - Optional query parameter for searching by name/model
 * - Optional filter parameter (all, global, mine, free)
 * - Pagination support for larger lists
 */

import {
  EmbedBuilder,
  escapeMarkdown,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  isFreeModel,
  presetBrowseOptions,
  type LlmConfigSummary,
  type ConfigKind,
} from '@tzurot/common-types';
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

const logger = createLogger('preset-browse');

/**
 * A preset summary tagged with its config kind. The list response summary omits
 * `kind` (it's detail-only), so browse fetches each kind separately and tags
 * each row by the call it came from — letting us badge + filter by kind without
 * the gateway list contract carrying it.
 */
type TaggedPreset = LlmConfigSummary & { kind: ConfigKind };

/** Browse filter options (scope/free axis + the text/vision kind axis) */
export type PresetBrowseFilter = 'all' | 'global' | 'mine' | 'free' | 'text' | 'vision';

/** Valid filters for preset browse */
const VALID_FILTERS = ['all', 'global', 'mine', 'free', 'text', 'vision'] as const;

/** Browse customId helpers using shared factory (no sort for presets) */
const browseHelpers = createBrowseCustomIdHelpers<PresetBrowseFilter>({
  prefix: 'preset',
  validFilters: VALID_FILTERS,
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
 * Build the badge string for a preset's select menu label.
 * Returns the unprefixed badges joined together (e.g., "🌐⭐ ", "🔒 ").
 * The factory adds the numbering prefix; this helper handles the
 * scope/default/free badge logic.
 */
/**
 * Badge sequence for a preset (scope → vision → default → free). Shared by the
 * select-menu label and the embed line so the two can't drift.
 */
function presetBadgeArray(preset: TaggedPreset): string[] {
  const badges: string[] = [];
  if (preset.isGlobal) {
    badges.push('🌐');
  } else if (preset.isOwned) {
    badges.push('🔒');
  } else {
    badges.push('👤');
  }
  if (preset.kind === 'vision') {
    badges.push('👁️');
  }
  if (preset.isDefault) {
    badges.push('⭐');
  }
  if (isFreeModel(preset.model)) {
    badges.push('🆓');
  }
  return badges;
}

function buildPresetBadges(preset: TaggedPreset): string {
  return presetBadgeArray(preset).join('') + ' ';
}

/**
 * Build the description for a preset's select menu option.
 * Shows the short model name plus an "(requires API key)" hint when
 * the user is in guest mode and the model isn't free.
 */
function buildPresetDescription(preset: TaggedPreset, isGuestMode: boolean): string {
  const shortModel = preset.model.includes('/') ? preset.model.split('/').pop() : preset.model;
  let description = shortModel ?? preset.model;
  if (isGuestMode && !isFreeModel(preset.model)) {
    description += ' (requires API key)';
  }
  return description;
}

/**
 * Filter presets based on filter type and optional query
 */
function filterPresets(
  presets: TaggedPreset[],
  filter: PresetBrowseFilter,
  query: string | null
): TaggedPreset[] {
  let filtered = presets;

  // Apply filter
  switch (filter) {
    case 'global':
      filtered = presets.filter(c => c.isGlobal);
      break;
    case 'mine':
      filtered = presets.filter(c => c.isOwned);
      break;
    case 'free':
      filtered = presets.filter(c => isFreeModel(c.model));
      break;
    case 'text':
      filtered = presets.filter(c => c.kind === 'text');
      break;
    case 'vision':
      filtered = presets.filter(c => c.kind === 'vision');
      break;
    case 'all':
    default:
      // No filter
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
function formatPresetLine(c: TaggedPreset, isGuestMode: boolean, index: number): string {
  const badgeStr = presetBadgeArray(c).join('');
  const shortModel = c.model.includes('/') ? c.model.split('/').pop() : c.model;
  const safeName = escapeMarkdown(c.name);

  // In guest mode, dim paid presets
  const nameStyle = isGuestMode && !isFreeModel(c.model) ? `~~${safeName}~~` : `**${safeName}**`;

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
  allPresets: TaggedPreset[],
  filter: PresetBrowseFilter,
  query: string | null,
  page: number,
  isGuestMode: boolean
): { embed: EmbedBuilder; components: BrowseActionRow[] } {
  const filtered = filterPresets(allPresets, filter, query);
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
  const filterLabels: Record<PresetBrowseFilter, string> = {
    all: 'All',
    global: 'Global Only',
    mine: 'My Presets',
    free: 'Free Only',
    text: 'Text Only',
    vision: 'Vision Only',
  };
  if (query !== null) {
    lines.push(`🔍 Searching: "${query}" • Filter: ${filterLabels[filter]}\n`);
  } else if (filter !== 'all') {
    lines.push(`Filter: ${filterLabels[filter]}\n`);
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
  const freeCount = filtered.filter(c => isFreeModel(c.model)).length;
  const visionCount = filtered.filter(c => c.kind === 'vision').length;
  embed.setFooter({
    text: joinFooter(
      pluralize(filtered.length, { singular: 'preset', plural: 'presets' }),
      filter !== 'all' && formatFilterLabeled(filterLabels[filter]),
      `\uD83C\uDF10 Global  \uD83D\uDD12 Private  \uD83D\uDC64 Other user  \uD83D\uDC41\uFE0F Vision (${visionCount})  \u2B50 Default  \uD83C\uDD93 Free (${freeCount})`
    ),
  });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu — factory returns null on empty pageItems
  const selectRow = buildBrowseSelectMenu<TaggedPreset>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, filter, 'name', query),
    placeholder: 'Select a preset to view...',
    startIndex: startIdx,
    formatItem: preset => ({
      label: `${buildPresetBadges(preset)}${preset.name}`,
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
 * Fetch the user's presets across BOTH kinds and tag each row with its kind.
 * The list summary omits `kind`, so we issue one kind-scoped call per kind and
 * tag by the call that returned it — global-vs-owned rows are mutually exclusive
 * and each call is `take`-bounded, so there's no dedup or pagination concern.
 * Returns null if either fetch fails.
 */
async function fetchTaggedPresets(userClient: UserClient): Promise<TaggedPreset[] | null> {
  const [textResult, visionResult] = await Promise.all([
    userClient.listUserLlmConfigs({ kind: 'text' }),
    userClient.listUserLlmConfigs({ kind: 'vision' }),
  ]);
  if (!textResult.ok || !visionResult.ok) {
    // Log which kind failed + its status so a partial outage is triagable
    // (the two calls hit the same endpoint, so failures are normally correlated).
    logger.warn(
      {
        textStatus: textResult.ok ? undefined : textResult.status,
        visionStatus: visionResult.ok ? undefined : visionResult.status,
      },
      'Failed to fetch presets (one or both kinds)'
    );
    return null;
  }
  return [
    ...textResult.data.configs.map(c => ({ ...c, kind: 'text' as const })),
    ...visionResult.data.configs.map(c => ({ ...c, kind: 'vision' as const })),
  ];
}

/**
 * Handle /preset browse [query?] [filter?]
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = presetBrowseOptions(context.interaction);
  const query = options.query();
  const filterStr = options.filter() ?? 'all';
  const filter = filterStr as PresetBrowseFilter;

  try {
    // Fetch presets (both kinds) and wallet status in parallel
    const { userClient } = clientsFor(context.interaction);
    const [taggedPresets, walletResult] = await Promise.all([
      fetchTaggedPresets(userClient),
      userClient.listWalletKeys(),
    ]);

    if (taggedPresets === null) {
      logger.warn({ userId }, 'Failed to browse presets');
      await context.editReply({ content: '❌ Failed to get presets. Please try again later.' });
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

    const { embed, components } = buildBrowsePage(taggedPresets, filter, query, 0, isGuestMode);

    await context.editReply({ embeds: [embed], components });

    logger.info(
      { userId, count: taggedPresets.length, filter, query, isGuestMode },
      'Browse presets'
    );
  } catch (error) {
    logger.error({ err: error, userId }, 'Error browsing presets');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
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

  // Re-fetch data (both kinds) via typed client
  const [taggedPresets, walletResult] = await Promise.all([
    fetchTaggedPresets(userClient),
    userClient.listWalletKeys(),
  ]);

  if (taggedPresets === null) {
    return null;
  }

  // Only show guest mode when we successfully verified no active keys
  // If wallet API failed, assume user might have keys (don't restrict them)
  const isGuestMode = walletResult.ok && !walletResult.data.keys.some(k => k.isActive === true);

  return buildBrowsePage(taggedPresets, filter, query, page, isGuestMode);
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
    const { userClient } = clientsFor(interaction);
    const result = await buildBrowseResponse(userClient, parsed);

    if (result === null) {
      logger.warn({ userId: interaction.user.id }, 'Failed to fetch presets for pagination');
      return;
    }

    await interaction.editReply({ embeds: [result.embed], components: result.components });
  } catch (error) {
    logger.error(
      { err: error, userId: interaction.user.id, ...parsed },
      'Error during browse pagination'
    );
    // Keep existing content on error
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
        content: '❌ Preset not found.',
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
      content: '❌ Failed to load preset. Please try again.',
      embeds: [],
      components: [],
    });
  }
}
