/**
 * History Command
 * Manage conversation history (Short-Term Memory)
 *
 * Commands:
 * - /history clear <character> - Soft reset conversation context
 * - /history undo <character> - Restore cleared context
 * - /history stats <character> - View conversation statistics
 * - /history purge <character> - Permanently delete conversation history
 */

import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { SELECTOR_DESCRIPTION } from '@tzurot/common-types/constants/uxVocabulary';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineCommand } from '../../utils/defineCommand.js';
import { createSubcommandContextRouter } from '../../utils/subcommandContextRouter.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { handleClear } from './clear.js';
import { handleUndo } from './undo.js';
import { handleStats } from './stats.js';
import { handlePurgeHistory, parsePurgeSlugFromFooter } from './purge.js';
import { handlePersonalityAutocomplete, handlePersonaAutocomplete } from './autocomplete.js';
import { DestructiveCustomIds } from '../../utils/customIds.js';
import {
  handleDestructiveCancel,
  handleDestructiveConfirmButton,
  handleDestructiveModalSubmit,
  hardDeleteModalDisplay,
  type DestructiveOperationResult,
} from '../../utils/confirmation/confirmDestructive.js';
import { type UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';

const logger = createLogger('history-command');

// The wire token deliberately differs from the 'purge' subcommand name: it
// replaced the historical 'hard-delete' token at the rename, and namespacing
// it as 'history-purge' keeps destructive operations globally distinct.
const HISTORY_PURGE_OPERATION = 'history-purge';
const PERSONA_OPTION_DESCRIPTION = 'Which persona (defaults to your active persona)';

/**
 * Context-aware subcommand router
 * Routes to handlers that receive DeferredCommandContext
 */
const historyRouter = createSubcommandContextRouter(
  {
    clear: handleClear,
    undo: handleUndo,
    stats: handleStats,
    purge: handlePurgeHistory,
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
 * Build the purge execution callback for modal submission
 */
function buildPurgeOperation(
  userClient: UserClient,
  userId: string,
  personalitySlug: string,
  channelId: string
): () => Promise<DestructiveOperationResult> {
  return async (): Promise<DestructiveOperationResult> => {
    const result = await userClient.hardDeleteHistory({ personalitySlug, channelId });

    if (!result.ok) {
      logger.error(
        { userId, personalitySlug, channelId, error: result.error },
        'History-purge API failed'
      );
      return {
        success: false,
        errorMessage:
          result.status === 404
            ? `Character "${personalitySlug}" not found.`
            : 'Failed to delete history. Please try again.',
      };
    }

    const { deletedCount } = result.data;

    logger.info({ userId, personalitySlug, channelId, deletedCount }, 'History-purge completed');

    return {
      success: true,
      successEmbed: createSuccessEmbed(
        'History Deleted',
        `Permanently deleted **${deletedCount}** message${deletedCount === 1 ? '' : 's'} ` +
          `from your conversation history with **${personalitySlug}** in this channel.`
      ),
    };
  };
}

/**
 * Handle modal submissions for history command
 * Routes destructive confirmation modals
 */
async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId;

  if (DestructiveCustomIds.isDestructive(customId)) {
    const parsed = DestructiveCustomIds.parse(customId);
    if (parsed === null) {
      logger.warn({ customId }, 'Failed to parse destructive modal customId');
      return;
    }

    if (parsed.operation === HISTORY_PURGE_OPERATION && parsed.action === 'modal_submit') {
      // channelId rides the customId; the slug rides the warning embed's
      // footer (too long for the customId budget — see handlePurgeHistory).
      const channelId = parsed.entityId;
      const personalitySlug = parsePurgeSlugFromFooter(
        interaction.message?.embeds[0]?.footer?.text
      );

      if (channelId === undefined || personalitySlug === null) {
        await interaction.reply({
          content: 'Error: Invalid entity ID format.',
          ephemeral: true,
        });
        return;
      }
      const { userClient } = clientsFor(interaction);
      const executeOperation = buildPurgeOperation(
        userClient,
        interaction.user.id,
        personalitySlug,
        channelId
      );
      // Expected phrase derives from the same helper the warning/modal used,
      // so display and validation can't drift.
      const { confirmationPhrase } = hardDeleteModalDisplay(personalitySlug);
      await handleDestructiveModalSubmit(interaction, confirmationPhrase, executeOperation, {
        progressContent: 'Deleting history…',
      });
      return;
    }
  }

  logger.warn({ customId }, 'Unknown modal customId');
}

/**
 * Autocomplete handler for personality and profile options
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'character') {
    await handlePersonalityAutocomplete(interaction);
  } else if (focusedOption.name === 'persona') {
    await handlePersonaAutocomplete(interaction);
  } else {
    await interaction.respond([]);
  }
}

/**
 * Handle the confirm button for history-purge operations
 */
async function handlePurgeConfirm(
  interaction: ButtonInteraction,
  channelId: string | undefined
): Promise<void> {
  // The slug lives in the warning embed's footer, not the customId (too long
  // for the 100-char budget); the customId's entityId carries only the channelId.
  const personalitySlug = parsePurgeSlugFromFooter(interaction.message.embeds[0]?.footer?.text);

  if (channelId === undefined || personalitySlug === null) {
    // customId included: when this fires, identity is partial by definition,
    // so the raw customId is the debugging signal (channelId may be undefined).
    logger.warn(
      { channelId, customId: interaction.customId },
      'Purge confirm missing channelId or slug footer'
    );
    await interaction.update({
      content: 'Error: Invalid entity ID format.',
      embeds: [],
      components: [],
    });
    return;
  }

  // Display-only: the modal's routing customId is derived from THIS button's
  // customId inside the factory, so no source/operation is re-stated here.
  await handleDestructiveConfirmButton(interaction, hardDeleteModalDisplay(personalitySlug));
}

/**
 * Handle button interactions for history command
 * Routes destructive confirmation buttons
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  if (DestructiveCustomIds.isDestructive(customId)) {
    const parsed = DestructiveCustomIds.parse(customId);
    if (parsed === null) {
      logger.warn({ customId }, 'Failed to parse destructive customId');
      return;
    }

    if (parsed.operation === HISTORY_PURGE_OPERATION) {
      if (parsed.action === 'cancel_button') {
        await handleDestructiveCancel(interaction, 'History purge cancelled.');
        return;
      }
      if (parsed.action === 'confirm_button') {
        await handlePurgeConfirm(interaction, parsed.entityId);
        return;
      }
    }
  }

  logger.warn({ customId }, 'Unknown button customId');
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
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('persona')
            .setDescription(PERSONA_OPTION_DESCRIPTION)
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
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('persona')
            .setDescription(PERSONA_OPTION_DESCRIPTION)
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
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('persona')
            .setDescription(PERSONA_OPTION_DESCRIPTION)
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        // Literal string (the wire token HISTORY_PURGE_OPERATION is a
        // different, namespaced value) — also required because the
        // generate:command-types parser's static analysis only tracks
        // `setName('literal')` calls, not variable references.
        .setName('purge')
        .setDescription('PERMANENTLY delete conversation history (cannot be undone!)')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),
  execute,
  autocomplete,
  handleModal,
  handleButton,
});
