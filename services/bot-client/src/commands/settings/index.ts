/**
 * Settings Command Group
 * User settings and preferences
 *
 * Commands:
 * - /settings timezone set <timezone> - Set your timezone
 * - /settings timezone get - Show your current timezone
 *
 * Future expansions:
 * - /settings usage - View your usage statistics
 * - /settings notifications - Configure notification preferences
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, TIMEZONE_DISCORD_CHOICES } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleTimezoneSet, handleTimezoneGet } from './timezone.js';

const logger = createLogger('settings-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('Manage your personal settings')
  .addSubcommandGroup(group =>
    group
      .setName('timezone')
      .setDescription('Manage your timezone')
      .addSubcommand(subcommand =>
        subcommand
          .setName('set')
          .setDescription('Set your timezone')
          .addStringOption(option =>
            option
              .setName('timezone')
              .setDescription('Your timezone')
              .setRequired(true)
              .addChoices(...TIMEZONE_DISCORD_CHOICES)
          )
      )
      .addSubcommand(subcommand =>
        subcommand.setName('get').setDescription('Show your current timezone')
      )
  );

/**
 * Route timezone subcommands
 */
const timezoneRouter = createSubcommandRouter(
  {
    set: handleTimezoneSet,
    get: handleTimezoneGet,
  },
  { logger, logPrefix: '[Settings/Timezone]' }
);

/**
 * Command execution router
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const group = interaction.options.getSubcommandGroup();

  switch (group) {
    case 'timezone':
      await timezoneRouter(interaction);
      break;
    default:
      // Future subcommand groups will be added here
      logger.warn({ group }, '[Settings] Unknown subcommand group');
      break;
  }
}
