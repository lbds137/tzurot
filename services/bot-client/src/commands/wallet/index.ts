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

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, AIProvider } from '@tzurot/common-types';
import { handleSetKey } from './set.js';
import { handleListKeys } from './list.js';
import { handleRemoveKey } from './remove.js';
import { handleTestKey } from './test.js';
import { handleWalletModalSubmit } from './modal.js';

const logger = createLogger('wallet-command');

/**
 * Provider choices for slash command options
 */
const providerChoices = [
  { name: 'OpenRouter (recommended)', value: AIProvider.OpenRouter },
  { name: 'OpenAI', value: AIProvider.OpenAI },
] as const;

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
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
          .addChoices(...providerChoices)
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
          .addChoices(...providerChoices)
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
          .addChoices(...providerChoices)
      )
  );

/**
 * Command execution router
 * Routes to the appropriate subcommand handler or modal handler
 */
export async function execute(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction
): Promise<void> {
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    await handleWalletModalSubmit(interaction);
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  logger.info({ subcommand, userId: interaction.user.id }, '[Wallet] Executing subcommand');

  switch (subcommand) {
    case 'set':
      await handleSetKey(interaction);
      break;
    case 'list':
      await handleListKeys(interaction);
      break;
    case 'remove':
      await handleRemoveKey(interaction);
      break;
    case 'test':
      await handleTestKey(interaction);
      break;
    default:
      await interaction.reply({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
  }
}
