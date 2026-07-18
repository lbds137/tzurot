/**
 * Tier-A confirmation — simple two-button confirm for destructive acts that
 * don't warrant a typed phrase (design-system spec §3.5; machinery §4.4 Tier A).
 *
 * The factory owns the invariants call sites kept getting wrong:
 * - Button order is ALWAYS Cancel (Secondary) → Confirm (Danger) — the Danger
 *   button is last in the row.
 * - Label and emoji are set separately (04-discord button rule).
 *
 * For irreversible bulk operations (purge-class), use the Tier-B typed-phrase
 * flow in `confirmDestructive.ts` instead.
 */

import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { DASHBOARD_MESSAGES } from '../dashboard/messages.js';

/** Options for the generic Tier-A confirmation surface. */
export interface ConfirmActionOptions {
  /** Embed title (include the action emoji if the surface wants one). */
  title: string;
  /** Fully-assembled embed description. */
  description: string;
  /** Custom ID for the confirm (Danger) button. */
  confirmCustomId: string;
  /** Custom ID for the cancel button. */
  cancelCustomId: string;
  /** Confirm button label (verb-first, e.g. "Delete 12 Memories"). */
  confirmLabel: string;
  /** Emoji for the confirm button (set separately from the label). */
  confirmEmoji?: string;
  /** Cancel button label (defaults to "Cancel"). */
  cancelLabel?: string;
  /** Embed color (defaults to WARNING — confirmations are alert surfaces). */
  color?: number;
}

/**
 * Build a Tier-A confirmation embed + button row.
 * Row order is Cancel → Confirm(Danger); the factory does not accept an order.
 */
export function buildConfirmAction(options: ConfirmActionOptions): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const {
    title,
    description,
    confirmCustomId,
    cancelCustomId,
    confirmLabel,
    confirmEmoji,
    cancelLabel = DASHBOARD_MESSAGES.CANCEL_LABEL,
    color = DISCORD_COLORS.WARNING,
  } = options;

  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);

  const confirmButton = new ButtonBuilder()
    .setCustomId(confirmCustomId)
    .setLabel(confirmLabel)
    .setStyle(ButtonStyle.Danger);
  if (confirmEmoji !== undefined) {
    confirmButton.setEmoji(confirmEmoji);
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cancelCustomId)
      .setLabel(cancelLabel)
      .setStyle(ButtonStyle.Secondary),
    confirmButton
  );

  return { embed, components: [buttons] };
}

/** Options for the delete-flavored Tier-A wrapper. */
export interface DeleteConfirmationOptions {
  /** Entity type being deleted (e.g., 'Persona', 'Preset'). */
  entityType: string;
  /** Display name of the entity being deleted. */
  entityName: string;
  /** Custom ID for the confirm button. */
  confirmCustomId: string;
  /** Custom ID for the cancel button. */
  cancelCustomId: string;
  /** Additional warning text (optional). */
  additionalWarning?: string;
  /** List of items that will be deleted (optional). */
  deletedItems?: string[];
  /** Custom title (optional, defaults to "Delete {entityType}?"). */
  title?: string;
  /** Custom confirm button label (optional). */
  confirmLabel?: string;
  /** Custom cancel button label (optional). */
  cancelLabel?: string;
}

/**
 * Build a delete confirmation dialog — the delete-flavored Tier-A wrapper.
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
    cancelLabel,
  } = options;

  let description = `Are you sure you want to delete **${entityName}**?\n\n`;
  description += `${DASHBOARD_MESSAGES.DELETE_WARNING}`;

  if (additionalWarning !== undefined) {
    description += ` ${additionalWarning}`;
  }

  if (deletedItems !== undefined && deletedItems.length > 0) {
    description += '\n\n**This will also delete:**\n';
    description += deletedItems.map(item => `• ${item}`).join('\n');
  }

  return buildConfirmAction({
    title,
    description,
    confirmCustomId,
    cancelCustomId,
    confirmLabel,
    confirmEmoji: '🗑️',
    cancelLabel,
  });
}
