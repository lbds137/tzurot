/**
 * Me Command Group
 * Manage your personal settings and profile for AI interactions
 *
 * Commands:
 * - /me profile view - View your current profile
 * - /me profile edit [profile] - Edit a profile via modal (default: your default profile)
 * - /me profile create - Create a new profile
 * - /me profile list - List all your profiles
 * - /me profile default <profile> - Set a profile as your default
 * - /me profile share-ltm <enable|disable> - Toggle LTM sharing across personalities
 * - /me profile override-set <personality> <profile> - Override profile for specific personality
 * - /me profile override-clear <personality> - Clear profile override for personality
 * - /me timezone set <timezone> - Set your timezone
 * - /me timezone get - Show your current timezone
 * - /me model list - Show your model overrides
 * - /me model set <personality> <config> - Override model for a personality
 * - /me model reset <personality> - Remove model override
 * - /me model set-default <config> - Set your global default config
 * - /me model clear-default - Clear your global default config
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
} from 'discord.js';
import { createLogger, DISCORD_LIMITS, TIMEZONE_OPTIONS } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
// Profile subcommand handlers
import { handleViewPersona, handleExpandContent } from './profile/view.js';
import { handleEditPersona, handleEditModalSubmit } from './profile/edit.js';
import { handleCreatePersona, handleCreateModalSubmit } from './profile/create.js';
import { handleListPersonas } from './profile/list.js';
import { handleSetDefaultPersona } from './profile/default.js';
import { handleShareLtmSetting } from './profile/share-ltm.js';
import { handleOverrideSet, handleOverrideCreateModalSubmit } from './profile/override-set.js';
import { handleOverrideClear } from './profile/override-clear.js';
// Timezone subcommand handlers
import { handleTimezoneSet } from './timezone/set.js';
import { handleTimezoneGet } from './timezone/get.js';
// Autocomplete handlers
import { handleMePersonalityAutocomplete, handlePersonaAutocomplete } from './autocomplete.js';
// Model subcommand handlers
import { handleListOverrides as handleModelList } from './model/list.js';
import { handleSet as handleModelSet } from './model/set.js';
import { handleReset as handleModelReset } from './model/reset.js';
import { handleSetDefault as handleModelSetDefault } from './model/set-default.js';
import { handleClearDefault as handleModelClearDefault } from './model/clear-default.js';
import { handleAutocomplete as handleModelAutocomplete } from './model/autocomplete.js';
import { MeCustomIds } from '../../utils/customIds.js';

const logger = createLogger('me-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('me')
  .setDescription('Manage your personal settings and profile')
  .addSubcommandGroup(group =>
    group
      .setName('profile')
      .setDescription('Manage your profiles')
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
      .addSubcommand(subcommand =>
        subcommand.setName('create').setDescription('Create a new profile')
      )
      .addSubcommand(subcommand =>
        subcommand.setName('list').setDescription('List all your profiles')
      )
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
      .addSubcommand(subcommand =>
        subcommand
          .setName('override-set')
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
          .setName('override-clear')
          .setDescription('Clear profile override for a specific personality')
          .addStringOption(option =>
            option
              .setName('personality')
              .setDescription('The personality to clear override for')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
  )
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
  )
  .addSubcommandGroup(group =>
    group
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
              .setDescription('The personality to override')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(option =>
            option
              .setName('config')
              .setDescription('The LLM config to use')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('reset')
          .setDescription('Remove model override for a personality')
          .addStringOption(option =>
            option
              .setName('personality')
              .setDescription('The personality to reset')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('set-default')
          .setDescription('Set your global default LLM config')
          .addStringOption(option =>
            option
              .setName('config')
              .setDescription('The LLM config to use as default')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand.setName('clear-default').setDescription('Clear your global default LLM config')
      )
  );

/**
 * Profile subcommand router
 * Handles: view, create, list, share-ltm, override-set, override-clear
 * (edit, default handled separately due to parameter passing)
 */
const profileRouter = createSubcommandRouter(
  {
    view: handleViewPersona,
    create: handleCreatePersona,
    list: handleListPersonas,
    'share-ltm': handleShareLtmSetting,
    'override-set': handleOverrideSet,
    'override-clear': handleOverrideClear,
  },
  { logger, logPrefix: '[Me/Profile]' }
);

/**
 * Timezone subcommand router
 */
const timezoneRouter = createSubcommandRouter(
  {
    set: handleTimezoneSet,
    get: handleTimezoneGet,
  },
  { logger, logPrefix: '[Me/Timezone]' }
);

/**
 * Model subcommand router
 */
const modelRouter = createSubcommandRouter(
  {
    list: handleModelList,
    set: handleModelSet,
    reset: handleModelReset,
    'set-default': handleModelSetDefault,
    'clear-default': handleModelClearDefault,
  },
  { logger, logPrefix: '[Me/Model]' }
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

    // Parse using centralized customId utilities
    const parsed = MeCustomIds.parse(customId);
    if (parsed === null) {
      logger.warn({ customId }, '[Me] Unknown modal customId');
      return;
    }

    if (parsed.group === 'profile') {
      if (parsed.action === 'create') {
        // Create new profile modal
        await handleCreateModalSubmit(interaction);
      } else if (parsed.action === 'edit') {
        // Edit profile modal - entityId is personaId or 'new'
        const personaId = parsed.entityId ?? 'new';
        await handleEditModalSubmit(interaction, personaId);
      } else {
        logger.warn({ customId, parsed }, '[Me] Unknown profile action');
      }
    } else if (parsed.group === 'override') {
      if (parsed.action === 'create' && parsed.entityId !== undefined) {
        // Create profile for override - entityId is personalityId
        await handleOverrideCreateModalSubmit(interaction, parsed.entityId);
      } else {
        logger.warn({ customId, parsed }, '[Me] Unknown override action');
      }
    }
    return;
  }

  const group = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (group === 'profile') {
    // Profile management subcommands
    if (subcommand === 'edit') {
      // Edit needs special handling to pass profile ID
      const personaId = interaction.options.getString('profile');
      await handleEditPersona(interaction, personaId);
    } else if (subcommand === 'default') {
      // Default needs the profile ID
      await handleSetDefaultPersona(interaction);
    } else {
      // view, create, list, share-ltm, override-set, override-clear use profile router
      await profileRouter(interaction);
    }
  } else if (group === 'timezone') {
    await timezoneRouter(interaction);
  } else if (group === 'model') {
    await modelRouter(interaction);
  } else {
    logger.warn({ group }, '[Me] Unknown subcommand group');
  }
}

/**
 * Autocomplete handler for personality, persona, and timezone options
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (focusedOption.name === 'personality') {
    // Personality autocomplete (for profile override and model commands)
    if (subcommandGroup === 'model') {
      // Model subcommands use their own personality autocomplete
      await handleModelAutocomplete(interaction);
    } else {
      // Profile override subcommands use personality autocomplete with visibility icons
      await handleMePersonalityAutocomplete(interaction);
    }
  } else if (focusedOption.name === 'config') {
    // Config autocomplete (for model commands)
    await handleModelAutocomplete(interaction);
  } else if (focusedOption.name === 'profile') {
    // Profile autocomplete
    // Include "Create new" option only for override-set (not for other profile commands)
    const includeCreateNew = subcommandGroup === 'profile' && subcommand === 'override-set';
    await handlePersonaAutocomplete(interaction, includeCreateNew);
  } else if (focusedOption.name === 'timezone') {
    // Timezone autocomplete
    const query = focusedOption.value.toLowerCase();

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

/**
 * Handle button interactions for the me command
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const parsed = MeCustomIds.parse(customId);

  if (parsed === null) {
    logger.warn({ customId }, '[Me] Unknown button customId');
    return;
  }

  if (parsed.group === 'view' && parsed.action === 'expand') {
    if (parsed.entityId !== undefined && parsed.field !== undefined) {
      await handleExpandContent(interaction, parsed.entityId, parsed.field);
    } else {
      logger.warn({ customId, parsed }, '[Me] Missing entityId or field for expand action');
    }
  } else {
    logger.warn({ customId, parsed }, '[Me] Unknown button action');
  }
}

/**
 * Category for this command
 */
export const category = 'Me';
