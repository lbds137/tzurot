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
  escapeMarkdown,
  type ActionRowBuilder,
  type ButtonBuilder,
  type EmbedBuilder,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  createBrowseCustomIdHelpers,
  buildBrowseButtons,
  buildBrowseListEmbed,
  buildBrowseSelectMenu,
  ITEMS_PER_PAGE,
  pluralize,
  formatSortNatural,
  type BrowseSortType,
} from '../../utils/browse/index.js';

const logger = createLogger('shapes-browse');

export interface ShapeItem {
  id: string;
  name: string;
  username: string;
  avatar: string;
  createdAt: string | null;
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

  const { embed, pageItems, startIndex, totalPages, safePage } = buildBrowseListEmbed<ShapeItem>({
    entityEmoji: '\uD83D\uDD17',
    titleNoun: 'Shapes',
    items: sorted,
    page,
    itemsPerPage: ITEMS_PER_PAGE,
    formatRow: shape => ({
      name: escapeMarkdown(shape.name),
      // The shapes.inc slug is what users type in /shapes import.
      techId: shape.username,
    }),
    empty: {
      noItems: 'No shapes found \u2014 create characters on shapes.inc first.',
    },
    footerSegments: [
      pluralize(sorted.length, { singular: 'shape', plural: 'shapes' }),
      formatSortNatural(sort),
    ],
  });

  const components: ActionRowBuilder[] = [];

  // Select menu for choosing a shape. Numbering is added by the factory
  // (Shapes was the only browse command without numbered options before
  // standardization — the embed body already numbered items, now the
  // select menu matches).
  const selectRow = buildBrowseSelectMenu<ShapeItem>({
    items: pageItems,
    customId: shapesBrowseIds.buildSelect(safePage, 'all', sort, null),
    placeholder: 'Select a shape to view details...',
    startIndex,
    formatItem: shape => ({
      label: shape.name,
      value: shape.username,
      description: `Slug: ${shape.username}`,
    }),
  });
  if (selectRow !== null) {
    components.push(selectRow);
  }

  // Pagination + sort buttons (only if more than one page or to show sort toggle)
  if (sorted.length > 0) {
    const buttonRow = buildBrowseButtons({
      currentPage: safePage,
      totalPages,
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
  userClient: UserClient
): Promise<{ ok: true; shapes: ShapeItem[] } | { ok: false; status: number; error: string }> {
  const result = await userClient.listShapes();

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
    const { userClient } = clientsFor(context.interaction);
    const result = await fetchShapesList(userClient);

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

    logger.debug({ userId, total: shapes.length }, 'Browse displayed');
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error fetching list');
    await context.editReply({
      content: '\u274C An unexpected error occurred. Please try again.',
    });
  }
}
