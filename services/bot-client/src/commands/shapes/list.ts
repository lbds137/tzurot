/**
 * Shapes List Subcommand
 *
 * Fetches and displays the user's owned shapes from shapes.inc.
 * Shows a paginated embed with select menu for choosing shapes.
 *
 * Button/select interactions are handled by interactionHandlers.ts,
 * which is routed through CommandHandler — not inline collectors.
 */

import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';
import { ShapesCustomIds } from '../../utils/customIds.js';

const logger = createLogger('shapes-list');

const ITEMS_PER_PAGE = 10;

export interface ShapeItem {
  id: string;
  name: string;
  username: string;
  avatar: string;
}

export interface ShapesListResponse {
  shapes: ShapeItem[];
  total: number;
}

/** Build a list page embed with select menu and pagination buttons */
export function buildListPage(
  shapes: ShapeItem[],
  page: number
): {
  embed: EmbedBuilder;
  components: ActionRowBuilder[];
} {
  const totalPages = Math.max(1, Math.ceil(shapes.length / ITEMS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * ITEMS_PER_PAGE;
  const pageItems = shapes.slice(start, start + ITEMS_PER_PAGE);

  const lines = pageItems.map((shape, i) => {
    const num = start + i + 1;
    return `**${String(num)}.** ${shape.name} — \`${shape.username}\``;
  });

  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle('🔗 Your Shapes.inc Characters')
    .setDescription(
      lines.length > 0
        ? lines.join('\n')
        : 'No shapes found. Create characters on shapes.inc first.'
    )
    .setFooter({
      text: `${String(shapes.length)} shapes · Page ${String(safePage + 1)} of ${String(totalPages)}`,
    })
    .setTimestamp();

  const components: ActionRowBuilder[] = [];

  // Select menu for choosing a shape
  if (pageItems.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(ShapesCustomIds.listSelect(safePage))
      .setPlaceholder('Select a shape to import or export...');

    for (const shape of pageItems) {
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(shape.name)
          .setValue(shape.username)
          .setDescription(`Slug: ${shape.username}`)
      );
    }

    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));
  }

  // Pagination buttons
  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(ShapesCustomIds.listPrev(safePage))
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage === 0);

    const pageButton = new ButtonBuilder()
      .setCustomId(ShapesCustomIds.listInfo())
      .setLabel(`Page ${String(safePage + 1)} of ${String(totalPages)}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(ShapesCustomIds.listNext(safePage))
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages - 1);

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, pageButton, nextButton)
    );
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
 * Handle /shapes list subcommand
 * Fetches owned shapes and displays the initial paginated list.
 * Subsequent interactions (pagination, selection) are handled by interactionHandlers.ts.
 */
export async function handleList(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await fetchShapesList(userId);

    if (!result.ok) {
      if (result.status === 401) {
        await context.editReply({
          content:
            '❌ No shapes.inc credentials found.\n\n' +
            'Use `/shapes auth` to store your session cookie first.',
        });
        return;
      }
      await context.editReply({
        content: `❌ Failed to fetch shapes: ${result.error}`,
      });
      return;
    }

    const { shapes } = result;
    const { embed, components } = buildListPage(shapes, 0);

    await context.editReply({
      embeds: [embed],
      components: components as ActionRowBuilder<ButtonBuilder>[],
    });

    logger.debug({ userId, total: shapes.length }, '[Shapes] List displayed');
  } catch (error) {
    logger.error({ err: error, userId }, '[Shapes] Unexpected error fetching list');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
