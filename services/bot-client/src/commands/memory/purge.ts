/**
 * Purge Handler
 * Handles /memory purge command - delete ALL memories for a personality
 * Requires typed confirmation modal for safety
 */

import {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  replyWithError,
  handleCommandError,
  createDangerEmbed,
  createSuccessEmbed,
} from '../../utils/commandHelpers.js';
import { resolvePersonalityId } from './autocomplete.js';

const logger = createLogger('memory-purge');

/** Timeout for confirmation buttons (60 seconds) */
const CONFIRMATION_TIMEOUT = 60_000;

/** Modal timeout (5 minutes for typing) */
const MODAL_TIMEOUT = 300_000;

interface StatsResponse {
  personalityId: string;
  personalityName: string;
  personaId: string | null;
  totalCount: number;
  lockedCount: number;
}

interface PurgeResponse {
  deletedCount: number;
  lockedPreserved: number;
  personalityId: string;
  personalityName: string;
  message: string;
}

/**
 * Generate the confirmation phrase for a personality
 */
function getConfirmationPhrase(personalityName: string): string {
  return `DELETE ${personalityName.toUpperCase()} MEMORIES`;
}

/**
 * Handle /memory purge
 * Shows warning and requires typed confirmation before purging
 */
// eslint-disable-next-line max-lines-per-function, max-statements -- Discord command handler with multi-step confirmation flow
export async function handlePurge(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const personalityInput = interaction.options.getString('personality', true);

  try {
    // Resolve personality slug to ID
    const personalityId = await resolvePersonalityId(userId, personalityInput);

    if (personalityId === null) {
      await replyWithError(
        interaction,
        `Personality "${personalityInput}" not found. Use autocomplete to select a valid personality.`
      );
      return;
    }

    // Get stats to show what will be purged
    const statsResult = await callGatewayApi<StatsResponse>(
      `/user/memory/stats?personalityId=${personalityId}`,
      {
        userId,
        method: 'GET',
      }
    );

    if (!statsResult.ok) {
      const errorMessage =
        statsResult.status === 404
          ? `Personality "${personalityInput}" not found.`
          : 'Failed to get memory stats. Please try again later.';
      logger.warn(
        { userId, personalityInput, status: statsResult.status },
        '[Memory] Purge stats failed'
      );
      await replyWithError(interaction, errorMessage);
      return;
    }

    const stats = statsResult.data;

    // Nothing to purge
    if (stats.totalCount === 0) {
      await interaction.editReply({
        content: `No memories found for **${escapeMarkdown(stats.personalityName)}**.`,
      });
      return;
    }

    const confirmPhrase = getConfirmationPhrase(stats.personalityName);
    const deletableCount = stats.totalCount - stats.lockedCount;

    // Build warning embed
    let description = `You are about to **permanently delete ALL ${deletableCount} memories** for **${escapeMarkdown(stats.personalityName)}**.`;

    if (stats.lockedCount > 0) {
      description += `\n\n**${stats.lockedCount}** locked (core) memories will be preserved.`;
    }

    description += '\n\n**This action cannot be undone.**';
    description += '\n\nTo confirm, you will need to type:';
    description += `\n\`${confirmPhrase}\``;

    const embed = createDangerEmbed('DANGER: Purge All Memories', description);

    // Create buttons
    const proceedButton = new ButtonBuilder()
      .setCustomId('memory_purge_proceed')
      .setLabel('I Understand - Proceed')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('memory_purge_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(proceedButton, cancelButton);

    const response = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    // Wait for button interaction
    let buttonInteraction: ButtonInteraction;
    try {
      buttonInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: ButtonInteraction) => i.user.id === userId,
        time: CONFIRMATION_TIMEOUT,
      });
    } catch {
      await interaction.editReply({
        content: 'Purge cancelled - confirmation timed out.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (buttonInteraction.customId === 'memory_purge_cancel') {
      await buttonInteraction.update({
        content: 'Purge cancelled.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Show modal for typed confirmation
    const modal = new ModalBuilder()
      .setCustomId(`memory_purge_confirm_${personalityId}`)
      .setTitle('Confirm Memory Purge');

    const confirmInput = new TextInputBuilder()
      .setCustomId('confirmation_phrase')
      .setLabel(`Type: ${confirmPhrase}`)
      .setPlaceholder(confirmPhrase)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(confirmPhrase.length)
      .setMaxLength(confirmPhrase.length + 5); // Small buffer for typos

    const modalRow = new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput);
    modal.addComponents(modalRow);

    await buttonInteraction.showModal(modal);

    // Wait for modal submission
    let modalInteraction: ModalSubmitInteraction;
    try {
      modalInteraction = await buttonInteraction.awaitModalSubmit({
        filter: (i: ModalSubmitInteraction) =>
          i.user.id === userId && i.customId === `memory_purge_confirm_${personalityId}`,
        time: MODAL_TIMEOUT,
      });
    } catch {
      // Modal timed out or was dismissed
      await interaction.editReply({
        content: 'Purge cancelled - confirmation timed out.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Validate confirmation phrase
    const enteredPhrase = modalInteraction.fields.getTextInputValue('confirmation_phrase').trim();

    if (enteredPhrase !== confirmPhrase) {
      await modalInteraction.reply({
        content: `Purge cancelled - confirmation phrase did not match.\n\nYou entered: \`${enteredPhrase}\`\nExpected: \`${confirmPhrase}\``,
        ephemeral: true,
      });
      await interaction.editReply({
        content: 'Purge cancelled - confirmation phrase did not match.',
        embeds: [],
        components: [],
      });
      return;
    }

    // User confirmed correctly - perform purge
    await modalInteraction.deferUpdate();

    const purgeResult = await callGatewayApi<PurgeResponse>('/user/memory/purge', {
      userId,
      method: 'POST',
      body: {
        personalityId,
        confirmationPhrase: enteredPhrase,
      },
    });

    if (!purgeResult.ok) {
      await modalInteraction.editReply({
        content: `Failed to purge memories: ${purgeResult.error ?? 'Unknown error'}`,
        embeds: [],
        components: [],
      });
      return;
    }

    const result = purgeResult.data;

    // Show success
    let successDescription = `Purged **${result.deletedCount}** memories for **${escapeMarkdown(result.personalityName)}**.`;

    if (result.lockedPreserved > 0) {
      successDescription += `\n\n**${result.lockedPreserved}** locked (core) memories were preserved.`;
    }

    const successEmbed = createSuccessEmbed('Memories Purged', successDescription);

    await modalInteraction.editReply({
      embeds: [successEmbed],
      components: [],
    });

    logger.warn(
      {
        userId,
        personalityId,
        deletedCount: result.deletedCount,
        lockedPreserved: result.lockedPreserved,
      },
      '[Memory] PURGE completed'
    );
  } catch (error) {
    await handleCommandError(interaction, error, { userId, command: 'Memory Purge' });
  }
}
