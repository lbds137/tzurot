/**
 * Wallet Command Group
 * Manages user API keys (BYOK - Bring Your Own Key)
 *
 * Commands:
 * - /wallet set <provider> - Set API key via secure modal
 * - /wallet list - List configured providers
 * - /wallet remove <provider> - Remove an API key
 * - /wallet test <provider> - Test API key validity
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ModalSubmitInteraction } from 'discord.js';
import { createLogger, DISCORD_PROVIDER_CHOICES } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';
import { handleSetKey } from './set.js';
import { handleListKeys } from './list.js';
import { handleRemoveKey } from './remove.js';
import { handleTestKey } from './test.js';
import { handleWalletModalSubmit } from './modal.js';

const logger = createLogger('wallet-command');

/**
 * Mixed-mode subcommand router for wallet commands
 *
 * - 'set' shows a modal (receives ModalCommandContext)
 * - 'list', 'remove', 'test' are deferred (receive DeferredCommandContext)
 */
const walletRouter = createMixedModeSubcommandRouter(
  {
    deferred: {
      list: handleListKeys,
      remove: handleRemoveKey,
      test: handleTestKey,
    },
    modal: {
      set: handleSetKey,
    },
  },
  { logger, logPrefix: '[Wallet]' }
);

/**
 * Command execution router
 */
async function execute(context: SafeCommandContext): Promise<void> {
  await walletRouter(context);
}

/**
 * Modal submit handler for wallet key input
 */
async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  await handleWalletModalSubmit(interaction);
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 *
 * Uses mixed deferral modes:
 * - Most subcommands use ephemeral deferral (list, remove, test)
 * - 'set' shows a modal (no deferral)
 */
export default defineCommand({
  deferralMode: 'ephemeral', // Default for most subcommands
  subcommandDeferralModes: {
    set: 'modal', // /wallet set shows a modal
  },
  data: new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Manage your API keys (BYOK - Bring Your Own Key)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set your API key for a provider')
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('AI provider to configure')
            .setRequired(true)
            .addChoices(...DISCORD_PROVIDER_CHOICES)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('List your configured API key providers')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove your API key for a provider')
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('AI provider to remove')
            .setRequired(true)
            .addChoices(...DISCORD_PROVIDER_CHOICES)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('test')
        .setDescription('Test your API key validity')
        .addStringOption(option =>
          option
            .setName('provider')
            .setDescription('AI provider to test')
            .setRequired(true)
            .addChoices(...DISCORD_PROVIDER_CHOICES)
        )
    ),
  execute,
  handleModal,
});
