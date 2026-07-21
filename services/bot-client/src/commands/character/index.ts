/**
 * Character Command Group
 * Commands for managing AI characters (personalities)
 *
 * Uses the Dashboard pattern:
 * 1. /character create → Seed modal for minimal creation
 * 2. Dashboard embed shows character with edit menu
 * 3. Select menu → Section-specific modals with pre-filled values
 * 4. On submit → Dashboard refreshes with updated data
 */

import { SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import { SELECTOR_DESCRIPTION } from '@tzurot/common-types/constants/uxVocabulary';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineCommand } from '../../utils/defineCommand.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';

// Import handlers from split modules
import { handleAutocomplete } from './autocomplete.js';
import { handleImport } from './import.js';
import { handleExport } from './export.js';
import { handleTemplate } from './template.js';
import { handleView } from './view.js';
import { handleAliasAdd, handleAliasBrowse } from './alias.js';
import { handleCreate } from './create.js';
import { handleEdit } from './edit.js';
import { handleAvatar } from './avatar.js';
import { handleVoice } from './voice.js';
import { handleBrowse } from './browse.js';
import { handleChimeIn } from '../../services/character/characterTurn.js';
import { handleSettings } from './settings.js';
import { handleOverrides } from './overrides.js';
import {
  handleSelectMenu,
  handleButton,
  handleCharacterModal as handleModal,
} from './interactionRouting.js';

const logger = createLogger('character-command');

/** Shared description for subcommands that modify a character */

/**
 * Create character router with mixed deferral modes
 *
 * - 'create' shows a modal (receives ModalCommandContext)
 * - All other subcommands are deferred (receive DeferredCommandContext)
 *
 * Handlers that need config get it via getConfig() internally or via wrapper.
 */
function createCharacterRouter(): (context: SafeCommandContext) => Promise<void> {
  const config = getConfig();

  return createMixedModeSubcommandRouter(
    {
      modal: {
        create: handleCreate,
      },
      deferred: {
        edit: (ctx: DeferredCommandContext) => handleEdit(ctx, config),
        view: (ctx: DeferredCommandContext) => handleView(ctx, config),
        browse: (ctx: DeferredCommandContext) => handleBrowse(ctx, config),
        import: (ctx: DeferredCommandContext) => handleImport(ctx, config),
        export: (ctx: DeferredCommandContext) => handleExport(ctx, config),
        template: (ctx: DeferredCommandContext) => handleTemplate(ctx, config),
        'chime-in': (ctx: DeferredCommandContext) => handleChimeIn(ctx),
        settings: (ctx: DeferredCommandContext) => handleSettings(ctx, config),
        overrides: (ctx: DeferredCommandContext) => handleOverrides(ctx, config),
      },
    },
    { logger, logPrefix: '[Character]' }
  );
}

/**
 * Command execution router
 */
async function execute(context: SafeCommandContext): Promise<void> {
  // GROUPS dispatch before the flat router: their subcommand names collide
  // across groups and with flat siblings under getSubcommand(), which is all
  // the mixed router keys on ('alias browse' vs flat 'browse'; 'avatar set'
  // vs 'voice set').
  const group = context.getSubcommandGroup();
  if (group === 'alias') {
    const ctx = context as DeferredCommandContext;
    if (ctx.getSubcommand() === 'add') {
      await handleAliasAdd(ctx);
    } else {
      await handleAliasBrowse(ctx);
    }
    return;
  }
  if (group === 'avatar' || group === 'voice') {
    const ctx = context as DeferredCommandContext;
    const config = getConfig();
    await (group === 'avatar' ? handleAvatar(ctx, config) : handleVoice(ctx, config));
    return;
  }
  const router = createCharacterRouter();
  await router(context);
}

/**
 * Autocomplete handler
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handleAutocomplete(interaction);
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 *
 * Uses mixed deferral modes:
 * - Most subcommands use ephemeral deferral
 * - 'create' shows a modal (no deferral)
 */
export default defineCommand({
  deferralMode: 'ephemeral', // Default for most subcommands
  subcommandDeferralModes: {
    create: 'modal', // /character create shows a modal
    // chime-in defers ephemerally so error responses (editReply) land as
    // invoker-only messages. The character's webhook reply is independent of
    // the defer mode and remains public. (The sibling turn commands /chat and
    // /random carry the same rationale on their own definitions.)
    'chime-in': 'ephemeral',
  },
  data: new SlashCommandBuilder()
    .setName('character')
    .setDescription('Manage AI characters')
    .addSubcommand(subcommand =>
      subcommand.setName('create').setDescription('Create a new AI character')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit an existing AI character')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View character details')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('alias')
        .setDescription('Manage @mention aliases (personal for you, global for everyone)')
        .addSubcommand(subcommand =>
          subcommand
            .setName('browse')
            .setDescription('Browse aliases — yours everywhere, or one character')
            .addStringOption(option =>
              option
                .setName('character')
                .setDescription(`${SELECTOR_DESCRIPTION.character} (omit to see all your aliases)`)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('add')
            .setDescription('Add an alias to a character you can see')
            .addStringOption(option =>
              option
                .setName('character')
                .setDescription(`${SELECTOR_DESCRIPTION.character} the alias points to`)
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption(option =>
              option
                .setName('alias')
                .setDescription('The alias text (resolves @mentions like the name)')
                .setRequired(true)
                .setMaxLength(100)
            )
            .addStringOption(option =>
              option
                .setName('scope')
                .setDescription('Who the alias resolves for (Global is bot-owner only)')
                .addChoices(
                  { name: 'Personal (just you)', value: 'user' },
                  { name: 'Global (everyone)', value: 'global' }
                )
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('browse')
        .setDescription('Browse and search characters')
        .addStringOption(option =>
          option.setName('query').setDescription('Search by name or description').setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('filter')
            .setDescription('Filter characters by type')
            .setRequired(false)
            .addChoices(
              { name: 'All Characters', value: 'all' },
              { name: 'My Characters', value: 'mine' },
              { name: 'Public Only', value: 'public' }
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('avatar')
        .setDescription("Manage a character's avatar image")
        .addSubcommand(subcommand =>
          subcommand
            .setName('set')
            .setDescription("Set a character's avatar image")
            .addStringOption(option =>
              option
                .setName('character')
                .setDescription(SELECTOR_DESCRIPTION.character)
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addAttachmentOption(option =>
              option
                .setName('image')
                .setDescription('Avatar image (PNG, JPG, GIF, WebP)')
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('clear')
            .setDescription("Clear a character's avatar image")
            .addStringOption(option =>
              option
                .setName('character')
                .setDescription(SELECTOR_DESCRIPTION.character)
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('voice')
        .setDescription("Manage a character's voice reference for TTS cloning")
        .addSubcommand(subcommand =>
          subcommand
            .setName('set')
            .setDescription("Set a character's voice reference for TTS cloning")
            .addStringOption(option =>
              option
                .setName('character')
                .setDescription(SELECTOR_DESCRIPTION.character)
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addAttachmentOption(option =>
              option
                .setName('audio')
                .setDescription('Voice reference audio (WAV, MP3, OGG, FLAC)')
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('clear')
            .setDescription("Clear a character's voice reference and disable TTS")
            .addStringOption(option =>
              option
                .setName('character')
                .setDescription(SELECTOR_DESCRIPTION.character)
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('import')
        .setDescription('Import a character from JSON file')
        .addAttachmentOption(option =>
          option
            .setName('file')
            .setDescription('JSON file containing character data')
            .setRequired(true)
        )
        .addAttachmentOption(option =>
          option
            .setName('image')
            .setDescription('Avatar image (PNG, JPG, GIF, WebP)')
            .setRequired(false)
        )
        .addAttachmentOption(option =>
          option
            .setName('audio')
            .setDescription('Voice reference audio (WAV, MP3, OGG, FLAC)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('export')
        .setDescription('Export a character as JSON file')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('template').setDescription('Show the JSON template for character import')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('chime-in')
        .setDescription(
          'Have a character chime in on the recent conversation (no message from you)'
        )
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addBooleanOption(option =>
          option
            .setName('incognito')
            .setDescription(
              'Anonymous by default (no persona/memories). Set False to use your persona + memories.'
            )
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('settings')
        .setDescription('Open character settings dashboard (owner only)')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('overrides')
        .setDescription('Manage your personal overrides for a character')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription(SELECTOR_DESCRIPTION.character)
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),
  execute,
  autocomplete,
  handleSelectMenu,
  handleButton,
  handleModal,
  componentPrefixes: ['character-settings', 'character-overrides', 'character-alias'],
});
