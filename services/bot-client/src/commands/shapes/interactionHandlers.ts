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
 *
 * Slug is stored in the embed footer (format: "slug:xxx") to avoid
 * Discord's 100-char custom ID limit.
 */

import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { ShapesCustomIds } from '../../utils/customIds.js';
import { buildBrowsePage, fetchShapesList, shapesBrowseIds } from './browse.js';
import type { BrowseSortType } from '../../utils/browse/constants.js';
import { buildAuthModal } from './auth.js';
import { startImport } from './import.js';
import { startExport } from './export.js';
import { buildShapeDetailEmbed } from './detail.js';

const logger = createLogger('shapes-interactions');

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
const INVALID_STATE_MSG = '\u274C Invalid state. Please try again from the browse list.';

/** Extract slug from embed footer (format: "slug:xxx" or "slug:xxx::detail") */
function parseSlugFromFooter(interaction: ButtonInteraction): {
  slug: string | undefined;
  isFromDetail: boolean;
} {
  const footerText = interaction.message.embeds[0]?.footer?.text ?? '';
  const isFromDetail = footerText.endsWith('::detail');
  // Safe without /g flag: SLUG_PATTERN enforces [a-z0-9-] only, so "::detail" can't appear in a slug
  const raw = footerText.replace('::detail', '');
  const rawSlug = raw.startsWith('slug:') ? raw.slice(5) : undefined;
  const slug = rawSlug !== undefined && SLUG_PATTERN.test(rawSlug) ? rawSlug : undefined;
  return { slug, isFromDetail };
}

/** Map HTTP status codes to user-friendly hints */
function httpStatusHint(status: number): string {
  if (status === 429) {
    return 'rate limited by shapes.inc';
  }
  if (status === 404) {
    return 'shape not found';
  }
  if (status >= 500) {
    return 'shapes.inc is temporarily unavailable';
  }
  return `unexpected error (${String(status)})`;
}

/**
 * Handle all shapes button interactions
 * Routes by parsing the custom ID action
 */
export async function handleShapesButton(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  try {
    // --- Browse pagination (handled by browse helpers) ---
    if (shapesBrowseIds.isBrowse(customId)) {
      await handleBrowsePagination(interaction);
      return;
    }

    // --- Parse shapes-specific custom IDs ---
    const parsed = ShapesCustomIds.parse(customId);
    if (parsed === null) {
      logger.warn({ customId }, '[Shapes] Unparseable button customId');
      await interaction.update({
        content: '\u274C Something went wrong. Please try again.',
        embeds: [],
        components: [],
      });
      return;
    }

    const { action } = parsed;

    // --- Detail view actions ---
    if (action === 'detail-import') {
      await handleDetailImport(interaction, parsed.importType);
      return;
    }
    if (action === 'detail-export') {
      await handleDetailExport(interaction, parsed.exportFormat);
      return;
    }
    if (action === 'detail-refresh') {
      await handleDetailRefresh(interaction);
      return;
    }
    if (action === 'detail-back') {
      await handleBrowsePage(interaction, 0, 'name');
      return;
    }

    // --- Import confirm/cancel ---
    if (action === 'import-confirm') {
      await handleImportConfirm(interaction, parsed);
      return;
    }
    if (action === 'import-cancel') {
      await handleImportCancel(interaction);
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

    logger.warn({ customId, action }, '[Shapes] Unknown button action');
    await interaction.update({
      content: '\u274C Unknown action. Please try again.',
      embeds: [],
      components: [],
    });
  } catch (error) {
    logger.error({ err: error, customId }, '[Shapes] Button handler error');
    try {
      await interaction.update({
        content: '\u274C An unexpected error occurred.',
        embeds: [],
        components: [],
      });
    } catch {
      // Interaction already acknowledged or token expired
    }
  }
}

/**
 * Handle all shapes select menu interactions
 */
export async function handleShapesSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const { customId } = interaction;

  try {
    // Browse select — show detail view for the selected shape
    if (shapesBrowseIds.isBrowseSelect(customId)) {
      const selectedSlug = interaction.values[0];
      await showDetailView(interaction, selectedSlug);
      return;
    }

    logger.warn({ customId }, '[Shapes] Unknown select menu action');
    await interaction.update({
      content: '\u274C Unknown action. Please try again.',
      embeds: [],
      components: [],
    });
  } catch (error) {
    logger.error({ err: error, customId }, '[Shapes] Select menu handler error');
    try {
      await interaction.update({
        content: '\u274C An unexpected error occurred.',
        embeds: [],
        components: [],
      });
    } catch {
      // Interaction already acknowledged or token expired
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Handle browse pagination buttons — parse page/sort from customId */
async function handleBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = shapesBrowseIds.parse(interaction.customId);
  if (parsed === null) {
    await interaction.update({
      content: '\u274C Invalid pagination state.',
      embeds: [],
      components: [],
    });
    return;
  }
  await handleBrowsePage(interaction, parsed.page, parsed.sort);
}

/** Re-fetch shapes list and render the specified page */
async function handleBrowsePage(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  page: number,
  sort: BrowseSortType
): Promise<void> {
  const userId = interaction.user.id;
  const result = await fetchShapesList(userId);

  if (!result.ok) {
    await interaction.update({
      content:
        result.status === 401
          ? '\u274C Session expired. Use `/shapes auth` to re-authenticate.'
          : `\u274C Failed to fetch shapes \u2014 ${httpStatusHint(result.status)}.`,
      embeds: [],
      components: [],
    });
    return;
  }

  const { embed, components } = buildBrowsePage(result.shapes, page, sort);
  await interaction.update({
    embeds: [embed],
    components: components as ActionRowBuilder<ButtonBuilder>[],
  });
}

/** Show the detail view for a selected shape */
async function showDetailView(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  slug: string
): Promise<void> {
  const userId = interaction.user.id;
  const { embed, components } = await buildShapeDetailEmbed(userId, slug);
  await interaction.update({
    embeds: [embed],
    components,
  });
}

/** Handle import button from detail view — show confirmation */
async function handleDetailImport(
  interaction: ButtonInteraction,
  importType: string | undefined
): Promise<void> {
  const { slug } = parseSlugFromFooter(interaction);
  if (slug === undefined || importType === undefined) {
    await interaction.update({
      content: INVALID_STATE_MSG,
      embeds: [],
      components: [],
    });
    return;
  }

  const isMemoryOnly = importType === 'memory_only';
  const confirmEmbed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle(
      isMemoryOnly
        ? '\uD83D\uDCE5 Import Memories from Shapes.inc'
        : '\uD83D\uDCE5 Import from Shapes.inc'
    )
    .setDescription(
      isMemoryOnly
        ? `Ready to import memories from **${slug}** into the existing personality.\n\n` +
            'This will:\n' +
            '\u2022 Look up the previously imported personality by slug\n' +
            '\u2022 Fetch all conversation memories from shapes.inc\n' +
            '\u2022 Import them (deduplicating against existing memories)\n\n' +
            'Existing personality config will not be changed.'
        : `Ready to import **${slug}** from shapes.inc.\n\n` +
            'This will:\n' +
            '\u2022 Create a new personality with the character config\n' +
            '\u2022 Download the character avatar\n' +
            '\u2022 Import all conversation memories\n' +
            '\u2022 Set up the LLM configuration\n\n' +
            'The import runs in the background and may take a few minutes.'
    )
    .setFooter({ text: `slug:${slug}::detail` })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.importConfirm(importType))
    .setLabel('Start Import')
    .setEmoji('\uD83D\uDCE5')
    .setStyle(ButtonStyle.Primary);

  const cancelButton = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.importCancel())
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  await interaction.update({
    embeds: [confirmEmbed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton)],
  });
}

/** Handle export button from detail view — start export immediately */
async function handleDetailExport(
  interaction: ButtonInteraction,
  exportFormat: string | undefined
): Promise<void> {
  const { slug } = parseSlugFromFooter(interaction);
  if (slug === undefined || exportFormat === undefined) {
    await interaction.update({
      content: INVALID_STATE_MSG,
      embeds: [],
      components: [],
    });
    return;
  }

  const format: 'json' | 'markdown' = exportFormat === 'markdown' ? 'markdown' : 'json';
  const userId = interaction.user.id;

  const success = await startExport(interaction, userId, { slug, format });
  if (success) {
    // Show detail view with updated job status
    const { embed, components } = await buildShapeDetailEmbed(userId, slug);
    await interaction.editReply({
      embeds: [embed],
      components,
    });
  }
}

/** Handle refresh button — re-fetch and show detail view */
async function handleDetailRefresh(interaction: ButtonInteraction): Promise<void> {
  const { slug } = parseSlugFromFooter(interaction);
  if (slug === undefined) {
    await interaction.update({
      content: INVALID_STATE_MSG,
      embeds: [],
      components: [],
    });
    return;
  }

  await showDetailView(interaction, slug);
}

/** Handle import cancel — return to detail view if triggered from there */
async function handleImportCancel(interaction: ButtonInteraction): Promise<void> {
  const { slug, isFromDetail } = parseSlugFromFooter(interaction);

  if (isFromDetail && slug !== undefined) {
    await showDetailView(interaction, slug);
    return;
  }

  await interaction.update({ content: 'Import cancelled.', embeds: [], components: [] });
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

  const { slug, isFromDetail } = parseSlugFromFooter(interaction);

  if (slug === undefined || importType === undefined) {
    logger.warn({ customId: interaction.customId }, '[Shapes] Import confirm missing state');
    await interaction.update({
      content: '\u274C Invalid import state. Please try `/shapes import` again.',
      embeds: [],
      components: [],
    });
    return;
  }

  const success = await startImport(interaction, userId, { slug, importType });

  // If triggered from detail view and import succeeded, show detail view with job status
  if (isFromDetail && success) {
    const { embed, components } = await buildShapeDetailEmbed(userId, slug);
    await interaction.editReply({
      embeds: [embed],
      components,
    });
  }
}
