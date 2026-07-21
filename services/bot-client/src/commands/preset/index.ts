/**
 * Preset Command Group
 * Manage user model presets and global presets (owner only)
 *
 * Commands:
 * - /preset browse - Browse presets with search and filtering
 * - /preset create - Create a new preset (toggle global via dashboard)
 * - /preset edit - Edit your preset (opens dashboard, includes delete)
 * - /preset export - Export a preset as JSON file
 * - /preset import - Import a preset from JSON file
 * - /preset template - Download JSON template for import
 * - /preset override browse|set|clear|set-default|clear-default - Per-character
 *   preset overrides + your global default (moved from /settings preset)
 * - /preset global default - Set system default (owner only)
 * - /preset global free-default - Set free tier default (owner only)
 *
 * Note: Global presets are created via /preset create + toggle in dashboard
 * Note: Delete functionality is integrated into the dashboard (Edit command)
 */

import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { CONFIG_SLOT_OPTION_DESCRIPTION } from '@tzurot/common-types/constants/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { handleModalRetry, isModalRetryInteraction } from '../../utils/modal/retry.js';
import { defineCommand } from '../../utils/defineCommand.js';
import { createTypedSubcommandRouter } from '../../utils/subcommandRouter.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';
import type {
  DeferredCommandContext,
  SafeCommandContext,
} from '../../utils/commandContext/types.js';
import { requireBotOwnerContext } from '../../utils/commandContext/factories.js';
import {
  handleBrowse,
  handleBrowsePagination,
  isPresetBrowseInteraction,
  handleBrowseSelect,
  isPresetBrowseSelectInteraction,
} from './browse.js';
import { handleCreate, buildPresetSeedModal } from './create.js';
import { handleEdit } from './edit.js';
import { handleExport } from './export.js';
import { handleImport } from './import.js';
import { handleTemplate } from './template.js';
import { handleAutocomplete } from './autocomplete.js';
import { handleGlobalSetDefault } from './global/set-default.js';
import { handleGlobalSetFreeDefault } from './global/free-default.js';
import {
  handleModalSubmit,
  handleSelectMenu,
  handleButton,
  isPresetDashboardInteraction,
} from './dashboard.js';

// Override handlers (per-character preset overrides — moved from /settings preset)
import {
  handlePresetBrowse as handleOverrideBrowse,
  handlePresetBrowseSelect as handleOverrideBrowseSelect,
  handlePresetBrowseButton as handleOverrideBrowseButton,
  isPresetOverrideInteraction,
  PRESET_OVERRIDE_PREFIX,
} from './override/browse.js';
import { handleSet as handleOverrideSet } from './override/set.js';
import { handleClear as handleOverrideClear } from './override/clear.js';
import { handleSetDefault as handleOverrideSetDefault } from './override/set-default.js';
import { handleClearDefault as handleOverrideClearDefault } from './override/clear-default.js';
import { handleAutocomplete as handleOverrideAutocomplete } from './override/autocomplete.js';

const logger = createLogger('preset-command');

/**
 * Create user preset router with mixed deferral modes
 * - create: modal mode (shows seed modal)
 * - browse/edit/export/import/template: deferred mode (ephemeral response)
 * Note: Delete is now handled via the dashboard
 */
const userRouter = createMixedModeSubcommandRouter(
  {
    modal: { create: handleCreate },
    deferred: {
      browse: handleBrowse,
      edit: handleEdit,
      export: handleExport,
      import: handleImport,
      template: handleTemplate,
    },
  },
  { logger, logPrefix: '[Preset]' }
);

/**
 * Override subcommand group router (all deferred)
 */
const overrideRouter = createTypedSubcommandRouter(
  {
    browse: handleOverrideBrowse,
    set: handleOverrideSet,
    clear: handleOverrideClear,
    'set-default': handleOverrideSetDefault,
    'clear-default': handleOverrideClearDefault,
  },
  { logger, logPrefix: '[Preset/Override]' }
);

/**
 * Create global preset router (owner only)
 */
const globalRouter = createTypedSubcommandRouter(
  {
    default: handleGlobalSetDefault,
    'free-default': handleGlobalSetFreeDefault,
  },
  { logger, logPrefix: '[Preset/Global]' }
);

/**
 * Command execution router
 * Routes to appropriate handler based on subcommand and deferral mode
 */
async function execute(context: SafeCommandContext): Promise<void> {
  const group = context.getSubcommandGroup();

  if (group === 'override') {
    await overrideRouter(context as DeferredCommandContext);
    return;
  }
  if (group === 'global') {
    // Owner-only check for global subcommand group
    const deferredCtx = context as DeferredCommandContext;
    if (!(await requireBotOwnerContext(deferredCtx))) {
      return;
    }
    await globalRouter(deferredCtx);
  } else {
    // User preset commands - router handles modal vs deferred
    await userRouter(context);
  }
}

/**
 * Autocomplete handler for preset options
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  // Route by GROUP before option name: both the override group and the base
  // subcommands focus an option named 'preset', but they suggest different
  // things (assignable configs w/ guest upsell vs your editable presets).
  if (interaction.options.getSubcommandGroup() === 'override') {
    await handleOverrideAutocomplete(interaction);
    return;
  }
  await handleAutocomplete(interaction);
}

/**
 * Select menu interaction handler for preset dashboard and browse
 */
async function selectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // Override-browse select (select an override to clear)
  if (isPresetOverrideInteraction(interaction.customId)) {
    await handleOverrideBrowseSelect(interaction);
    return;
  }

  // Handle browse select - opens dashboard from browse list
  if (isPresetBrowseSelectInteraction(interaction.customId)) {
    await handleBrowseSelect(interaction);
    return;
  }

  // Handle dashboard select - edit sections
  if (isPresetDashboardInteraction(interaction.customId)) {
    await handleSelectMenu(interaction);
  }
}

/**
 * Button interaction handler for preset dashboard and browse pagination
 */
async function button(interaction: ButtonInteraction): Promise<void> {
  // Override-browse confirm/cancel buttons
  if (isPresetOverrideInteraction(interaction.customId)) {
    await handleOverrideBrowseButton(interaction);
    return;
  }

  // Handle browse pagination
  if (isPresetBrowseInteraction(interaction.customId)) {
    await handleBrowsePagination(interaction);
    return;
  }

  // Try-again for a failed create-modal submission (prefilled reopen).
  if (isModalRetryInteraction(interaction.customId, 'preset')) {
    await handleModalRetry(
      interaction,
      (kind, values) => (kind === 'seed' ? buildPresetSeedModal(values) : null),
      '/preset create'
    );
    return;
  }

  // Handle dashboard buttons
  if (!isPresetDashboardInteraction(interaction.customId)) {
    return;
  }
  await handleButton(interaction);
}

/**
 * Modal interaction handler for preset dashboard
 */
async function modal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!isPresetDashboardInteraction(interaction.customId)) {
    return;
  }
  await handleModalSubmit(interaction);
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('preset')
    .setDescription('Manage your model presets')
    .addSubcommand(subcommand =>
      subcommand
        .setName('browse')
        .setDescription('Browse and search model presets')
        .addStringOption(option =>
          option.setName('query').setDescription('Search by name or model').setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('filter')
            .setDescription('Filter presets by scope')
            .setRequired(false)
            .addChoices(
              { name: 'All Presets', value: 'all' },
              { name: 'Global Only', value: 'global' },
              { name: 'My Presets', value: 'mine' },
              { name: 'Free Models', value: 'free' }
            )
        )
        .addStringOption(option =>
          option
            .setName('capability')
            .setDescription('Filter by capability (default: all)')
            .setRequired(false)
            .addChoices(
              { name: 'All Models', value: 'all' },
              { name: 'Text-only', value: 'text' },
              { name: 'Vision-capable', value: 'vision' }
            )
        )
    )
    .addSubcommand(subcommand =>
      // No slot option: a preset's vision-capability is derived from its
      // model (`supportsVision`), not chosen at creation. The vision SLOT is
      // picked later when the preset is assigned (set/set-default/global).
      subcommand.setName('create').setDescription('Create a new model preset')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit one of your model presets')
        .addStringOption(option =>
          option
            .setName('preset')
            .setDescription('Preset to edit')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('export')
        .setDescription('Export a preset as JSON file')
        .addStringOption(option =>
          option
            .setName('preset')
            .setDescription('Preset to export')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('import')
        .setDescription('Import a preset from JSON file')
        .addAttachmentOption(option =>
          option.setName('file').setDescription('JSON file to import').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('template').setDescription('Download a JSON template for preset import')
    )
    .addSubcommandGroup(group =>
      group
        .setName('global')
        .setDescription('Manage global presets (Owner only)')
        .addSubcommand(subcommand =>
          subcommand
            .setName('default')
            .setDescription('Set a global preset as the system default (Owner only)')
            .addStringOption(option =>
              option
                .setName('preset')
                .setDescription('Global preset to set as default')
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption(option =>
              option
                .setName('slot')
                .setDescription(CONFIG_SLOT_OPTION_DESCRIPTION)
                .setRequired(false)
                .addChoices({ name: 'Chat', value: 'text' }, { name: 'Vision', value: 'vision' })
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('free-default')
            .setDescription('Set a global preset as the free tier default (Owner only)')
            .addStringOption(option =>
              option
                .setName('preset')
                .setDescription('Global preset to set as free tier default')
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption(option =>
              option
                .setName('slot')
                .setDescription(CONFIG_SLOT_OPTION_DESCRIPTION)
                .setRequired(false)
                .addChoices({ name: 'Chat', value: 'text' }, { name: 'Vision', value: 'vision' })
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('override')
        .setDescription('Per-character preset overrides and your default preset')
        .addSubcommand(subcommand =>
          subcommand
            .setName('browse')
            .setDescription('Browse your preset overrides (select to clear)')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('set')
            .setDescription('Override preset for a character')
            .addStringOption(option =>
              option
                .setName('character')
                .setDescription('The character to override')
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
            .addStringOption(option =>
              option
                .setName('slot')
                .setDescription(CONFIG_SLOT_OPTION_DESCRIPTION)
                .setRequired(false)
                .addChoices({ name: 'Chat', value: 'text' }, { name: 'Vision', value: 'vision' })
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('clear')
            .setDescription('Remove preset override for a character')
            .addStringOption(option =>
              option
                .setName('character')
                .setDescription('The character to clear')
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption(option =>
              option
                .setName('slot')
                .setDescription(CONFIG_SLOT_OPTION_DESCRIPTION)
                .setRequired(false)
                .addChoices({ name: 'Chat', value: 'text' }, { name: 'Vision', value: 'vision' })
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('set-default')
            .setDescription('Set your global default preset')
            .addStringOption(option =>
              option
                .setName('preset')
                .setDescription('The preset to use as default')
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption(option =>
              option
                .setName('slot')
                .setDescription(CONFIG_SLOT_OPTION_DESCRIPTION)
                .setRequired(false)
                .addChoices({ name: 'Chat', value: 'text' }, { name: 'Vision', value: 'vision' })
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('clear-default')
            .setDescription('Clear your global default preset')
            .addStringOption(option =>
              option
                .setName('slot')
                .setDescription(CONFIG_SLOT_OPTION_DESCRIPTION)
                .setRequired(false)
                .addChoices({ name: 'Chat', value: 'text' }, { name: 'Vision', value: 'vision' })
            )
        )
    ),
  deferralMode: 'ephemeral',
  subcommandDeferralModes: {
    create: 'modal',
  },
  execute,
  autocomplete,
  handleSelectMenu: selectMenu,
  handleButton: button,
  handleModal: modal,
  // The override-browse prefix keeps its historical 'settings-preset-override'
  // string so in-flight components from pre-rename messages still route; only
  // the OWNING command changed (moved from /settings preset).
  componentPrefixes: [PRESET_OVERRIDE_PREFIX],
});
