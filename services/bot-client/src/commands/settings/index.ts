/**
 * Settings Command Group
 *
 * Consolidates user settings in one place:
 *
 * - /settings timezone get|set - Manage timezone
 * - /settings apikey set|browse|remove|test - Manage API keys (BYOK)
 * - /settings defaults edit - Manage global default settings (config cascade)
 *
 * HISTORY:
 * - Consolidated from former /me timezone, /wallet, and /me preset commands
 * - Preset overrides moved to /preset override (Phase 3 rename batch)
 */

import { SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import { DISCORD_LIMITS, DISCORD_PROVIDER_CHOICES } from '@tzurot/common-types/constants/discord';
import { TIMEZONE_OPTIONS } from '@tzurot/common-types/constants/timezone';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineCommand } from '../../utils/defineCommand.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { createComponentRouter } from '../../utils/componentRouter.js';
import { createTypedSubcommandRouter } from '../../utils/subcommandRouter.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';
import { replyValidationError } from '../../utils/confirmation/confirmDestructive.js';

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

// Data-rights handlers (account export + deletion)
import { handleDataExport } from './data/export.js';
import {
  handleDataDelete,
  handleDataDeleteButton,
  handleDataDeleteModal,
  SETTINGS_ACCOUNT_DELETE_OPERATION,
} from './data/delete.js';

/** Account-delete destructive customIds (settings::destructive::...::account-delete...). */
function isAccountDeleteInteraction(customId: string): boolean {
  return DestructiveCustomIds.parse(customId)?.operation === SETTINGS_ACCOUNT_DELETE_OPERATION;
}

// Defaults handlers (user-default config cascade settings)
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
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
 * Data-rights subcommand group router (all deferred)
 */
const dataRouter = createTypedSubcommandRouter(
  {
    export: handleDataExport,
    delete: handleDataDelete,
  },
  { logger, logPrefix: '[Settings/Data]' }
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
  } else if (group === 'data') {
    await dataRouter(context as DeferredCommandContext);
  } else if (group === 'defaults') {
    await handleDefaultsEdit(context as DeferredCommandContext);
  } else {
    logger.warn({ group }, 'Unknown subcommand group');
    await (context as DeferredCommandContext).editReply({
      content: renderSpec(CATALOG.error.validation('Unknown settings group.')),
    });
  }
}

/**
 * Component dispatch (apikey modal, defaults dashboard, account-delete
 * confirmation). The unrouted fallback ACKS: an unacknowledged modal submit
 * surfaces as Discord's "This interaction failed", and a silent warn leaves
 * buttons dead-ended with no feedback.
 */
const settingsComponentRouter = createComponentRouter({
  routes: [
    { matches: ApikeyCustomIds.isApikey, onModal: handleApikeyModalSubmit },
    {
      matches: isUserDefaultsInteraction,
      onButton: handleUserDefaultsButton,
      onSelect: handleUserDefaultsSelectMenu,
      onModal: handleUserDefaultsModal,
    },
    {
      matches: isAccountDeleteInteraction,
      onButton: handleDataDeleteButton,
      onModal: handleDataDeleteModal,
    },
  ],
  unrouted: async (interaction, kind) => {
    logger.warn({ customId: interaction.customId, kind }, 'Unrouted settings interaction');
    await replyValidationError(
      interaction,
      kind === 'modal' ? 'Unknown modal submission.' : 'Unknown interaction.'
    );
  },
});

/**
 * Autocomplete handler for timezone options
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

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
    // Defaults subcommand group (user-default config cascade settings)
    .addSubcommandGroup(group =>
      group
        .setName('defaults')
        .setDescription('Manage your global default settings')
        .addSubcommand(subcommand =>
          subcommand.setName('edit').setDescription('Open your default settings dashboard')
        )
    )
    // Data-rights subcommand group (account export + deletion)
    .addSubcommandGroup(group =>
      group
        .setName('data')
        .setDescription('Your data: export everything, or delete your account')
        .addSubcommand(subcommand =>
          subcommand
            .setName('export')
            .setDescription('Export all your account data as a downloadable file')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('delete')
            .setDescription('Permanently delete your account and ALL your data')
        )
    ),
  execute,
  autocomplete,
  handleModal: settingsComponentRouter.handleModal,
  handleButton: settingsComponentRouter.handleButton,
  handleSelectMenu: settingsComponentRouter.handleSelectMenu,
  componentPrefixes: ['user-defaults-settings'],
});
