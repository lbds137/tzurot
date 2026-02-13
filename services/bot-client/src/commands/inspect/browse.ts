/**
 * Browse UI for recent diagnostic logs
 *
 * Shows a paginated list of recent logs when `/inspect` is invoked
 * without an identifier. Uses the standard browse pattern from utils/browse/.
 *
 * Non-admin users only see their own logs via userId filtering.
 *
 * Exported handlers:
 * - handleRecentBrowse()         — slash command entry (no identifier)
 * - handleBrowsePagination()     — pagination button handler
 * - handleBrowseLogSelection()   — select menu → drill into log
 * - isInspectBrowseInteraction()   — custom ID guard for browse buttons
 * - isInspectBrowseSelectInteraction() — custom ID guard for browse select
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { z } from 'zod';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import {
  ITEMS_PER_PAGE,
  truncateForSelect,
  truncateForDescription,
  createBrowseCustomIdHelpers,
  buildBrowseButtons,
  calculatePaginationState,
} from '../../utils/browse/index.js';
import { adminFetch } from '../../utils/adminApiClient.js';
import { lookupByRequestId } from './lookup.js';
import { buildDiagnosticEmbed } from './embed.js';
import { buildInspectComponents } from './components.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { DiagnosticLogSummary } from './types.js';

const logger = createLogger('inspect-browse');

/** Runtime schema for diagnostic log summaries from the gateway */
const DiagnosticLogSummarySchema = z.object({
  id: z.string(),
  requestId: z.string(),
  personalityId: z.string().nullable(),
  personalityName: z.string().nullable(),
  userId: z.string().nullable(),
  guildId: z.string().nullable(),
  channelId: z.string().nullable(),
  model: z.string(),
  provider: z.string(),
  durationMs: z.number(),
  createdAt: z.string(),
});

const RecentLogsResponseSchema = z.object({
  logs: z.array(DiagnosticLogSummarySchema),
  count: z.number(),
});

// ---------------------------------------------------------------------------
// Browse custom ID helpers (standard pattern, no sort)
// ---------------------------------------------------------------------------

type InspectBrowseFilter = 'all';
const VALID_FILTERS = ['all'] as const;

const browseHelpers = createBrowseCustomIdHelpers<InspectBrowseFilter>({
  prefix: 'inspect',
  validFilters: VALID_FILTERS,
  includeSort: false,
});

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

/** Fetch recent diagnostic logs from the gateway, optionally filtered by userId */
export async function fetchRecentLogs(
  filterUserId?: string
): Promise<{ logs: DiagnosticLogSummary[]; count: number }> {
  const url =
    filterUserId !== undefined
      ? `/admin/diagnostic/recent?userId=${encodeURIComponent(filterUserId)}`
      : '/admin/diagnostic/recent';
  const response = await adminFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch recent logs: HTTP ${response.status}`);
  }
  const data: unknown = await response.json();
  return RecentLogsResponseSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/** Format a date string as a relative time label for select menu descriptions */
export function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();

  if (Number.isNaN(then)) {
    return 'unknown';
  }

  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Embed builders
// ---------------------------------------------------------------------------

/** Build the browse embed showing a numbered list of logs */
function buildBrowseEmbed(
  pageItems: DiagnosticLogSummary[],
  page: number,
  totalPages: number,
  totalCount: number
): EmbedBuilder {
  const startIdx = page * ITEMS_PER_PAGE;

  const lines = pageItems.map((log, i) => {
    const num = startIdx + i + 1;
    const name = log.personalityName ?? 'Unknown';
    const unix = Math.floor(new Date(log.createdAt).getTime() / 1000);
    const timestamp = Number.isNaN(unix) ? 'unknown' : `<t:${unix}:R>`;
    return `**${num}.** ${name} \u00b7 \`${log.model}\` \u00b7 ${timestamp} \u00b7 ${log.durationMs.toLocaleString()}ms`;
  });

  return new EmbedBuilder()
    .setTitle('\ud83d\udd0d Recent Diagnostic Logs')
    .setDescription(lines.join('\n'))
    .setColor(DISCORD_COLORS.BLURPLE)
    .setFooter({
      text: `Page ${page + 1} of ${totalPages} \u00b7 ${totalCount} total logs \u00b7 Select a log below to inspect`,
    });
}

/** Build an empty-state embed when no logs exist */
export function buildEmptyBrowseEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('\ud83d\udd0d Recent Diagnostic Logs')
    .setDescription(
      'No recent diagnostic logs found.\n\u2022 Logs are retained for 24 hours\n\u2022 Logs are created when AI responses are generated'
    )
    .setColor(DISCORD_COLORS.BLURPLE);
}

// ---------------------------------------------------------------------------
// Select menu builder
// ---------------------------------------------------------------------------

/** Build select menu for log selection */
function buildBrowseSelectMenu(
  pageItems: DiagnosticLogSummary[],
  startIdx: number,
  page: number
): StringSelectMenuBuilder {
  const options = pageItems.map((log, i) => {
    const num = startIdx + i + 1;
    const name = log.personalityName ?? 'Unknown';
    const label = truncateForSelect(`${num}. ${name} \u00b7 ${log.model}`);
    const description = truncateForDescription(
      `${formatTimeAgo(log.createdAt)} \u00b7 ${log.durationMs.toLocaleString()}ms`
    );
    return {
      label,
      description,
      value: log.requestId,
    };
  });

  return new StringSelectMenuBuilder()
    .setCustomId(browseHelpers.buildSelect(page, 'all', 'date', null))
    .setPlaceholder('Select a log to inspect...')
    .addOptions(options);
}

// ---------------------------------------------------------------------------
// Button builders
// ---------------------------------------------------------------------------

/** Build pagination buttons (no sort toggle) */
function buildInspectBrowseButtons(
  page: number,
  totalPages: number
): ActionRowBuilder<ButtonBuilder> {
  return buildBrowseButtons<InspectBrowseFilter>({
    currentPage: page,
    totalPages,
    filter: 'all',
    currentSort: 'date',
    query: null,
    buildCustomId: browseHelpers.build,
    buildInfoId: browseHelpers.buildInfo,
    showSortToggle: false,
  });
}

/** Build a "Back to List" button row that returns to browse at the given page */
function buildBackToListRow(page: number): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(browseHelpers.build(page, 'all', 'date', null))
      .setLabel('Back to List')
      .setEmoji('\ud83d\udccb')
      .setStyle(ButtonStyle.Secondary)
  );
}

// ---------------------------------------------------------------------------
// Page orchestrator
// ---------------------------------------------------------------------------

/**
 * Build a complete browse page (embed + components).
 * Uses client-side pagination: the gateway returns all logs (capped at 100) and we
 * slice per page. This is intentional — the dataset is small and ephemeral
 * (24h retention), so server-side pagination would add complexity for no real gain.
 */
export function buildBrowsePage(
  logs: DiagnosticLogSummary[],
  page: number
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
  if (logs.length === 0) {
    return { embeds: [buildEmptyBrowseEmbed()], components: [] };
  }

  const pagination = calculatePaginationState(logs.length, ITEMS_PER_PAGE, page);
  const pageItems = logs.slice(pagination.startIndex, pagination.endIndex);

  const embed = buildBrowseEmbed(
    pageItems,
    pagination.safePage,
    pagination.totalPages,
    logs.length
  );
  const selectRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    buildBrowseSelectMenu(pageItems, pagination.startIndex, pagination.safePage)
  );
  const buttonRow = buildInspectBrowseButtons(pagination.safePage, pagination.totalPages);

  return {
    embeds: [embed],
    components: [selectRow, buttonRow],
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Slash command entry — show recent logs browse list.
 * filterUserId limits results to that user's logs (non-admin mode).
 */
export async function handleRecentBrowse(
  context: DeferredCommandContext,
  filterUserId?: string
): Promise<void> {
  try {
    const data = await fetchRecentLogs(filterUserId);
    const { embeds, components } = buildBrowsePage(data.logs, 0);
    await context.editReply({ embeds, components });
  } catch (error) {
    logger.error({ err: error }, '[InspectBrowse] Error fetching recent logs');
    await context.editReply({
      content: '\u274c Error fetching recent diagnostic logs. Please try again later.',
    });
  }
}

/**
 * Button handler — pagination through browse list.
 * filterUserId limits results to that user's logs (non-admin mode).
 */
export async function handleBrowsePagination(
  interaction: ButtonInteraction,
  filterUserId?: string
): Promise<void> {
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  try {
    const data = await fetchRecentLogs(filterUserId);
    const { embeds, components } = buildBrowsePage(data.logs, parsed.page);
    await interaction.editReply({ embeds, components });
  } catch (error) {
    logger.error({ err: error }, '[InspectBrowse] Error during pagination');
    await interaction.editReply({
      content: '\u274c Error loading diagnostic logs.',
      embeds: [],
      components: [],
    });
  }
}

/**
 * Select handler — drill into a specific log from the browse list.
 * filterUserId restricts access to only the user's own logs.
 */
export async function handleBrowseLogSelection(
  interaction: StringSelectMenuInteraction,
  filterUserId?: string
): Promise<void> {
  const parsed = browseHelpers.parseSelect(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  const requestId = interaction.values[0];
  try {
    const result = await lookupByRequestId(requestId, filterUserId);
    if (!result.success) {
      await interaction.editReply({
        content: `\u274c ${result.errorMessage}`,
        embeds: [],
        components: [],
      });
      return;
    }

    const embed = buildDiagnosticEmbed(result.log.data);
    const inspectComponents = buildInspectComponents(result.log.requestId);
    const backRow = buildBackToListRow(parsed.page);

    await interaction.editReply({
      embeds: [embed],
      components: [...inspectComponents, backRow],
    });
  } catch (error) {
    logger.error({ err: error, requestId }, '[InspectBrowse] Error loading selected log');
    await interaction.editReply({
      content: '\u274c Error loading diagnostic log.',
      embeds: [],
      components: [],
    });
  }
}

// ---------------------------------------------------------------------------
// Custom ID guards
// ---------------------------------------------------------------------------

/** Check if a custom ID is an inspect browse pagination button */
export function isInspectBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/** Check if a custom ID is an inspect browse select menu */
export function isInspectBrowseSelectInteraction(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
}
