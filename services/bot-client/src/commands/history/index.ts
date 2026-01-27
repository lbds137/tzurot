/**
 * History Command
 * Manage conversation history (Short-Term Memory)
 *
 * Commands:
 * - /history clear <personality> - Soft reset conversation context
 * - /history undo <personality> - Restore cleared context
 * - /history stats <personality> - View conversation statistics
 * - /history hard-delete <personality> - Permanently delete conversation history
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import { createSubcommandContextRouter } from '../../utils/subcommandContextRouter.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { handleClear } from './clear.js';
import { handleUndo } from './undo.js';
import { handleStats } from './stats.js';
import { handleHardDelete, parseHardDeleteEntityId } from './hard-delete.js';
import { handlePersonalityAutocomplete, handlePersonaAutocomplete } from './autocomplete.js';
import { DestructiveCustomIds } from '../../utils/customIds.js';
import {
  handleDestructiveCancel,
  handleDestructiveConfirmButton,
  handleDestructiveModalSubmit,
  createHardDeleteConfig,
  type DestructiveOperationResult,
} from '../../utils/destructiveConfirmation.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';

const logger = createLogger('history-command');

/**
 * Context-aware subcommand router
 * Routes to handlers that receive DeferredCommandContext
 */
const historyRouter = createSubcommandContextRouter(
  {
    clear: handleClear,
    undo: handleUndo,
    stats: handleStats,
    'hard-delete': handleHardDelete,
  },
  { logger, logPrefix: '[History]' }
);

/**
 * Command execution router
 * Receives SafeCommandContext and routes to appropriate handler
 */
async function execute(ctx: SafeCommandContext): Promise<void> {
  const context = ctx as DeferredCommandContext;
  await historyRouter(context);
}

/**
 * Handle modal submissions for history command
 * Routes destructive confirmation modals
 */
async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId;

  // Check if this is a destructive confirmation modal
  if (DestructiveCustomIds.isDestructive(customId)) {
    const parsed = DestructiveCustomIds.parse(customId);
    if (parsed === null) {
      logger.warn({ customId }, '[History] Failed to parse destructive modal customId');
      return;
    }

    // Handle hard-delete modal submission
    if (parsed.operation === 'hard-delete' && parsed.action === 'modal_submit') {
      const entityInfo =
        parsed.entityId !== undefined ? parseHardDeleteEntityId(parsed.entityId) : null;

      if (entityInfo === null) {
        await interaction.reply({
          content: 'Error: Invalid entity ID format.',
          ephemeral: true,
        });
        return;
      }

      const { personalitySlug, channelId } = entityInfo;
      const userId = interaction.user.id;

      // Execute the hard-delete operation
      const executeOperation = async (): Promise<DestructiveOperationResult> => {
        interface HardDeleteResponse {
          success: boolean;
          deletedCount: number;
          message: string;
        }

        const result = await callGatewayApi<HardDeleteResponse>('/user/history/hard-delete', {
          userId,
          method: 'DELETE',
          body: { personalitySlug, channelId },
        });

        if (!result.ok) {
          logger.error(
            { userId, personalitySlug, channelId, error: result.error },
            '[History] Hard-delete API failed'
          );
          return {
            success: false,
            errorMessage:
              result.status === 404
                ? `Personality "${personalitySlug}" not found.`
                : 'Failed to delete history. Please try again.',
          };
        }

        const { deletedCount } = result.data;

        logger.info(
          { userId, personalitySlug, channelId, deletedCount },
          '[History] Hard-delete completed'
        );

        return {
          success: true,
          successEmbed: createSuccessEmbed(
            'History Deleted',
            `Permanently deleted **${deletedCount}** message${deletedCount === 1 ? '' : 's'} ` +
              `from your conversation history with **${personalitySlug}** in this channel.`
          ),
        };
      };

      await handleDestructiveModalSubmit(interaction, 'DELETE', executeOperation);
      return;
    }
  }

  logger.warn({ customId }, '[History] Unknown modal customId');
}

/**
 * Autocomplete handler for personality and profile options
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'personality') {
    await handlePersonalityAutocomplete(interaction);
  } else if (focusedOption.name === 'persona') {
    await handlePersonaAutocomplete(interaction);
  } else {
    await interaction.respond([]);
  }
}

/**
 * Handle button interactions for history command
 * Routes destructive confirmation buttons
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  // Check if this is a destructive confirmation button
  if (DestructiveCustomIds.isDestructive(customId)) {
    const parsed = DestructiveCustomIds.parse(customId);
    if (parsed === null) {
      logger.warn({ customId }, '[History] Failed to parse destructive customId');
      return;
    }

    // Handle hard-delete operation
    if (parsed.operation === 'hard-delete') {
      if (parsed.action === 'cancel_button') {
        await handleDestructiveCancel(interaction, 'Hard-delete cancelled.');
        return;
      }

      if (parsed.action === 'confirm_button') {
        // Parse the entityId to get personalitySlug and channelId
        const entityInfo =
          parsed.entityId !== undefined ? parseHardDeleteEntityId(parsed.entityId) : null;

        if (entityInfo === null) {
          logger.warn({ entityId: parsed.entityId }, '[History] Failed to parse entityId');
          await interaction.update({
            content: 'Error: Invalid entity ID format.',
            embeds: [],
            components: [],
          });
          return;
        }

        // Recreate the config for the modal
        const config = createHardDeleteConfig({
          entityType: 'conversation history',
          entityName: entityInfo.personalitySlug,
          additionalWarning: '**This action is PERMANENT and cannot be undone!**',
          source: 'history',
          operation: 'hard-delete',
          entityId: parsed.entityId,
        });

        await handleDestructiveConfirmButton(interaction, config);
        return;
      }
    }
  }

  logger.warn({ customId }, '[History] Unknown button customId');
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 *
 * Uses deferralMode: 'ephemeral' - handlers receive DeferredCommandContext
 * with no deferReply() method (already deferred by framework)
 */
export default defineCommand({
  deferralMode: 'ephemeral',
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Manage your conversation history')
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Clear conversation context (soft reset)')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to clear history for')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('persona')
            .setDescription('The persona to use (defaults to your active persona)')
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('undo')
        .setDescription('Restore previously cleared context')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to restore history for')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('persona')
            .setDescription('The persona to use (defaults to your active persona)')
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('stats')
        .setDescription('View conversation statistics')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to view stats for')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('persona')
            .setDescription('The persona to use (defaults to your active persona)')
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('hard-delete')
        .setDescription('PERMANENTLY delete conversation history (cannot be undone!)')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to delete history for')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),
  execute,
  autocomplete,
  handleModal,
  handleButton,
});
