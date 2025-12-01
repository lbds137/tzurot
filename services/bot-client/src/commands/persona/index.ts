/**
 * Persona Command Group
 * Manages user personas for AI interactions
 *
 * Commands:
 * - /persona view - View your current persona
 * - /persona edit - Edit your persona via modal
 * - /persona settings share-ltm <enable|disable> - Toggle LTM sharing across personalities
 * - /persona override set <personality> - Override persona for specific personality
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
import { handleShareLtmSetting } from './settings.js';
import { handleOverrideSet, handleOverrideClear, handleOverrideModalSubmit } from './override.js';
import { handlePersonalityAutocomplete } from './autocomplete.js';

const logger = createLogger('persona-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('persona')
  .setDescription('Manage your persona for AI interactions')
  .addSubcommand(subcommand =>
    subcommand.setName('view').setDescription('View your current persona')
  )
  .addSubcommand(subcommand =>
    subcommand.setName('edit').setDescription('Edit your persona (name, pronouns, content)')
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
 * Subcommand routers
 */
const topLevelRouter = createSubcommandRouter(
  {
    view: handleViewPersona,
    edit: handleEditPersona,
  },
  { logger, logPrefix: '[Persona]' }
);

const settingsRouter = createSubcommandRouter(
  {
    'share-ltm': handleShareLtmSetting,
  },
  { logger, logPrefix: '[Persona/Settings]' }
);

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

    if (customId === 'persona-edit') {
      // Default persona edit modal
      await handleEditModalSubmit(interaction);
    } else if (customId.startsWith('persona-override-')) {
      // Per-personality override modal: persona-override-{personalityId}
      const personalityId = customId.replace('persona-override-', '');
      await handleOverrideModalSubmit(interaction, personalityId);
    } else {
      logger.warn({ customId }, '[Persona] Unknown modal customId');
    }
    return;
  }

  const group = interaction.options.getSubcommandGroup();

  if (group === null) {
    // Top-level subcommands: view, edit
    await topLevelRouter(interaction);
  } else if (group === 'settings') {
    await settingsRouter(interaction);
  } else if (group === 'override') {
    await overrideRouter(interaction);
  } else {
    logger.warn({ group }, '[Persona] Unknown subcommand group');
  }
}

/**
 * Autocomplete handler for personality option
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handlePersonalityAutocomplete(interaction);
}
