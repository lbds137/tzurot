/**
 * Error Recovery Components for Shapes Detail View
 *
 * Provides a "Back to Browse" button for error states so users don't
 * have to retype /shapes browse to navigate back.
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { ShapesCustomIds } from '../../utils/customIds.js';

/** Build a single-button row with "Back to Browse" for error recovery. */
export function buildBackToBrowseRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ShapesCustomIds.detailBack())
      .setLabel('Back to Browse')
      .setEmoji('\u25C0\uFE0F')
      .setStyle(ButtonStyle.Secondary)
  );
}
