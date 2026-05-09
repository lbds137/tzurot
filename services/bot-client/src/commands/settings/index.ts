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
import { ApikeyCustomIds } from '../../utils/customIds.js';

// Preset handlers
import { handleBrowseOverrides } from './preset/browse.js';
import { handleSet as handlePresetSet } from './preset/set.js';
import { handleReset as handlePresetReset } from './preset/reset.js';
import { handleDefault as handlePresetDefault } from './preset/default.js';
import { handleClearDefault as handlePresetClearDefault } from './preset/clear-default.js';
import { handleAutocomplete as handlePresetAutocomplete } from './preset/autocomplete.js';
// Deprecation-stub helper for /settings tts and /settings voices subcommands.
// Real handlers moved to /voice; the legacy schema is retained so users
// running old paths see an explanatory ephemeral redirect.
import { tryRedirectToVoice } from '../voice/redirectToVoiceCommand.js';

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
 * Deprecation stub dispatcher for /settings tts and /settings voices.
 *
 * Both subcommand groups remain registered so users typing the old paths
 * resolve to a real handler — but the handler now just redirects them to
 * the equivalent /voice path. Stub-removal scheduling tracked in backlog/inbox.md.
 */
async function dispatchVoiceMigrationStub(
  context: DeferredCommandContext,
  group: 'tts' | 'voices'
): Promise<void> {
  const subcommand = context.getSubcommand();
  if (subcommand === null) {
    await context.editReply({ content: '❌ No subcommand specified' });
    return;
  }

  const handled = await tryRedirectToVoice(context, group, subcommand);
  if (!handled) {
    logger.warn({ group, subcommand }, 'Unknown legacy /settings subcommand');
    await context.editReply({ content: '❌ Unknown subcommand' });
  }
}

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
  } else if (group === 'tts') {
    await dispatchVoiceMigrationStub(context as DeferredCommandContext, 'tts');
  } else if (group === 'defaults') {
    await handleDefaultsEdit(context as DeferredCommandContext);
  } else if (group === 'voices') {
    await dispatchVoiceMigrationStub(context as DeferredCommandContext, 'voices');
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
  } else {
    // /settings tts and /settings voices autocomplete is no-op while the
    // legacy schema is preserved for the deprecation stubs — autocomplete
    // values are irrelevant since the user just gets the redirect message.
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
    // DEPRECATION STUB: legacy /settings tts schema preserved (real handlers
    // moved to /voice tts). Subcommand names retain the original vocabulary
    // (set/reset/default/clear-default/browse) so users typing the old
    // commands still resolve to a registered handler — which then ephemerally
    // redirects them to the new /voice tts path. Scheduled removal tracked
    // in backlog/inbox.md.
    .addSubcommandGroup(group =>
      group
        .setName('tts')
        .setDescription('[Moved to /voice tts] Manage TTS configuration overrides')
        .addSubcommand(subcommand =>
          subcommand.setName('browse').setDescription('[Moved to /voice tts browse]')
        )
        .addSubcommand(subcommand =>
          subcommand.setName('set').setDescription('[Moved to /voice tts set]')
        )
        .addSubcommand(subcommand =>
          subcommand.setName('reset').setDescription('[Moved to /voice tts clear]')
        )
        .addSubcommand(subcommand =>
          subcommand.setName('default').setDescription('[Moved to /voice tts set-default]')
        )
        .addSubcommand(subcommand =>
          subcommand.setName('clear-default').setDescription('[Moved to /voice tts clear-default]')
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
    // DEPRECATION STUB: legacy /settings voices schema preserved (real
    // handlers moved to /voice voices). Same redirect-stub pattern as tts.
    .addSubcommandGroup(group =>
      group
        .setName('voices')
        .setDescription('[Moved to /voice voices] Manage your cloned voices')
        .addSubcommand(subcommand =>
          subcommand.setName('browse').setDescription('[Moved to /voice voices browse]')
        )
        .addSubcommand(subcommand =>
          subcommand.setName('delete').setDescription('[Moved to /voice voices delete]')
        )
        .addSubcommand(subcommand =>
          subcommand.setName('clear').setDescription('[Moved to /voice voices clear]')
        )
    ),
  execute,
  autocomplete,
  handleModal,
  handleButton,
  handleSelectMenu,
  // settings-voices prefix moved to /voice (cloned-voice lifecycle now under
  // /voice voices). Pre-deploy in-flight pagination created by the legacy
  // /settings voices browse command will route to /voice's handleButton via
  // the prefix transfer. The prefix itself can be renamed once the legacy
  // entry point is removed; both are tracked in backlog/inbox.md.
  componentPrefixes: ['user-defaults-settings'],
});
