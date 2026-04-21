/**
 * Settings Command Group
 *
 * Consolidates user settings in one place:
 *
 * - /settings timezone get|set - Manage timezone
 * - /settings apikey set|browse|remove|test - Manage API keys (BYOK)
 * - /settings preset browse|set|reset|default|clear-default - Manage preset overrides
 * - /settings defaults edit - Manage global default settings (config cascade)
 * - /settings voices browse|delete|clear - Manage ElevenLabs cloned voices
 *
 * HISTORY:
 * - Consolidated from former /me timezone, /wallet, and /me preset commands
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  ModalSubmitInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  createLogger,
  DISCORD_LIMITS,
  DISCORD_PROVIDER_CHOICES,
  TIMEZONE_OPTIONS,
} from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { createTypedSubcommandRouter } from '../../utils/subcommandRouter.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';

// Timezone handlers
import { handleTimezoneSet } from './timezone/set.js';
import { handleTimezoneGet } from './timezone/get.js';

// API key handlers (moved from /wallet)
import { handleSetKey } from './apikey/set.js';
import { handleBrowse as handleWalletBrowse } from './apikey/browse.js';
import { handleRemoveKey } from './apikey/remove.js';
import { handleTestKey } from './apikey/test.js';
import { handleApikeyModalSubmit } from './apikey/modal.js';
import { ApikeyCustomIds, DestructiveCustomIds } from '../../utils/customIds.js';

// Preset handlers
import { handleBrowseOverrides } from './preset/browse.js';
import { handleSet as handlePresetSet } from './preset/set.js';
import { handleReset as handlePresetReset } from './preset/reset.js';
import { handleDefault as handlePresetDefault } from './preset/default.js';
import { handleClearDefault as handlePresetClearDefault } from './preset/clear-default.js';
import { handleAutocomplete as handlePresetAutocomplete } from './preset/autocomplete.js';

// Voice management handlers
import {
  handleBrowseVoices,
  handleVoiceBrowsePagination,
  isVoiceBrowseInteraction,
} from './voices/browse.js';
import { handleDeleteVoice, handleVoiceAutocomplete } from './voices/delete.js';
import {
  handleClearVoices,
  handleVoiceClearButton,
  handleVoiceClearModal,
  VOICE_CLEAR_OPERATION,
} from './voices/clear.js';
import { handleModelSet, handleModelAutocomplete } from './voices/model.js';

// Defaults handlers (user-default config cascade settings)
import {
  handleDefaultsEdit,
  handleUserDefaultsButton,
  handleUserDefaultsSelectMenu,
  handleUserDefaultsModal,
  isUserDefaultsInteraction,
} from './defaults/edit.js';

const logger = createLogger('settings-command');

/**
 * Timezone subcommand group router (all deferred)
 */
const timezoneRouter = createTypedSubcommandRouter(
  {
    set: handleTimezoneSet,
    get: handleTimezoneGet,
  },
  { logger, logPrefix: '[Settings/Timezone]' }
);

/**
 * API key subcommand group router (mixed mode)
 */
const apikeyRouter = createMixedModeSubcommandRouter(
  {
    deferred: {
      browse: handleWalletBrowse,
      remove: handleRemoveKey,
      test: handleTestKey,
    },
    modal: {
      set: handleSetKey,
    },
  },
  { logger, logPrefix: '[Settings/ApiKey]' }
);

/**
 * Preset subcommand group router (all deferred)
 */
const presetRouter = createTypedSubcommandRouter(
  {
    browse: handleBrowseOverrides,
    set: handlePresetSet,
    reset: handlePresetReset,
    default: handlePresetDefault,
    'clear-default': handlePresetClearDefault,
  },
  { logger, logPrefix: '[Settings/Preset]' }
);

/**
 * Voices subcommand group router (all deferred)
 */
const voicesRouter = createTypedSubcommandRouter(
  {
    browse: handleBrowseVoices,
    delete: handleDeleteVoice,
    clear: handleClearVoices,
    model: handleModelSet,
  },
  { logger, logPrefix: '[Settings/Voices]' }
);

/**
 * Command execution router
 */
async function execute(context: SafeCommandContext): Promise<void> {
  const group = context.getSubcommandGroup();

  if (group === 'timezone') {
    await timezoneRouter(context as DeferredCommandContext);
  } else if (group === 'apikey') {
    await apikeyRouter(context);
  } else if (group === 'preset') {
    await presetRouter(context as DeferredCommandContext);
  } else if (group === 'defaults') {
    await handleDefaultsEdit(context as DeferredCommandContext);
  } else if (group === 'voices') {
    await voicesRouter(context as DeferredCommandContext);
  } else {
    logger.warn({ group }, 'Unknown subcommand group');
    await (context as DeferredCommandContext).editReply({
      content: '❌ Unknown settings group.',
    });
  }
}

/**
 * Modal submit handler for API key input and user-defaults settings
 */
async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  // Check if this is an apikey modal (settings::apikey::*)
  if (ApikeyCustomIds.isApikey(interaction.customId)) {
    await handleApikeyModalSubmit(interaction);
    return;
  }

  // Check if this is a user-defaults settings modal
  if (isUserDefaultsInteraction(interaction.customId)) {
    await handleUserDefaultsModal(interaction);
    return;
  }

  // Check if this is a voice-clear destructive confirmation modal
  if (DestructiveCustomIds.isDestructive(interaction.customId)) {
    const parsed = DestructiveCustomIds.parse(interaction.customId);
    if (parsed?.operation === VOICE_CLEAR_OPERATION) {
      await handleVoiceClearModal(interaction);
      return;
    }
  }

  logger.warn({ customId: interaction.customId }, 'Unknown modal customId');
}

/**
 * Button interaction handler for user-defaults settings dashboard
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (isUserDefaultsInteraction(interaction.customId)) {
    await handleUserDefaultsButton(interaction);
    return;
  }

  // Voice browse pagination buttons
  if (isVoiceBrowseInteraction(interaction.customId)) {
    await handleVoiceBrowsePagination(interaction);
    return;
  }

  // Voice-clear destructive confirmation buttons
  if (DestructiveCustomIds.isDestructive(interaction.customId)) {
    const parsed = DestructiveCustomIds.parse(interaction.customId);
    if (parsed?.operation === VOICE_CLEAR_OPERATION) {
      await handleVoiceClearButton(interaction);
      return;
    }
  }

  logger.warn({ customId: interaction.customId }, 'Unknown button customId');
}

/**
 * Select menu interaction handler for user-defaults settings dashboard
 */
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (isUserDefaultsInteraction(interaction.customId)) {
    await handleUserDefaultsSelectMenu(interaction);
    return;
  }

  logger.warn({ customId: interaction.customId }, 'Unknown select menu customId');
}

/**
 * Autocomplete handler for timezone, personality, and preset options
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const subcommandGroup = interaction.options.getSubcommandGroup();

  if (focusedOption.name === 'timezone') {
    // Inline timezone autocomplete
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
  } else if (subcommandGroup === 'preset') {
    // Personality and preset autocomplete for preset commands
    // The handlePresetAutocomplete handles both 'personality' and 'preset' options
    await handlePresetAutocomplete(interaction);
  } else if (subcommandGroup === 'voices' && focusedOption.name === 'voice') {
    await handleVoiceAutocomplete(interaction);
  } else if (subcommandGroup === 'voices' && focusedOption.name === 'model') {
    await handleModelAutocomplete(interaction);
  } else {
    await interaction.respond([]);
  }
}

/**
 * Export command definition using defineCommand for type safety
 */
export default defineCommand({
  deferralMode: 'ephemeral', // Default for most subcommands
  subcommandDeferralModes: {
    'apikey set': 'modal', // /settings apikey set shows a modal
  },
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Manage your account settings')
    // Timezone subcommand group
    .addSubcommandGroup(group =>
      group
        .setName('timezone')
        .setDescription('Manage your timezone settings')
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
    // API key subcommand group
    .addSubcommandGroup(group =>
      group
        .setName('apikey')
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
                .addChoices(...DISCORD_PROVIDER_CHOICES)
            )
        )
        .addSubcommand(subcommand =>
          subcommand.setName('browse').setDescription('Browse your configured API keys')
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
                .addChoices(...DISCORD_PROVIDER_CHOICES)
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
                .addChoices(...DISCORD_PROVIDER_CHOICES)
            )
        )
    )
    // Preset subcommand group
    .addSubcommandGroup(group =>
      group
        .setName('preset')
        .setDescription('Manage preset/model overrides')
        .addSubcommand(subcommand =>
          subcommand.setName('browse').setDescription('Browse your preset overrides')
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
    )
    // Defaults subcommand group (user-default config cascade settings)
    .addSubcommandGroup(group =>
      group
        .setName('defaults')
        .setDescription('Manage your global default settings')
        .addSubcommand(subcommand =>
          subcommand.setName('edit').setDescription('Open your default settings dashboard')
        )
    )
    // Voices subcommand group (ElevenLabs cloned voice management)
    .addSubcommandGroup(group =>
      group
        .setName('voices')
        .setDescription('Manage your ElevenLabs cloned voices')
        .addSubcommand(subcommand =>
          subcommand.setName('browse').setDescription('Browse your cloned voices')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('delete')
            .setDescription('Delete a single cloned voice')
            .addStringOption(option =>
              option
                .setName('voice')
                .setDescription('The voice to delete')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand.setName('clear').setDescription('Delete all Tzurot cloned voices')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('model')
            .setDescription('Set your preferred ElevenLabs TTS model')
            .addStringOption(option =>
              option
                .setName('model')
                .setDescription('The TTS model to use')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
    ),
  execute,
  autocomplete,
  handleModal,
  handleButton,
  handleSelectMenu,
  componentPrefixes: ['user-defaults-settings', 'settings-voices'],
});
