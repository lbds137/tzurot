/**
 * Reusable Destructive Confirmation Flow
 *
 * This module provides a standardized pattern for dangerous operations that require
 * user confirmation with a typed phrase. The flow is:
 *
 * 1. Command calls showDestructiveWarning() with config
 * 2. User sees warning embed with danger button
 * 3. User clicks danger button → Modal appears with typed confirmation
 * 4. User types confirmation phrase and submits
 * 5. If phrase matches → Execute callback
 * 6. If phrase doesn't match → Show error
 *
 * This pattern is used by:
 * - /history hard-delete
 * - Future destructive operations
 *
 * IMPORTANT: Uses global button/modal handlers instead of awaitMessageComponent
 * because awaitMessageComponent doesn't work reliably in multi-replica deployments.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalActionRowComponentBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type InteractionEditReplyOptions,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types';
import { DestructiveCustomIds } from './customIds.js';

/**
 * Configuration for a destructive confirmation flow
 */
export interface DestructiveConfirmationConfig {
  /** Source command name (e.g., 'history', 'character') */
  source: string;
  /** Operation identifier (e.g., 'hard-delete') */
  operation: string;
  /** Optional entity identifier (e.g., personality slug) */
  entityId?: string;
  /** Warning title shown in embed */
  warningTitle: string;
  /** Warning description shown in embed */
  warningDescription: string;
  /** Text shown on the danger button */
  buttonLabel: string;
  /** Modal title */
  modalTitle: string;
  /** Label for the confirmation input field */
  confirmationLabel: string;
  /** The exact phrase user must type to confirm */
  confirmationPhrase: string;
  /** Placeholder text for the input field */
  confirmationPlaceholder: string;
}

/**
 * Build the warning embed and buttons for a destructive operation
 *
 * @param config - Configuration for the destructive flow
 * @returns Object with embed and components to send
 */
export function buildDestructiveWarning(config: DestructiveConfirmationConfig): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle(config.warningTitle)
    .setDescription(config.warningDescription)
    .setColor(DISCORD_COLORS.ERROR);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        DestructiveCustomIds.confirmButton(config.source, config.operation, config.entityId)
      )
      .setLabel(config.buttonLabel)
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(
        DestructiveCustomIds.cancelButton(config.source, config.operation, config.entityId)
      )
      .setLabel('Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [buttons],
  };
}

/**
 * Build the confirmation modal with typed phrase input
 *
 * @param config - Configuration for the destructive flow
 * @returns Modal to show to user
 */
export function buildConfirmationModal(config: DestructiveConfirmationConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(DestructiveCustomIds.modalSubmit(config.source, config.operation, config.entityId))
    .setTitle(config.modalTitle);

  const confirmationInput = new TextInputBuilder()
    .setCustomId('confirmation_phrase')
    .setLabel(config.confirmationLabel)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(config.confirmationPlaceholder)
    .setMaxLength(100);

  const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
    confirmationInput
  );

  modal.addComponents(row);

  return modal;
}

/**
 * Handle cancel button click - update message to show cancellation
 *
 * @param interaction - Button interaction
 * @param cancelMessage - Optional custom cancel message
 */
export async function handleDestructiveCancel(
  interaction: ButtonInteraction,
  cancelMessage = 'Operation cancelled.'
): Promise<void> {
  await interaction.update({
    content: cancelMessage,
    embeds: [],
    components: [],
  });
}

/**
 * Handle confirm button click - show confirmation modal
 *
 * @param interaction - Button interaction
 * @param config - Configuration for the destructive flow
 */
export async function handleDestructiveConfirmButton(
  interaction: ButtonInteraction,
  config: DestructiveConfirmationConfig
): Promise<void> {
  const modal = buildConfirmationModal(config);
  await interaction.showModal(modal);
}

/**
 * Validate confirmation phrase from modal submission
 *
 * @param interaction - Modal submit interaction
 * @param expectedPhrase - The phrase user should have typed
 * @returns true if phrase matches (case-insensitive), false otherwise
 */
export function validateConfirmationPhrase(
  interaction: ModalSubmitInteraction,
  expectedPhrase: string
): boolean {
  const typedPhrase = interaction.fields.getTextInputValue('confirmation_phrase');
  return typedPhrase.toLowerCase().trim() === expectedPhrase.toLowerCase().trim();
}

/**
 * Handle invalid confirmation phrase - show error
 *
 * @param interaction - Modal submit interaction
 * @param expectedPhrase - The phrase user should have typed
 */
export async function handleInvalidConfirmation(
  interaction: ModalSubmitInteraction,
  expectedPhrase: string
): Promise<void> {
  await interaction.reply({
    content: `Confirmation failed. You must type \`${expectedPhrase}\` exactly to proceed.`,
    ephemeral: true,
  });
}

/**
 * Result type for the destructive operation callback
 */
export interface DestructiveOperationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Message to show on success */
  successMessage?: string;
  /** Embed to show on success (alternative to successMessage) */
  successEmbed?: EmbedBuilder;
  /** Message to show on failure */
  errorMessage?: string;
}

/**
 * Handle successful confirmation - execute the destructive operation
 *
 * @param interaction - Modal submit interaction
 * @param executeOperation - Callback that performs the destructive operation
 */
export async function handleDestructiveModalSubmit(
  interaction: ModalSubmitInteraction,
  expectedPhrase: string,
  executeOperation: () => Promise<DestructiveOperationResult>
): Promise<void> {
  // Validate the confirmation phrase
  if (!validateConfirmationPhrase(interaction, expectedPhrase)) {
    await handleInvalidConfirmation(interaction, expectedPhrase);
    return;
  }

  // Defer update since operation may take time
  await interaction.deferUpdate();

  // Execute the destructive operation
  const result = await executeOperation();

  if (result.success) {
    const reply: InteractionEditReplyOptions = {
      embeds: [],
      components: [],
    };

    if (result.successEmbed !== undefined) {
      reply.content = undefined;
      reply.embeds = [result.successEmbed];
    } else {
      reply.content = result.successMessage ?? 'Operation completed successfully.';
    }

    await interaction.editReply(reply);
  } else {
    await interaction.editReply({
      content: result.errorMessage ?? 'Operation failed. Please try again.',
      embeds: [],
      components: [],
    });
  }
}

/**
 * Options for creating a hard-delete config
 */
export interface HardDeleteConfigOptions {
  /** What's being deleted (e.g., 'conversation history') */
  entityType: string;
  /** Name of the specific entity (e.g., personality name) */
  entityName: string;
  /** Additional warning text */
  additionalWarning: string;
  /** Source command */
  source: string;
  /** Operation name */
  operation: string;
  /** Entity identifier */
  entityId?: string;
}

/**
 * Convenience function to create a standard hard-delete config
 */
export function createHardDeleteConfig(
  options: HardDeleteConfigOptions
): DestructiveConfirmationConfig {
  const { entityType, entityName, additionalWarning, source, operation, entityId } = options;
  return {
    source,
    operation,
    entityId,
    warningTitle: `Delete ${entityType}`,
    warningDescription:
      `Are you sure you want to **permanently delete** ${entityType} for **${entityName}**?\n\n` +
      `${additionalWarning}\n\n` +
      `Type \`DELETE\` in the next prompt to confirm.`,
    buttonLabel: 'Delete Forever',
    modalTitle: `Confirm Deletion`,
    confirmationLabel: 'Type DELETE to confirm',
    confirmationPhrase: 'DELETE',
    confirmationPlaceholder: 'DELETE',
  };
}
