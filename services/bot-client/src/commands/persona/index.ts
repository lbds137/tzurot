/**
 * Persona Command Group
 * Manages user personas for AI interactions
 *
 * Commands:
 * - /persona view - View your current persona
 * - /persona edit [persona] - Edit a persona via modal (default: your default persona)
 * - /persona create - Create a new persona
 * - /persona list - List all your personas
 * - /persona default <persona> - Set a persona as your default
 * - /persona settings share-ltm <enable|disable> - Toggle LTM sharing across personalities
 * - /persona override set <personality> <persona> - Override persona for specific personality
 * - /persona override clear <personality> - Clear persona override for personality
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleViewPersona } from './view.js';
import { handleEditPersona, handleEditModalSubmit } from './edit.js';
import { handleCreatePersona, handleCreateModalSubmit } from './create.js';
import { handleListPersonas } from './list.js';
import { handleSetDefaultPersona } from './default.js';
import { handleShareLtmSetting } from './settings.js';
import {
  handleOverrideSet,
  handleOverrideClear,
  handleOverrideCreateModalSubmit,
} from './override.js';
import { handlePersonalityAutocomplete, handlePersonaAutocomplete } from './autocomplete.js';

const logger = createLogger('persona-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('persona')
  .setDescription('Manage your personas for AI interactions')
  .addSubcommand(subcommand =>
    subcommand.setName('view').setDescription('View your current persona')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('edit')
      .setDescription('Edit a persona (default: your default persona)')
      .addStringOption(option =>
        option
          .setName('persona')
          .setDescription('Which persona to edit (optional, defaults to your default)')
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand => subcommand.setName('create').setDescription('Create a new persona'))
  .addSubcommand(subcommand => subcommand.setName('list').setDescription('List all your personas'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('default')
      .setDescription('Set a persona as your default')
      .addStringOption(option =>
        option
          .setName('persona')
          .setDescription('The persona to set as default')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommandGroup(group =>
    group
      .setName('settings')
      .setDescription('Manage persona settings')
      .addSubcommand(subcommand =>
        subcommand
          .setName('share-ltm')
          .setDescription('Enable/disable sharing memories across all personalities')
          .addStringOption(option =>
            option
              .setName('enabled')
              .setDescription('Enable or disable LTM sharing')
              .setRequired(true)
              .addChoices(
                { name: 'Enable - Share memories with all personalities', value: 'enable' },
                { name: 'Disable - Keep memories per personality (default)', value: 'disable' }
              )
          )
      )
  )
  .addSubcommandGroup(group =>
    group
      .setName('override')
      .setDescription('Set persona overrides for specific personalities')
      .addSubcommand(subcommand =>
        subcommand
          .setName('set')
          .setDescription('Set a different persona for a specific personality')
          .addStringOption(option =>
            option
              .setName('personality')
              .setDescription('The personality to override')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(option =>
            option
              .setName('persona')
              .setDescription('The persona to use (or create new)')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('clear')
          .setDescription('Clear persona override for a specific personality')
          .addStringOption(option =>
            option
              .setName('personality')
              .setDescription('The personality to clear override for')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
  );

/**
 * Top-level subcommand handlers (view, create, list use simple router)
 */
const simpleTopLevelRouter = createSubcommandRouter(
  {
    view: handleViewPersona,
    create: handleCreatePersona,
    list: handleListPersonas,
  },
  { logger, logPrefix: '[Persona]' }
);

/**
 * Settings subcommand router
 */
const settingsRouter = createSubcommandRouter(
  {
    'share-ltm': handleShareLtmSetting,
  },
  { logger, logPrefix: '[Persona/Settings]' }
);

/**
 * Override subcommand router
 */
const overrideRouter = createSubcommandRouter(
  {
    set: handleOverrideSet,
    clear: handleOverrideClear,
  },
  { logger, logPrefix: '[Persona/Override]' }
);

/**
 * Command execution router
 */
export async function execute(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction
): Promise<void> {
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    const customId = interaction.customId;

    if (customId === 'persona-create') {
      // Create new persona modal
      await handleCreateModalSubmit(interaction);
    } else if (customId.startsWith('persona-edit-')) {
      // Edit persona modal: persona-edit-{personaId} or persona-edit-new
      const personaId = customId.replace('persona-edit-', '');
      await handleEditModalSubmit(interaction, personaId);
    } else if (customId.startsWith('persona-override-create-')) {
      // Create persona for override: persona-override-create-{personalityId}
      const personalityId = customId.replace('persona-override-create-', '');
      await handleOverrideCreateModalSubmit(interaction, personalityId);
    } else {
      logger.warn({ customId }, '[Persona] Unknown modal customId');
    }
    return;
  }

  const group = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (group === null) {
    // Top-level subcommands
    if (subcommand === 'edit') {
      // Edit needs special handling to pass persona ID
      const personaId = interaction.options.getString('persona');
      await handleEditPersona(interaction, personaId);
    } else if (subcommand === 'default') {
      // Default needs the persona ID
      await handleSetDefaultPersona(interaction);
    } else {
      // view, create, list use simple router
      await simpleTopLevelRouter(interaction);
    }
  } else if (group === 'settings') {
    await settingsRouter(interaction);
  } else if (group === 'override') {
    await overrideRouter(interaction);
  } else {
    logger.warn({ group }, '[Persona] Unknown subcommand group');
  }
}

/**
 * Autocomplete handler for personality and persona options
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (focusedOption.name === 'personality') {
    // Personality autocomplete (for override commands)
    await handlePersonalityAutocomplete(interaction);
  } else if (focusedOption.name === 'persona') {
    // Persona autocomplete
    // Include "Create new" option only for override set
    const includeCreateNew = subcommandGroup === 'override' && subcommand === 'set';
    await handlePersonaAutocomplete(interaction, includeCreateNew);
  } else {
    await interaction.respond([]);
  }
}
