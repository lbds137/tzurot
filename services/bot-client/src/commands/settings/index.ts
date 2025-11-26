/**
 * Settings Command Group
 * User settings and preferences
 *
 * Commands:
 * - /timezone set <timezone> - Set your timezone
 * - /timezone get - Show your current timezone
 */

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { handleTimezoneSet, handleTimezoneGet, TIMEZONE_CHOICES } from './timezone.js';

const logger = createLogger('settings-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('timezone')
  .setDescription('Manage your timezone settings')
  .addSubcommand(subcommand =>
    subcommand
      .setName('set')
      .setDescription('Set your timezone')
      .addStringOption(option =>
        option
          .setName('timezone')
          .setDescription('Your timezone')
          .setRequired(true)
          .addChoices(...TIMEZONE_CHOICES)
      )
  )
  .addSubcommand(subcommand =>
    subcommand.setName('get').setDescription('Show your current timezone')
  );

/**
 * Command execution router
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  logger.info({ subcommand, userId: interaction.user.id }, '[Timezone] Executing subcommand');

  switch (subcommand) {
    case 'set':
      await handleTimezoneSet(interaction);
      break;
    case 'get':
      await handleTimezoneGet(interaction);
      break;
    default:
      await interaction.reply({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
  }
}
