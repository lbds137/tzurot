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
 * - /me preset list - Show your preset overrides
 * - /me preset set <personality> <preset> - Override preset for a personality
 * - /me preset reset <personality> - Remove preset override
 * - /me preset default <preset> - Set your global default preset
 * - /me preset clear-default - Clear your global default preset
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
// Preset subcommand handlers (user's model/preset preferences)
import { handleListOverrides as handlePresetList } from './preset/list.js';
import { handleSet as handlePresetSet } from './preset/set.js';
import { handleReset as handlePresetReset } from './preset/reset.js';
import { handleDefault as handlePresetDefault } from './preset/default.js';
import { handleClearDefault as handlePresetClearDefault } from './preset/clear-default.js';
import { handleAutocomplete as handlePresetAutocomplete } from './preset/autocomplete.js';
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
      .setName('preset')
      .setDescription('Choose which preset a personality uses for you')
      .addSubcommand(subcommand =>
        subcommand.setName('list').setDescription('Show your preset overrides')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('set')
          .setDescription('Override preset for a personality')
          .addStringOption(option =>
            option
              .setName('personality')
              .setDescription('The personality to override')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(option =>
            option
              .setName('preset')
              .setDescription('The preset to use')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('reset')
          .setDescription('Remove preset override for a personality')
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
          .setName('default')
          .setDescription('Set your global default preset')
          .addStringOption(option =>
            option
              .setName('preset')
              .setDescription('The preset to use as default')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand.setName('clear-default').setDescription('Clear your global default preset')
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
 * Preset subcommand router
 */
const presetRouter = createSubcommandRouter(
  {
    list: handlePresetList,
    set: handlePresetSet,
    reset: handlePresetReset,
    default: handlePresetDefault,
    'clear-default': handlePresetClearDefault,
  },
  { logger, logPrefix: '[Me/Preset]' }
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
  } else if (group === 'preset') {
    await presetRouter(interaction);
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
    // Personality autocomplete (for profile override and preset commands)
    if (subcommandGroup === 'preset') {
      // Preset subcommands use their own personality autocomplete
      await handlePresetAutocomplete(interaction);
    } else {
      // Profile override subcommands use personality autocomplete with visibility icons
      await handleMePersonalityAutocomplete(interaction);
    }
  } else if (focusedOption.name === 'preset') {
    // Preset autocomplete (for preset commands)
    await handlePresetAutocomplete(interaction);
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
