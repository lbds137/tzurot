/**
 * Truncation Gate — button row builders.
 *
 * `entityType` is parameterized so the same builders produce the right
 * custom IDs for any dashboard ('character::view_full::*',
 * 'persona::view_full::*', etc.). Routing is by entityType; downstream
 * handlers live alongside the entity-specific data resolvers.
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { buildDashboardCustomId, type TruncationGateEntityType } from '../types.js';

/**
 * Build the three-button row for the warning, ordered per `04-discord.md`
 * Standard Button Order (Primary first, Destructive last):
 * - View Full (primary, safe read-only inspection)
 * - Cancel (secondary, dismiss)
 * - Edit with Truncation (danger, opt-in to destructive edit)
 *
 * The destructive-last convention matches the memory detail flow and the
 * delete-confirmation dialogs across the codebase; consistency outranks
 * the "lead with the warning" instinct for this UX.
 */
export function buildTruncationButtons(
  entityType: TruncationGateEntityType,
  entityId: string,
  sectionId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId(entityType, 'view_full', entityId, sectionId))
      .setLabel('View Full')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId(entityType, 'cancel_edit', entityId, sectionId))
      .setLabel('Cancel')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId(entityType, 'edit_truncated', entityId, sectionId))
      .setLabel('Edit with Truncation')
      .setEmoji('✂️')
      .setStyle(ButtonStyle.Danger)
  );
}

/**
 * Build the "Open Editor" button shown after the user opts into the
 * truncating edit. Splitting the opt-in confirmation from the modal-open
 * click lets us satisfy Discord's "showModal must be the first response"
 * constraint without doing any async work before the showModal call.
 */
export function buildOpenEditorButtonRow(
  entityType: TruncationGateEntityType,
  entityId: string,
  sectionId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId(entityType, 'open_editor', entityId, sectionId))
      .setLabel('Open Editor')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary)
  );
}
