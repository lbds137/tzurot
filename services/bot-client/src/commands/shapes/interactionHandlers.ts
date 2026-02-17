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
    await interaction.update({
      content: '❌ Something went wrong. Please try again.',
      embeds: [],
      components: [],
    });
    return;
  }

  const { action } = parsed;

  try {
    // Note: 'list-info' (disabled page indicator) and 'list-select' (select menu)
    // are intentionally absent here — list-info is disabled so Discord won't deliver
    // clicks, and list-select routes through handleShapesSelectMenu instead.

    // --- List pagination ---
    if (action === 'list-prev' || action === 'list-next') {
      await handleListPagination(interaction, parsed.page ?? 0, action === 'list-prev');
      return;
    }

    // --- Back to list (always page 0) ---
    if (action === 'action-back') {
      await handleListPage(interaction, 0);
      return;
    }

    // --- Shape action buttons (import/export from selection) ---
    if (action === 'action-import' || action === 'action-export') {
      if (parsed.slug === undefined) {
        await interaction.update({
          content: '❌ Invalid shape selection. Please try again.',
          embeds: [],
          components: [],
        });
        return;
      }
      await showShapeActionHint(interaction, parsed.slug, action === 'action-import');
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
    // No user ownership check needed — the message is ephemeral (deferralMode: 'ephemeral'),
    // so only the original requester can see and click these buttons.
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
    await interaction.update({
      content: '❌ Unknown action. Please try again.',
      embeds: [],
      components: [],
    });
  } catch (error) {
    logger.error({ err: error, customId: interaction.customId }, '[Shapes] Button handler error');
    try {
      await interaction.update({
        content: '❌ An unexpected error occurred.',
        embeds: [],
        components: [],
      });
    } catch {
      // Interaction already acknowledged or token expired — nothing to do
    }
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
    await interaction.update({
      content: '❌ Something went wrong. Please try again.',
      embeds: [],
      components: [],
    });
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
    await interaction.update({
      content: '❌ Unknown action. Please try again.',
      embeds: [],
      components: [],
    });
  } catch (error) {
    logger.error(
      { err: error, customId: interaction.customId },
      '[Shapes] Select menu handler error'
    );
    try {
      await interaction.update({
        content: '❌ An unexpected error occurred.',
        embeds: [],
        components: [],
      });
    } catch {
      // Interaction already acknowledged or token expired — nothing to do
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Handle prev/next pagination — computes target page from current + direction */
async function handleListPagination(
  interaction: ButtonInteraction,
  currentPage: number,
  isPrev: boolean
): Promise<void> {
  // currentPage comes from the custom ID (set at render time) so it may be stale
  // if the list changed. buildListPage clamps out-of-bounds pages safely
  // (including negative values from prev on page 0 via safePage = Math.max(0, ...)).
  const targetPage = isPrev ? currentPage - 1 : currentPage + 1;
  await handleListPage(interaction, targetPage);
}

/** Re-fetch shapes list and render the specified page */
async function handleListPage(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  page: number
): Promise<void> {
  const userId = interaction.user.id;
  const result = await fetchShapesList(userId);

  if (!result.ok) {
    await interaction.update({
      content:
        result.status === 401
          ? '❌ Session expired. Use `/shapes auth` to re-authenticate.'
          : `❌ Failed to fetch shapes (error ${String(result.status)}). Please try again.`,
      embeds: [],
      components: [],
    });
    return;
  }

  const { embed, components } = buildListPage(result.shapes, page);

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

/** Parse import state from custom ID + embed and start the import */
async function handleImportConfirm(
  interaction: ButtonInteraction,
  parsed: NonNullable<ReturnType<typeof ShapesCustomIds.parse>>
): Promise<void> {
  const userId = interaction.user.id;

  const VALID_IMPORT_TYPES = ['full', 'memory_only'] as const;
  const rawType = parsed.importType;
  const importType = VALID_IMPORT_TYPES.includes(rawType as 'full' | 'memory_only')
    ? (rawType as 'full' | 'memory_only')
    : undefined;

  // Slug is stored in the embed footer (not the custom ID) to avoid
  // Discord's 100-char custom ID limit with long slugs
  const footerText = interaction.message.embeds[0]?.footer?.text ?? '';
  const rawSlug = footerText.startsWith('slug:') ? footerText.slice(5) : undefined;
  // Validate slug format — shapes.inc usernames are lowercase alphanumeric + hyphens
  const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
  const slug = rawSlug !== undefined && SLUG_PATTERN.test(rawSlug) ? rawSlug : undefined;

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
