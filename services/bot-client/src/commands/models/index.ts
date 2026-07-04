/**
 * Models Command Group
 *
 * `/models` — browse and inspect available AI models with a user-aware card
 * (shows whether the requesting user can actually run each model, given their
 * configured API keys). Merges the OpenRouter model list with the static z.ai
 * coding-plan catalog so z.ai-only models are discoverable too.
 */

import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineCommand } from '../../utils/defineCommand.js';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';
import { createMixedModeSubcommandRouter } from '../../utils/mixedModeSubcommandRouter.js';
import { handleAutocomplete } from './autocomplete.js';
import { handleView } from './view.js';
import {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  isModelsBrowseInteraction,
  isModelsBrowseSelectInteraction,
} from './browse.js';

const logger = createLogger('models-command');

async function execute(context: SafeCommandContext): Promise<void> {
  const router = createMixedModeSubcommandRouter(
    { deferred: { browse: handleBrowse, view: handleView } },
    { logger, logPrefix: '[Models]' }
  );
  await router(context);
}

async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handleAutocomplete(interaction);
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (isModelsBrowseInteraction(interaction.customId)) {
    await handleBrowsePagination(interaction);
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (isModelsBrowseSelectInteraction(interaction.customId)) {
    await handleBrowseSelect(interaction);
  }
}

export default defineCommand({
  deferralMode: 'ephemeral',
  data: new SlashCommandBuilder()
    .setName('models')
    .setDescription('Browse and inspect available AI models')
    .addSubcommand(subcommand =>
      subcommand
        .setName('browse')
        .setDescription('Browse available models, filtered by capability or name')
        .addStringOption(option =>
          option.setName('query').setDescription('Search by model name or ID').setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('capability')
            .setDescription('Filter by capability')
            .setRequired(false)
            .addChoices(
              { name: 'Vision', value: 'vision' },
              { name: 'Image generation', value: 'image-gen' },
              { name: 'Text only', value: 'text' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View the detail card for a specific model')
        .addStringOption(option =>
          option
            .setName('model')
            .setDescription('Model name or ID')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),
  execute,
  autocomplete,
  handleButton,
  handleSelectMenu,
  componentPrefixes: ['models'],
});
