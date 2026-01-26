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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  isFreeModel,
  type LlmConfigSummary,
  type AIProvider,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import { PRESET_DASHBOARD_CONFIG, flattenPresetData, type FlattenedPresetData } from './config.js';
import { fetchPreset } from './api.js';

const logger = createLogger('preset-browse');

/** Items per page for pagination */
const ITEMS_PER_PAGE = 10;

/** Browse filter options */
export type PresetBrowseFilter = 'all' | 'global' | 'mine' | 'free';

/** Custom ID prefix for browse pagination */
const BROWSE_PREFIX = 'preset::browse';

/** Custom ID prefix for browse select menu */
const BROWSE_SELECT_PREFIX = 'preset::browse-select';

/** Maximum length for select menu option labels */
const MAX_SELECT_LABEL_LENGTH = 100;

interface ListResponse {
  configs: LlmConfigSummary[];
}

interface WalletListResponse {
  keys: {
    provider: AIProvider;
    isActive: boolean;
  }[];
}

/**
 * Build custom ID for browse pagination
 */
function buildBrowseCustomId(
  page: number,
  filter: PresetBrowseFilter,
  query: string | null
): string {
  // Encode query if present, otherwise use empty marker
  const encodedQuery = query ?? '';
  return `${BROWSE_PREFIX}::${page}::${filter}::${encodedQuery}`;
}

/**
 * Parse browse custom ID
 */
export function parseBrowseCustomId(
  customId: string
): { page: number; filter: PresetBrowseFilter; query: string | null } | null {
  if (!customId.startsWith(BROWSE_PREFIX)) {
    return null;
  }

  const parts = customId.split('::');
  if (parts.length < 4) {
    return null;
  }

  const page = parseInt(parts[2], 10);
  const filter = parts[3] as PresetBrowseFilter;
  const query = parts[4] !== '' ? parts[4] : null;

  if (isNaN(page) || !['all', 'global', 'mine', 'free'].includes(filter)) {
    return null;
  }

  return { page, filter, query };
}

/**
 * Check if custom ID is a preset browse interaction
 */
export function isPresetBrowseInteraction(customId: string): boolean {
  return customId.startsWith(BROWSE_PREFIX);
}

/**
 * Check if custom ID is a preset browse select interaction
 */
export function isPresetBrowseSelectInteraction(customId: string): boolean {
  return customId.startsWith(BROWSE_SELECT_PREFIX);
}

/**
 * Truncate text for select menu label
 */
function truncateForSelect(text: string, maxLength: number = MAX_SELECT_LABEL_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Build custom ID for browse select menu with context
 * Format: preset::browse-select::page::filter::query
 */
function buildBrowseSelectCustomId(
  page: number,
  filter: PresetBrowseFilter,
  query: string | null
): string {
  // Truncate query to fit within Discord's 100-char customId limit
  const truncatedQuery = query !== null && query.length > 50 ? query.slice(0, 50) : (query ?? '');
  return `${BROWSE_SELECT_PREFIX}::${page}::${filter}::${truncatedQuery}`;
}

/**
 * Parse browse select custom ID to extract context
 */
export function parseBrowseSelectCustomId(customId: string): {
  page: number;
  filter: PresetBrowseFilter;
  query: string | null;
} | null {
  if (!customId.startsWith(BROWSE_SELECT_PREFIX)) {
    return null;
  }

  const parts = customId.split('::');
  if (parts.length < 4) {
    // Legacy format without context - return defaults
    return { page: 0, filter: 'all', query: null };
  }

  const page = parseInt(parts[2], 10);
  const filter = parts[3] as PresetBrowseFilter;
  const query = parts[4] !== '' ? parts[4] : null;

  if (isNaN(page)) {
    return { page: 0, filter: 'all', query: null };
  }

  return { page, filter, query };
}

/** Options for buildBrowseSelectMenu */
interface BrowseSelectMenuOptions {
  pageItems: LlmConfigSummary[];
  startIdx: number;
  isGuestMode: boolean;
  page: number;
  filter: PresetBrowseFilter;
  query: string | null;
}

/**
 * Build select menu for choosing a preset from the list
 */
function buildBrowseSelectMenu(
  options: BrowseSelectMenuOptions
): ActionRowBuilder<StringSelectMenuBuilder> {
  const { pageItems, startIdx, isGuestMode, page, filter, query } = options;
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(buildBrowseSelectCustomId(page, filter, query))
    .setPlaceholder('Select a preset to view...')
    .setMinValues(1)
    .setMaxValues(1);

  pageItems.forEach((preset, index) => {
    const num = startIdx + index + 1;

    // Build badges
    const badges: string[] = [];
    if (preset.isGlobal) {
      badges.push('🌐');
    } else if (preset.isOwned) {
      badges.push('🔒');
    }
    if (preset.isDefault) {
      badges.push('⭐');
    }
    if (isFreeModel(preset.model)) {
      badges.push('🆓');
    }
    const badgeStr = badges.length > 0 ? badges.join('') + ' ' : '';

    // Label: "1. 🌐⭐ Preset Name"
    const label = truncateForSelect(`${num}. ${badgeStr}${preset.name}`);

    // Description: model + optional "unavailable in guest mode"
    const shortModel = preset.model.includes('/') ? preset.model.split('/').pop() : preset.model;
    let description = shortModel ?? preset.model;
    if (isGuestMode && !isFreeModel(preset.model)) {
      description += ' (requires API key)';
    }

    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(preset.id)
        .setDescription(truncateForSelect(description))
    );
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}

/**
 * Filter presets based on filter type and optional query
 */
function filterPresets(
  presets: LlmConfigSummary[],
  filter: PresetBrowseFilter,
  query: string | null
): LlmConfigSummary[] {
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
function formatPresetLine(c: LlmConfigSummary, isGuestMode: boolean, index: number): string {
  const badges: string[] = [];
  if (c.isGlobal) {
    badges.push('🌐');
  } else if (c.isOwned) {
    badges.push('🔒');
  }
  if (c.isDefault) {
    badges.push('⭐');
  }
  if (isFreeModel(c.model)) {
    badges.push('🆓');
  }

  const badgeStr = badges.join('');
  const shortModel = c.model.includes('/') ? c.model.split('/').pop() : c.model;
  const safeName = escapeMarkdown(c.name);

  // In guest mode, dim paid presets
  const nameStyle = isGuestMode && !isFreeModel(c.model) ? `~~${safeName}~~` : `**${safeName}**`;

  return `${index + 1}. ${badgeStr} ${nameStyle}\n   └ \`${shortModel}\``;
}

/**
 * Build pagination buttons for browse
 */
function buildBrowseButtons(
  currentPage: number,
  totalPages: number,
  filter: PresetBrowseFilter,
  query: string | null
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  // Previous button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildBrowseCustomId(currentPage - 1, filter, query))
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0)
  );

  // Page indicator (disabled button)
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
      .setCustomId(buildBrowseCustomId(currentPage + 1, filter, query))
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  return row;
}

/** Union type for action rows that can contain buttons or select menus */
type BrowseActionRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

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
  const footerParts = [`${filtered.length} presets`];
  if (filter !== 'all') {
    footerParts.push(`filtered by: ${filterLabels[filter]}`);
  }
  footerParts.push(`🌐 Global  🔒 Yours  ⭐ Default  🆓 Free (${freeCount})`);
  embed.setFooter({ text: footerParts.join(' • ') });

  // Build components
  const components: BrowseActionRow[] = [];

  // Add select menu if there are items on this page
  if (pageItems.length > 0) {
    components.push(
      buildBrowseSelectMenu({
        pageItems,
        startIdx,
        isGuestMode,
        page: safePage,
        filter,
        query,
      })
    );
  }

  // Add pagination buttons if multiple pages
  if (totalPages > 1) {
    components.push(buildBrowseButtons(safePage, totalPages, filter, query));
  }

  return { embed, components };
}

/**
 * Handle /preset browse [query?] [filter?]
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const query = context.interaction.options.getString('query');
  const filterStr = context.interaction.options.getString('filter') ?? 'all';
  const filter = filterStr as PresetBrowseFilter;

  try {
    // Fetch presets and wallet status in parallel
    const [presetResult, walletResult] = await Promise.all([
      callGatewayApi<ListResponse>('/user/llm-config', { userId }),
      callGatewayApi<WalletListResponse>('/wallet/list', { userId }),
    ]);

    if (!presetResult.ok) {
      logger.warn({ userId, status: presetResult.status }, '[Preset] Failed to browse presets');
      await context.editReply({ content: '❌ Failed to get presets. Please try again later.' });
      return;
    }

    // Check if user is in guest mode (no active wallet keys)
    const isGuestMode = !(walletResult.ok && walletResult.data.keys.some(k => k.isActive === true));

    const { embed, components } = buildBrowsePage(
      presetResult.data.configs,
      filter,
      query,
      0,
      isGuestMode
    );

    await context.editReply({ embeds: [embed], components });

    logger.info(
      { userId, count: presetResult.data.configs.length, filter, query, isGuestMode },
      '[Preset] Browse presets'
    );
  } catch (error) {
    logger.error({ err: error, userId }, '[Preset] Error browsing presets');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}

/**
 * Build browse response for a given context
 * Reusable for pagination and back-from-dashboard navigation
 */
export async function buildBrowseResponse(
  userId: string,
  browseContext: {
    page: number;
    filter: PresetBrowseFilter;
    query: string | null;
  }
): Promise<{ embed: EmbedBuilder; components: BrowseActionRow[] } | null> {
  const { page, filter, query } = browseContext;

  // Re-fetch data
  const [presetResult, walletResult] = await Promise.all([
    callGatewayApi<ListResponse>('/user/llm-config', { userId }),
    callGatewayApi<WalletListResponse>('/wallet/list', { userId }),
  ]);

  if (!presetResult.ok) {
    return null;
  }

  const isGuestMode = !(walletResult.ok && walletResult.data.keys.some(k => k.isActive === true));

  return buildBrowsePage(presetResult.data.configs, filter, query, page, isGuestMode);
}

/**
 * Handle browse pagination button clicks
 */
export async function handleBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseBrowseCustomId(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  try {
    const result = await buildBrowseResponse(interaction.user.id, parsed);

    if (result === null) {
      logger.warn(
        { userId: interaction.user.id },
        '[Preset] Failed to fetch presets for pagination'
      );
      return;
    }

    await interaction.editReply({ embeds: [result.embed], components: result.components });
  } catch (error) {
    logger.error(
      { err: error, userId: interaction.user.id, ...parsed },
      '[Preset] Error during browse pagination'
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
  const browseContext = parseBrowseSelectCustomId(interaction.customId);

  await interaction.deferUpdate();

  try {
    // Fetch the preset
    const preset = await fetchPreset(presetId, userId);

    if (!preset) {
      await interaction.editReply({
        content: '❌ Preset not found.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Flatten the data for dashboard display
    const flattenedData = flattenPresetData(preset);

    // Build dashboard embed and components - show back button since we're coming from browse
    const embed = buildDashboardEmbed(PRESET_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(PRESET_DASHBOARD_CONFIG, presetId, flattenedData, {
      showBack: true, // Show "Back to Browse" instead of close
      showRefresh: true,
      showDelete: flattenedData.isOwned,
      toggleGlobal: {
        isGlobal: flattenedData.isGlobal,
        isOwned: flattenedData.isOwned,
      },
    });

    // Update the message with the dashboard
    await interaction.editReply({ embeds: [embed], components });

    // Create session for tracking - include browse context for back navigation
    const sessionManager = getSessionManager();
    const sessionData: FlattenedPresetData = {
      ...flattenedData,
      browseContext: browseContext
        ? {
            source: 'browse',
            page: browseContext.page,
            filter: browseContext.filter,
            query: browseContext.query,
          }
        : undefined,
    };

    await sessionManager.set<FlattenedPresetData>({
      userId,
      entityType: 'preset',
      entityId: presetId,
      data: sessionData,
      messageId: interaction.message.id,
      channelId: interaction.channelId,
    });

    logger.info({ userId, presetId, name: preset.name }, '[Preset] Opened dashboard from browse');
  } catch (error) {
    logger.error({ err: error, presetId }, '[Preset] Failed to open dashboard from browse');
    await interaction.editReply({
      content: '❌ Failed to load preset. Please try again.',
      embeds: [],
      components: [],
    });
  }
}
