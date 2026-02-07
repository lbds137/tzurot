/**
 * Dashboard Delete Confirmation
 *
 * Shared utilities for building delete confirmation dialogs.
 */

import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types';
import { DASHBOARD_MESSAGES } from './messages.js';

/**
 * Options for building a delete confirmation dialog
 */
interface DeleteConfirmationOptions {
  /** Entity type being deleted (e.g., 'Persona', 'Preset') */
  entityType: string;
  /** Display name of the entity being deleted */
  entityName: string;
  /** Custom ID for the confirm button */
  confirmCustomId: string;
  /** Custom ID for the cancel button */
  cancelCustomId: string;
  /** Additional warning text (optional) */
  additionalWarning?: string;
  /** List of items that will be deleted (optional) */
  deletedItems?: string[];
  /** Custom title (optional, defaults to "Delete {entityType}?") */
  title?: string;
  /** Custom confirm button label (optional) */
  confirmLabel?: string;
  /** Custom cancel button label (optional) */
  cancelLabel?: string;
}

/**
 * Build a delete confirmation embed and buttons.
 *
 * @returns Object with embed and components for the confirmation dialog
 *
 * @example
 * ```typescript
 * const { embed, components } = buildDeleteConfirmation({
 *   entityType: 'Persona',
 *   entityName: session.data.name,
 *   confirmCustomId: PersonaCustomIds.confirmDelete(entityId),
 *   cancelCustomId: PersonaCustomIds.cancelDelete(entityId),
 *   additionalWarning: 'Any personality-specific overrides will be cleared.',
 * });
 *
 * await interaction.update({ embeds: [embed], components });
 * ```
 */
export function buildDeleteConfirmation(options: DeleteConfirmationOptions): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const {
    entityType,
    entityName,
    confirmCustomId,
    cancelCustomId,
    additionalWarning,
    deletedItems,
    title = DASHBOARD_MESSAGES.DELETE_CONFIRM_TITLE(entityType),
    confirmLabel = DASHBOARD_MESSAGES.DELETE_LABEL,
    cancelLabel = DASHBOARD_MESSAGES.CANCEL_LABEL,
  } = options;

  // Build description
  let description = `Are you sure you want to delete **${entityName}**?\n\n`;
  description += `${DASHBOARD_MESSAGES.DELETE_WARNING}`;

  if (additionalWarning !== undefined) {
    description += ` ${additionalWarning}`;
  }

  if (deletedItems !== undefined && deletedItems.length > 0) {
    description += '\n\n**This will also delete:**\n';
    description += deletedItems.map(item => `• ${item}`).join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(DISCORD_COLORS.WARNING);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cancelCustomId)
      .setLabel(cancelLabel)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(confirmCustomId)
      .setLabel(confirmLabel)
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️')
  );

  return { embed, components: [buttons] };
}

/**
 * Build a simple success message for completed deletion.
 *
 * @param entityName - Name of entity that was deleted
 * @returns Formatted success message
 */
export function buildDeleteSuccessMessage(entityName: string): string {
  return `✅ **${entityName}** has been deleted.`;
}

/**
 * Build a deletion summary with counts.
 *
 * @param entityName - Name of the deleted entity
 * @param deletedCounts - Object with count of deleted related items
 * @returns Formatted success message with counts
 *
 * @example
 * ```typescript
 * const message = buildDeleteSummary('My Persona', {
 *   'conversation messages': 42,
 *   'long-term memories': 5,
 * });
 * // Returns: "✅ **My Persona** has been deleted.\n\n**Deleted data:**\n• 42 conversation messages\n• 5 long-term memories"
 * ```
 */
export function buildDeleteSummary(
  entityName: string,
  deletedCounts: Record<string, number>
): string {
  let message = `✅ **${entityName}** has been deleted.`;

  const countLines = Object.entries(deletedCounts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `• ${count} ${label}`);

  if (countLines.length > 0) {
    message += '\n\n**Deleted data:**\n' + countLines.join('\n');
  }

  return message;
}
