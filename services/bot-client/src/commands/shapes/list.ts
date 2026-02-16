/**
 * Shapes List Subcommand
 *
 * Fetches and displays the user's owned shapes from shapes.inc.
 * Uses a paginated embed with select menu for import/export actions.
 */

import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { StringSelectMenuInteraction, ButtonInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';

const logger = createLogger('shapes-list');

const ITEMS_PER_PAGE = 10;

interface ShapeItem {
  id: string;
  name: string;
  username: string;
  avatar: string;
}

interface ShapesListResponse {
  shapes: ShapeItem[];
  total: number;
}

/** Build a list page embed with select menu */
function buildListPage(
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
      .setCustomId(`shapes::list-select::${String(safePage)}`)
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
      .setCustomId(`shapes::list-prev::${String(safePage)}`)
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage === 0);

    const pageButton = new ButtonBuilder()
      .setCustomId('shapes::list-info')
      .setLabel(`Page ${String(safePage + 1)} of ${String(totalPages)}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`shapes::list-next::${String(safePage)}`)
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
 * Handle /shapes list subcommand
 * Fetches owned shapes and displays paginated list
 */
export async function handleList(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<ShapesListResponse>('/user/shapes/list', {
      userId,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

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

    const { shapes } = result.data;
    const { embed, components } = buildListPage(shapes, 0);

    const response = await context.editReply({
      embeds: [embed],
      components: components as ActionRowBuilder<ButtonBuilder>[],
    });

    // Handle interactions (pagination + select)
    try {
      const collector = response.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 300_000, // 5 minutes
      });

      const currentShapes = shapes;

      collector.on('collect', interaction => {
        const handleInteraction = async (): Promise<void> => {
          if (interaction.isStringSelectMenu()) {
            await handleSelectInteraction(interaction);
          } else if (interaction.isButton()) {
            await handleButtonInteraction(interaction, currentShapes);
          }
        };
        handleInteraction().catch((error: unknown) => {
          logger.error({ err: error }, '[Shapes] List interaction error');
        });
      });

      collector.on('end', () => {
        // Remove components after timeout (ignore errors — message may be deleted)
        context.editReply({ components: [] }).catch((_: unknown) => {
          /* noop */
        });
      });
    } catch {
      // Collector creation can fail if message was deleted
    }

    logger.debug({ userId, total: shapes.length }, '[Shapes] List displayed');
  } catch (error) {
    logger.error({ err: error, userId }, '[Shapes] Unexpected error fetching list');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

async function handleSelectInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  const selectedSlug = interaction.values[0];

  // Show action buttons for the selected shape
  const importButton = new ButtonBuilder()
    .setCustomId(`shapes::action-import::${selectedSlug}`)
    .setLabel('Import')
    .setEmoji('📥')
    .setStyle(ButtonStyle.Primary);

  const exportButton = new ButtonBuilder()
    .setCustomId(`shapes::action-export::${selectedSlug}`)
    .setLabel('Export')
    .setEmoji('📤')
    .setStyle(ButtonStyle.Secondary);

  const backButton = new ButtonBuilder()
    .setCustomId('shapes::action-back')
    .setLabel('Back to List')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle(`🔗 ${selectedSlug}`)
    .setDescription(
      `What would you like to do with **${selectedSlug}**?\n\n` +
        '**Import** — Create a Tzurot personality from this shape\n' +
        '**Export** — Download the raw character data as JSON'
    );

  await interaction.update({
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(importButton, exportButton, backButton),
    ],
  });
}

async function handleButtonInteraction(
  interaction: ButtonInteraction,
  shapes: ShapeItem[]
): Promise<void> {
  const customId = interaction.customId;

  // Pagination buttons
  if (customId.startsWith('shapes::list-prev::') || customId.startsWith('shapes::list-next::')) {
    const currentPage = parseInt(customId.split('::')[2], 10);
    const newPage = customId.includes('prev') ? currentPage - 1 : currentPage + 1;

    const { embed, components } = buildListPage(shapes, newPage);
    await interaction.update({
      embeds: [embed],
      components: components as ActionRowBuilder<ButtonBuilder>[],
    });
    return;
  }

  // Back to list
  if (customId === 'shapes::action-back') {
    const { embed, components } = buildListPage(shapes, 0);
    await interaction.update({
      embeds: [embed],
      components: components as ActionRowBuilder<ButtonBuilder>[],
    });
    return;
  }

  // Import/Export action buttons
  if (
    customId.startsWith('shapes::action-import::') ||
    customId.startsWith('shapes::action-export::')
  ) {
    const slug = customId.split('::')[2];
    const action = customId.includes('import') ? 'import' : 'export';

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(DISCORD_COLORS.BLURPLE)
          .setDescription(
            action === 'import'
              ? `Use \`/shapes import slug:${slug}\` to import **${slug}** into Tzurot.`
              : `Use \`/shapes export slug:${slug}\` to download **${slug}** as a file.`
          ),
      ],
      components: [],
    });
  }
}
