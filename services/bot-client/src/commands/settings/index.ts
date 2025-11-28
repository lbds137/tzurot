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
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { createLogger, DISCORD_LIMITS, TIMEZONE_OPTIONS } from '@tzurot/common-types';
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
              .setDescription('Your timezone (e.g., America/New_York)')
              .setRequired(true)
              .setAutocomplete(true)
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

/**
 * Autocomplete handler for timezone option
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'timezone') {
    const query = focusedOption.value.toLowerCase();

    // Filter timezones by query
    const filtered = TIMEZONE_OPTIONS.filter(
      tz =>
        tz.value.toLowerCase().includes(query) ||
        tz.label.toLowerCase().includes(query) ||
        tz.offset.toLowerCase().includes(query)
    ).slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    const choices = filtered.map(tz => ({
      name: `${tz.label} (${tz.value}) - ${tz.offset}`,
      value: tz.value,
    }));

    await interaction.respond(choices);
  } else {
    await interaction.respond([]);
  }
}
