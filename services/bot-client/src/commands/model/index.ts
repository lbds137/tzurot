/**
 * Model Command Group
 * Override which LLM config a personality uses
 *
 * Commands:
 * - /model list - Show your model overrides
 * - /model set - Override model for a personality
 * - /model reset - Remove override, use default
 * - /model set-default - Set your global default config
 * - /model clear-default - Clear your global default config
 */

import { SlashCommandBuilder } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleListOverrides } from './list.js';
import { handleSet } from './set.js';
import { handleReset } from './reset.js';
import { handleSetDefault } from './set-default.js';
import { handleClearDefault } from './clear-default.js';
import { handleAutocomplete } from './autocomplete.js';

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
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('set-default')
      .setDescription('Set your global default LLM config (applies to all personalities)')
      .addStringOption(option =>
        option
          .setName('config')
          .setDescription('LLM config to use as default')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand.setName('clear-default').setDescription('Clear your global default LLM config')
  );

/**
 * Command execution router
 */
export const execute = createSubcommandRouter(
  {
    list: handleListOverrides,
    set: handleSet,
    reset: handleReset,
    'set-default': handleSetDefault,
    'clear-default': handleClearDefault,
  },
  { logger, logPrefix: '[Model]' }
);

/**
 * Autocomplete handler for personality and config options
 */
export const autocomplete = handleAutocomplete;
