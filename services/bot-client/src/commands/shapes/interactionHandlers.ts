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
 *
 * Detail view handlers (import, export, refresh, cancel, confirm) live
 * in detailHandlers.ts to keep this router under ESLint max-lines.
 */

import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { ButtonBuilder, ActionRowBuilder } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { ShapesCustomIds } from '../../utils/customIds.js';
import { buildBrowsePage, fetchShapesList, shapesBrowseIds } from './browse.js';
import type { BrowseSortType } from '../../utils/browse/constants.js';
import { buildAuthModal } from './auth.js';
import {
  showDetailView,
  parseSlugFromFooter,
  handleDetailImport,
  handleDetailExport,
  handleDetailRefresh,
  handleImportCancel,
  handleImportConfirm,
} from './detailHandlers.js';

const logger = createLogger('shapes-interactions');

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
      // Preserve the user's sort preference from the detail view footer
      const { sort } = parseSlugFromFooter(interaction);
      await handleBrowsePage(interaction, 0, sort);
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
      // Preserve the user's sort preference from the browse select menu custom ID
      const parsed = shapesBrowseIds.parseSelect(customId);
      const sort = parsed?.sort ?? 'name';
      await showDetailView(interaction, selectedSlug, sort);
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
