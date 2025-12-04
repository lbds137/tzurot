/**
 * Profile Command Group
 * Manages user profiles (personas) for AI interactions
 *
 * Commands:
 * - /profile view - View your current profile
 * - /profile edit [profile] - Edit a profile via modal (default: your default profile)
 * - /profile create - Create a new profile
 * - /profile list - List all your profiles
 * - /profile default <profile> - Set a profile as your default
 * - /profile settings share-ltm <enable|disable> - Toggle LTM sharing across personalities
 * - /profile override set <personality> <profile> - Override profile for specific personality
 * - /profile override clear <personality> - Clear profile override for personality
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

const logger = createLogger('profile-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Manage your profiles for AI interactions')
  .addSubcommand(subcommand =>
    subcommand.setName('view').setDescription('View your current profile')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('edit')
      .setDescription('Edit a profile (default: your default profile)')
      .addStringOption(option =>
        option
          .setName('profile')
          .setDescription('Which profile to edit (optional, defaults to your default)')
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand => subcommand.setName('create').setDescription('Create a new profile'))
  .addSubcommand(subcommand => subcommand.setName('list').setDescription('List all your profiles'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('default')
      .setDescription('Set a profile as your default')
      .addStringOption(option =>
        option
          .setName('profile')
          .setDescription('The profile to set as default')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommandGroup(group =>
    group
      .setName('settings')
      .setDescription('Manage profile settings')
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
      .setDescription('Set profile overrides for specific personalities')
      .addSubcommand(subcommand =>
        subcommand
          .setName('set')
          .setDescription('Set a different profile for a specific personality')
          .addStringOption(option =>
            option
              .setName('personality')
              .setDescription('The personality to override')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(option =>
            option
              .setName('profile')
              .setDescription('The profile to use (or create new)')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('clear')
          .setDescription('Clear profile override for a specific personality')
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
  { logger, logPrefix: '[Profile]' }
);

/**
 * Settings subcommand router
 */
const settingsRouter = createSubcommandRouter(
  {
    'share-ltm': handleShareLtmSetting,
  },
  { logger, logPrefix: '[Profile/Settings]' }
);

/**
 * Override subcommand router
 */
const overrideRouter = createSubcommandRouter(
  {
    set: handleOverrideSet,
    clear: handleOverrideClear,
  },
  { logger, logPrefix: '[Profile/Override]' }
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

    if (customId === 'profile-create') {
      // Create new profile modal
      await handleCreateModalSubmit(interaction);
    } else if (customId.startsWith('profile-edit-')) {
      // Edit profile modal: profile-edit-{personaId} or profile-edit-new
      const personaId = customId.replace('profile-edit-', '');
      await handleEditModalSubmit(interaction, personaId);
    } else if (customId.startsWith('profile-override-create-')) {
      // Create profile for override: profile-override-create-{personalityId}
      const personalityId = customId.replace('profile-override-create-', '');
      await handleOverrideCreateModalSubmit(interaction, personalityId);
    } else {
      logger.warn({ customId }, '[Profile] Unknown modal customId');
    }
    return;
  }

  const group = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (group === null) {
    // Top-level subcommands
    if (subcommand === 'edit') {
      // Edit needs special handling to pass profile ID
      const personaId = interaction.options.getString('profile');
      await handleEditPersona(interaction, personaId);
    } else if (subcommand === 'default') {
      // Default needs the profile ID
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
    logger.warn({ group }, '[Profile] Unknown subcommand group');
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
  } else if (focusedOption.name === 'profile') {
    // Profile autocomplete
    // Include "Create new" option only for override set
    const includeCreateNew = subcommandGroup === 'override' && subcommand === 'set';
    await handlePersonaAutocomplete(interaction, includeCreateNew);
  } else {
    await interaction.respond([]);
  }
}
