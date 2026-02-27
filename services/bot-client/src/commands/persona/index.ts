/**
 * Persona Command Group
 *
 * Manage your AI personas - customizable identities for interacting with AI.
 *
 * Commands:
 * - /persona view - View your current persona
 * - /persona edit [persona] - Edit a persona via dashboard
 * - /persona create - Create a new persona
 * - /persona browse - Browse all your personas
 * - /persona default <persona> - Set a persona as your default
 * - /persona override set <personality> <persona> - Override persona for personality
 * - /persona override clear <personality> - Clear persona override
 *
 * ARCHITECTURE NOTE:
 * Command name 'persona' matches dashboard entityType 'persona'.
 * This means customIds like 'persona::menu::...' route correctly without
 * needing componentPrefixes (unlike the old /me command which needed 'profile').
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  ModalSubmitInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger, personaEditOptions } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';
import { PersonaCustomIds } from '../../utils/customIds.js';

// Persona handlers
import { handleViewPersona, handleExpandContent } from './view.js';
import { handleCreatePersona, handleCreateModalSubmit } from './create.js';
import { handleSetDefaultPersona } from './default.js';
import { handleOverrideSet, handleOverrideCreateModalSubmit } from './override/set.js';
import { handleOverrideClear } from './override/clear.js';
import { handlePersonalityAutocomplete, handlePersonaAutocomplete } from './autocomplete.js';

// Persona-specific handlers
import { handleEditPersona } from './edit.js';
import {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  isPersonaBrowseInteraction,
  isPersonaBrowseSelectInteraction,
} from './browse.js';
import {
  handleButton as handleDashboardButton,
  handleSelectMenu as handleDashboardSelectMenu,
  handleModalSubmit as handleDashboardModalSubmit,
  isPersonaDashboardInteraction,
} from './dashboard.js';

const logger = createLogger('persona-command');

/**
 * Main subcommand router (mixed mode)
 * - create, override set show modals
 * - view, browse, share-ltm, override clear are deferred
 * Note: edit and default are handled separately due to parameter passing
 */
const mainRouter = createMixedModeSubcommandRouter(
  {
    deferred: {
      view: handleViewPersona,
      browse: handleBrowse,
    },
    modal: {
      create: handleCreatePersona,
    },
  },
  { logger, logPrefix: '[Persona]' }
);

/**
 * Override subcommand group router (mixed mode)
 */
const overrideRouter = createMixedModeSubcommandRouter(
  {
    deferred: {
      clear: handleOverrideClear,
    },
    modal: {
      set: handleOverrideSet,
    },
  },
  { logger, logPrefix: '[Persona/Override]' }
);

/**
 * Command execution router
 */
async function execute(context: SafeCommandContext): Promise<void> {
  const group = context.getSubcommandGroup();
  const subcommand = context.getSubcommand();

  if (group === 'override') {
    // Override subcommand group
    await overrideRouter(context);
  } else if (subcommand === 'edit') {
    // Edit opens the persona dashboard (deferred command)
    const personaId = personaEditOptions(context.interaction).persona();
    await handleEditPersona(context as DeferredCommandContext, personaId);
  } else if (subcommand === 'default') {
    // Default needs the persona ID (deferred command)
    await handleSetDefaultPersona(context as DeferredCommandContext);
  } else {
    // view, create, browse use main router
    await mainRouter(context);
  }
}

/**
 * Handle modal submissions for persona command
 */
async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId;

  // Check for persona dashboard modal submissions first
  if (isPersonaDashboardInteraction(customId)) {
    await handleDashboardModalSubmit(interaction);
    return;
  }

  // Parse using persona customId utilities
  const parsed = PersonaCustomIds.parse(customId);
  if (parsed === null) {
    logger.warn({ customId }, '[Persona] Unknown modal customId');
    return;
  }

  if (parsed.action === 'create') {
    // Create new persona modal
    await handleCreateModalSubmit(interaction);
  } else if (parsed.action === 'override-create' && parsed.personalityId !== undefined) {
    // Create persona for override - personalityId from customId
    await handleOverrideCreateModalSubmit(interaction, parsed.personalityId);
  } else {
    logger.warn({ customId, parsed }, '[Persona] Unknown modal action');
  }
}

/**
 * Autocomplete handler for personality and persona options
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (focusedOption.name === 'personality') {
    // Personality autocomplete (for override commands)
    await handlePersonalityAutocomplete(interaction);
  } else if (focusedOption.name === 'persona') {
    // Persona autocomplete
    // Include "Create new" option only for override set (not for other persona commands)
    const includeCreateNew = subcommandGroup === 'override' && subcommand === 'set';
    await handlePersonaAutocomplete(interaction, includeCreateNew);
  } else {
    await interaction.respond([]);
  }
}

/**
 * Handle button interactions for the persona command
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  // Check for browse pagination buttons
  if (isPersonaBrowseInteraction(customId)) {
    await handleBrowsePagination(interaction);
    return;
  }

  // Check for persona dashboard button interactions
  if (isPersonaDashboardInteraction(customId)) {
    await handleDashboardButton(interaction);
    return;
  }

  const parsed = PersonaCustomIds.parse(customId);
  if (parsed === null) {
    logger.warn({ customId }, '[Persona] Unknown button customId');
    return;
  }

  if (parsed.action === 'expand') {
    if (parsed.personaId !== undefined && parsed.field !== undefined) {
      await handleExpandContent(interaction, parsed.personaId, parsed.field);
    } else {
      logger.warn({ customId, parsed }, '[Persona] Missing personaId or field for expand action');
    }
  } else {
    logger.warn({ customId, parsed }, '[Persona] Unknown button action');
  }
}

/**
 * Handle select menu interactions for the persona command
 */
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const customId = interaction.customId;

  // Check for browse select menu
  if (isPersonaBrowseSelectInteraction(customId)) {
    await handleBrowseSelect(interaction);
    return;
  }

  // Check for persona dashboard select menu interactions
  if (isPersonaDashboardInteraction(customId)) {
    await handleDashboardSelectMenu(interaction);
    return;
  }

  logger.warn({ customId }, '[Persona] Unknown select menu customId');
}

/**
 * Export command definition using defineCommand for type safety
 *
 * IMPORTANT: No componentPrefixes needed because command name 'persona'
 * matches dashboard entityType 'persona'. CustomIds like 'persona::menu::...'
 * route correctly via the command name prefix.
 */
export default defineCommand({
  deferralMode: 'ephemeral', // Default for most subcommands
  subcommandDeferralModes: {
    create: 'modal',
    'override set': 'modal',
  },
  // NO componentPrefixes needed - command name = entityType = 'persona'
  data: new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Manage your AI personas')
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
    .addSubcommand(subcommand =>
      subcommand.setName('create').setDescription('Create a new persona')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('browse').setDescription('Browse all your personas')
    )
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
        .setName('override')
        .setDescription('Set different personas for specific personalities')
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
    ),
  execute,
  autocomplete,
  handleModal,
  handleButton,
  handleSelectMenu,
});
