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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  type EmbedBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { formatRelativeTime, normalizeDateTime } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import {
  ITEMS_PER_PAGE,
  createBrowseCustomIdHelpers,
  buildBrowseButtons,
  buildBrowseListEmbed,
  buildBrowseSelectMenu,
  pluralize,
} from '../../utils/browse/index.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { lookupByRequestId } from './lookup.js';
import { buildDiagnosticEmbed } from './embed.js';
import { buildInspectComponents } from './components.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { DiagnosticLogSummary } from './types.js';

const logger = createLogger('inspect-browse');

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

/**
 * Fetch recent diagnostic logs from the gateway.
 *
 * The caller's Discord ID is forwarded via the typed UserClient. The
 * gateway applies the per-user filter server-side — bot owner sees all
 * logs; non-owners see only their own. The owner-as-subject path uses
 * `subject?: SubjectDiscordId` (not exposed here yet; inspect doesn't
 * currently let owners drill into other users' logs through this
 * command — the existing flow lets owners see everyone in the recent
 * list because the server-side filter is identity-based).
 */
export async function fetchRecentLogs(
  userClient: UserClient
): Promise<{ logs: DiagnosticLogSummary[]; count: number }> {
  const result = await userClient.getRecentDiagnostics();
  if (!result.ok) {
    throw new Error(`Failed to fetch recent logs: HTTP ${result.status}`);
  }
  // The schema-derived `createdAt` is `string | Date` (Express serializes
  // Date → string; tests can pass Date directly). Normalize to ISO string
  // for the local `DiagnosticLogSummary` shape.
  return {
    logs: result.data.logs.map(log => ({
      ...log,
      createdAt: normalizeDateTime(log.createdAt),
    })),
    count: result.data.count,
  };
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
      .setEmoji('\u25c0\ufe0f')
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
  const { embed, pageItems, startIndex, totalPages, safePage } =
    buildBrowseListEmbed<DiagnosticLogSummary>({
      entityEmoji: '\ud83d\udd0d',
      titleNoun: 'Diagnostic Logs',
      items: logs,
      page,
      itemsPerPage: ITEMS_PER_PAGE,
      formatRow: log => {
        const unix = Math.floor(new Date(log.createdAt).getTime() / 1000);
        return {
          name: escapeMarkdown(log.personalityName ?? 'Unknown'),
          metadata: [
            `\`${log.model}\``,
            Number.isNaN(unix) ? 'unknown' : `<t:${unix}:R>`,
            `${log.durationMs.toLocaleString()}ms`,
          ],
        };
      },
      empty: {
        noItems:
          'No recent diagnostic logs found \u2014 logs are created when AI ' +
          'responses are generated and retained for 24 hours.',
      },
      footerSegments: [
        logs.length > 0 && pluralize(logs.length, { singular: 'total log', plural: 'total logs' }),
        logs.length > 0 && 'Select a log below to inspect',
      ],
    });

  if (logs.length === 0) {
    return { embeds: [embed], components: [] };
  }

  const selectRow = buildBrowseSelectMenu<DiagnosticLogSummary>({
    items: pageItems,
    customId: browseHelpers.buildSelect(safePage, 'all', 'date', null),
    placeholder: 'Select a log to inspect...',
    startIndex,
    formatItem: log => {
      const name = log.personalityName ?? 'Unknown';
      return {
        label: `${name} \u00b7 ${log.model}`,
        value: log.requestId,
        description: `${formatRelativeTime(log.createdAt)} \u00b7 ${log.durationMs.toLocaleString()}ms`,
      };
    },
  });

  const buttonRow = buildInspectBrowseButtons(safePage, totalPages);

  // selectRow is null only when pageItems is empty, which can't happen here:
  // we returned early on logs.length === 0 above, and the builder clamps to
  // safePage so the slice is non-empty. Defensive check satisfies the type
  // system without adding a runtime branch that can fire.
  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] =
    selectRow !== null ? [selectRow, buttonRow] : [buttonRow];

  return {
    embeds: [embed],
    components,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Slash command entry — show recent logs browse list.
 * Server-side filtering enforces that non-owners see only their own logs.
 */
export async function handleRecentBrowse(
  context: DeferredCommandContext,
  userClient: UserClient
): Promise<void> {
  try {
    const data = await fetchRecentLogs(userClient);
    const { embeds, components } = buildBrowsePage(data.logs, 0);
    await context.editReply({ embeds, components });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching recent logs');
    await context.editReply({
      content: '\u274c Error fetching recent diagnostic logs. Please try again later.',
    });
  }
}

/**
 * Button handler — pagination through browse list.
 */
export async function handleBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  const { userClient } = clientsFor(interaction);
  try {
    const data = await fetchRecentLogs(userClient);
    const { embeds, components } = buildBrowsePage(data.logs, parsed.page);
    await interaction.editReply({ embeds, components });
  } catch (error) {
    logger.error({ err: error }, 'Error during pagination');
    await interaction.editReply({
      content: '\u274c Error loading diagnostic logs.',
      embeds: [],
      components: [],
    });
  }
}

/**
 * Select handler — drill into a specific log from the browse list.
 */
export async function handleBrowseLogSelection(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const parsed = browseHelpers.parseSelect(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  const { userClient } = clientsFor(interaction);
  const requestId = interaction.values[0];
  try {
    const result = await lookupByRequestId(requestId, userClient);
    if (!result.success) {
      await interaction.editReply({
        content: `\u274c ${result.errorMessage}`,
        embeds: [],
        components: [],
      });
      return;
    }

    const embed = buildDiagnosticEmbed(result.log.data);
    const inspectComponents = buildInspectComponents(
      result.log.requestId,
      result.log.data.postProcessing.thinkingContent?.length ?? 0
    );
    const backRow = buildBackToListRow(parsed.page);

    await interaction.editReply({
      embeds: [embed],
      components: [...inspectComponents, backRow],
    });
  } catch (error) {
    logger.error({ err: error, requestId }, 'Error loading selected log');
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
