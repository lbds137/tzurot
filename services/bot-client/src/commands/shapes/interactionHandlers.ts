/**
 * Shapes Interaction Handlers
 *
 * Central router for all shapes button and select menu interactions.
 * These handlers are exported from shapes/index.ts and routed through
 * CommandHandler — making them restart-safe and multi-replica compatible.
 *
 * Design: Pagination re-fetches the shapes list on every button click
 * instead of holding state in closures. The API call is fast (~200ms)
 * and this makes interactions fully stateless.
 */

import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { ShapesCustomIds } from '../../utils/customIds.js';
import { buildListPage, fetchShapesList } from './list.js';
import { buildAuthModal } from './auth.js';
import { startImport } from './import.js';

const logger = createLogger('shapes-interactions');

/**
 * Handle all shapes button interactions
 * Routes by parsing the custom ID action
 */
export async function handleShapesButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = ShapesCustomIds.parse(interaction.customId);
  if (parsed === null) {
    logger.warn({ customId: interaction.customId }, '[Shapes] Unparseable button customId');
    return;
  }

  const { action } = parsed;

  try {
    // --- List pagination ---
    if (action === 'list-prev' || action === 'list-next') {
      await handleListPagination(interaction, parsed.page ?? 0, action === 'list-prev');
      return;
    }

    // --- Back to list ---
    if (action === 'action-back') {
      await handleListPagination(interaction, 0, false);
      return;
    }

    // --- Shape action buttons (import/export from selection) ---
    if (action === 'action-import' || action === 'action-export') {
      await showShapeActionHint(interaction, parsed.slug ?? '', action === 'action-import');
      return;
    }

    // --- Import confirm/cancel ---
    if (action === 'import-confirm') {
      await handleImportConfirm(interaction, parsed);
      return;
    }
    if (action === 'import-cancel') {
      await interaction.update({ content: 'Import cancelled.', embeds: [], components: [] });
      return;
    }

    // --- Auth continue/cancel ---
    if (action === 'auth-continue') {
      await interaction.showModal(buildAuthModal());
      return;
    }
    if (action === 'auth-cancel') {
      await interaction.update({
        content: 'Authentication cancelled.',
        embeds: [],
        components: [],
      });
      return;
    }

    logger.warn({ customId: interaction.customId, action }, '[Shapes] Unknown button action');
  } catch (error) {
    logger.error({ err: error, customId: interaction.customId }, '[Shapes] Button handler error');
  }
}

/**
 * Handle all shapes select menu interactions
 * Currently only list-select (choosing a shape from the list)
 */
export async function handleShapesSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const parsed = ShapesCustomIds.parse(interaction.customId);
  if (parsed === null) {
    logger.warn({ customId: interaction.customId }, '[Shapes] Unparseable select customId');
    return;
  }

  try {
    if (parsed.action === 'list-select') {
      const selectedSlug = interaction.values[0];
      await showShapeActions(interaction, selectedSlug);
      return;
    }

    logger.warn(
      { customId: interaction.customId, action: parsed.action },
      '[Shapes] Unknown select menu action'
    );
  } catch (error) {
    logger.error(
      { err: error, customId: interaction.customId },
      '[Shapes] Select menu handler error'
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Re-fetch shapes list and show the requested page */
async function handleListPagination(
  interaction: ButtonInteraction,
  currentPage: number,
  isPrev: boolean
): Promise<void> {
  const userId = interaction.user.id;
  const result = await fetchShapesList(userId);

  if (!result.ok) {
    await interaction.update({
      content:
        result.status === 401
          ? '❌ Session expired. Use `/shapes auth` to re-authenticate.'
          : `❌ Failed to fetch shapes: ${result.error}`,
      embeds: [],
      components: [],
    });
    return;
  }

  const targetPage = isPrev ? currentPage - 1 : currentPage + 1;
  const { embed, components } = buildListPage(result.shapes, targetPage);

  await interaction.update({
    embeds: [embed],
    components: components as ActionRowBuilder<ButtonBuilder>[],
  });
}

/** Show import/export/back action buttons for a selected shape */
async function showShapeActions(
  interaction: StringSelectMenuInteraction,
  slug: string
): Promise<void> {
  const importButton = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.actionImport(slug))
    .setLabel('Import')
    .setEmoji('📥')
    .setStyle(ButtonStyle.Primary);

  const exportButton = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.actionExport(slug))
    .setLabel('Export')
    .setEmoji('📤')
    .setStyle(ButtonStyle.Secondary);

  const backButton = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.actionBack())
    .setLabel('Back to List')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle(`🔗 ${slug}`)
    .setDescription(
      `What would you like to do with **${slug}**?\n\n` +
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

/** Show action hint for import/export buttons */
async function showShapeActionHint(
  interaction: ButtonInteraction,
  slug: string,
  isImport: boolean
): Promise<void> {
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(DISCORD_COLORS.BLURPLE)
        .setDescription(
          isImport
            ? `Use \`/shapes import slug:${slug}\` to import **${slug}** into Tzurot.`
            : `Use \`/shapes export slug:${slug}\` to download **${slug}** as a file.`
        ),
    ],
    components: [],
  });
}

/** Parse import state from custom ID and start the import */
async function handleImportConfirm(
  interaction: ButtonInteraction,
  parsed: NonNullable<ReturnType<typeof ShapesCustomIds.parse>>
): Promise<void> {
  const userId = interaction.user.id;
  const slug = parsed.slug;
  const importType = parsed.importType as 'full' | 'memory_only' | undefined;

  if (slug === undefined || importType === undefined) {
    logger.warn({ customId: interaction.customId }, '[Shapes] Import confirm missing state');
    await interaction.update({
      content: '❌ Invalid import state. Please try `/shapes import` again.',
      embeds: [],
      components: [],
    });
    return;
  }

  await startImport(interaction, userId, {
    slug,
    importType,
    existingPersonalityId: parsed.personalityId,
  });
}
