/**
 * Shapes Browse Subcommand
 *
 * Fetches and displays the user's owned shapes from shapes.inc.
 * Shows a paginated embed with select menu and sort toggle.
 *
 * Button/select interactions are handled by interactionHandlers.ts,
 * which is routed through CommandHandler — not inline collectors.
 */

import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  type ButtonBuilder,
} from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';
import { createBrowseCustomIdHelpers } from '../../utils/browse/customIdFactory.js';
import { buildBrowseButtons } from '../../utils/browse/buttonBuilder.js';
import { calculatePaginationState } from '../../utils/browse/types.js';
import { ITEMS_PER_PAGE, type BrowseSortType } from '../../utils/browse/constants.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';

const logger = createLogger('shapes-browse');

export interface ShapeItem {
  id: string;
  name: string;
  username: string;
  avatar: string;
  createdAt: string | null;
}

export interface ShapesListResponse {
  shapes: ShapeItem[];
  total: number;
}

/** Browse custom ID helpers — pagination uses shapes::browse::... format */
export const shapesBrowseIds = createBrowseCustomIdHelpers({
  prefix: 'shapes',
  validFilters: ['all'] as const,
});

/** Sort shapes by name (A-Z) or date (newest first) */
function sortShapes(shapes: ShapeItem[], sort: BrowseSortType): ShapeItem[] {
  const sorted = [...shapes];
  if (sort === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // Sort by date (newest first). Null dates sort to end.
    sorted.sort((a, b) => {
      if (a.createdAt === null && b.createdAt === null) {
        return 0;
      }
      if (a.createdAt === null) {
        return 1;
      }
      if (b.createdAt === null) {
        return -1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }
  return sorted;
}

/** Build a browse page embed with select menu and pagination buttons */
export function buildBrowsePage(
  shapes: ShapeItem[],
  page: number,
  sort: BrowseSortType
): {
  embed: EmbedBuilder;
  components: ActionRowBuilder[];
} {
  const sorted = sortShapes(shapes, sort);
  const pagination = calculatePaginationState(sorted.length, ITEMS_PER_PAGE, page);
  const pageItems = sorted.slice(pagination.startIndex, pagination.endIndex);

  const lines = pageItems.map((shape, i) => {
    const num = pagination.startIndex + i + 1;
    return `**${String(num)}.** ${shape.name} \u2014 \`${shape.username}\``;
  });

  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle('\uD83D\uDD17 Your Shapes.inc Characters')
    .setDescription(
      lines.length > 0
        ? lines.join('\n')
        : 'No shapes found. Create characters on shapes.inc first.'
    )
    .setFooter({
      text: `${String(sorted.length)} shapes \u00B7 Page ${String(pagination.safePage + 1)} of ${String(pagination.totalPages)} \u00B7 Sorted by ${sort}`,
    })
    .setTimestamp();

  const components: ActionRowBuilder[] = [];

  // Select menu for choosing a shape
  if (pageItems.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(shapesBrowseIds.buildSelect(pagination.safePage, 'all', sort, null))
      .setPlaceholder('Select a shape to view details...');

    for (const shape of pageItems) {
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(truncateForSelect(shape.name))
          .setValue(shape.username)
          .setDescription(`Slug: ${shape.username}`)
      );
    }

    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));
  }

  // Pagination + sort buttons (only if more than one page or to show sort toggle)
  if (sorted.length > 0) {
    const buttonRow = buildBrowseButtons({
      currentPage: pagination.safePage,
      totalPages: pagination.totalPages,
      filter: 'all' as const,
      currentSort: sort,
      query: null,
      buildCustomId: shapesBrowseIds.build,
      buildInfoId: shapesBrowseIds.buildInfo,
      showSortToggle: true,
    });
    components.push(buttonRow);
  }

  return { embed, components };
}

/**
 * Fetch shapes list from the gateway API
 * Exported for reuse by interactionHandlers (stateless pagination)
 */
export async function fetchShapesList(
  userId: string
): Promise<{ ok: true; shapes: ShapeItem[] } | { ok: false; status: number; error: string }> {
  const result = await callGatewayApi<ShapesListResponse>('/user/shapes/list', {
    userId,
    timeout: GATEWAY_TIMEOUTS.DEFERRED,
  });

  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error };
  }

  return { ok: true, shapes: result.data.shapes };
}

/**
 * Handle /shapes browse subcommand
 * Fetches owned shapes and displays the initial paginated list.
 * Subsequent interactions (pagination, selection) are handled by interactionHandlers.ts.
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await fetchShapesList(userId);

    if (!result.ok) {
      if (result.status === 401) {
        await context.editReply({
          content:
            '\u274C No shapes.inc credentials found.\n\n' +
            'Use `/shapes auth` to store your session cookie first.',
        });
        return;
      }
      await context.editReply({
        content: `\u274C Failed to fetch shapes: ${result.error}`,
      });
      return;
    }

    const { shapes } = result;
    const { embed, components } = buildBrowsePage(shapes, 0, 'name');

    await context.editReply({
      embeds: [embed],
      components: components as ActionRowBuilder<ButtonBuilder>[],
    });

    logger.debug({ userId, total: shapes.length }, '[Shapes] Browse displayed');
  } catch (error) {
    logger.error({ err: error, userId }, '[Shapes] Unexpected error fetching list');
    await context.editReply({
      content: '\u274C An unexpected error occurred. Please try again.',
    });
  }
}
