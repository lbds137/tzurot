/**
 * Model Command Group
 * Override which LLM config a personality uses
 *
 * Commands:
 * - /model list - Show your model overrides
 * - /model set - Override model for a personality
 * - /model reset - Remove override, use default
 */

import { SlashCommandBuilder } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleListOverrides } from './list.js';
import { handleSet } from './set.js';
import { handleReset } from './reset.js';

const logger = createLogger('model-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('model')
  .setDescription('Override which model a personality uses')
  .addSubcommand(subcommand =>
    subcommand.setName('list').setDescription('Show your model overrides')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('set')
      .setDescription('Override model for a personality')
      .addStringOption(option =>
        option
          .setName('personality')
          .setDescription('Personality to override')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option
          .setName('config')
          .setDescription('LLM config to use')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('reset')
      .setDescription('Remove model override, use default')
      .addStringOption(option =>
        option
          .setName('personality')
          .setDescription('Personality to reset')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

/**
 * Command execution router
 */
export const execute = createSubcommandRouter(
  {
    list: handleListOverrides,
    set: handleSet,
    reset: handleReset,
  },
  { logger, logPrefix: '[Model]' }
);
