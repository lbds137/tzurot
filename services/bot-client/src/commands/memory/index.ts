/**
 * Memory Command
 * Manage long-term memories (LTM)
 *
 * Commands:
 * - /memory stats <personality> - View memory statistics
 * - /memory browse [personality] - Browse memories with pagination
 * - /memory search <query> [personality] [limit] - Semantic search of memories
 * - /memory delete <personality> [timeframe] - Batch delete memories (skips locked)
 * - /memory purge <personality> - Delete ALL memories for personality (typed confirmation)
 * - /memory focus enable <personality> - Disable LTM retrieval
 * - /memory focus disable <personality> - Re-enable LTM retrieval
 * - /memory focus status <personality> - Check focus mode status
 * - /memory incognito enable <personality> <duration> - Disable LTM writing (memories not saved)
 * - /memory incognito disable <personality> - Re-enable LTM writing
 * - /memory incognito status - Check incognito mode status
 * - /memory incognito forget <personality> <timeframe> - Retroactively delete recent memories
 */

import { SlashCommandBuilder } from 'discord.js';
import type { AutocompleteInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import type {
  DeferredCommandContext,
  SafeCommandContext,
} from '../../utils/commandContext/types.js';
import { createTypedSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleStats } from './stats.js';
import { handleBrowse, BROWSE_PAGINATION_CONFIG } from './browse.js';
import { handleSearch, SEARCH_PAGINATION_CONFIG } from './search.js';
import { handleFocusEnable, handleFocusDisable, handleFocusStatus } from './focus.js';
import {
  handleIncognitoEnable,
  handleIncognitoDisable,
  handleIncognitoStatus,
  handleIncognitoForget,
} from './incognito.js';
import { handleBatchDelete } from './batchDelete.js';
import { handlePurge } from './purge.js';
import { handlePersonalityAutocomplete } from './autocomplete.js';
import { MEMORY_DETAIL_PREFIX } from './detail.js';
import { handleButton, handleModal, handleSelectMenu } from './interactionHandlers.js';

const logger = createLogger('memory-command');

/**
 * Focus subcommand router (typed for DeferredCommandContext)
 */
const focusRouter = createTypedSubcommandRouter(
  {
    enable: handleFocusEnable,
    disable: handleFocusDisable,
    status: handleFocusStatus,
  },
  { logger, logPrefix: '[Memory/Focus]' }
);

/**
 * Incognito subcommand router (typed for DeferredCommandContext)
 */
const incognitoRouter = createTypedSubcommandRouter(
  {
    enable: handleIncognitoEnable,
    disable: handleIncognitoDisable,
    status: handleIncognitoStatus,
    forget: handleIncognitoForget,
  },
  { logger, logPrefix: '[Memory/Incognito]' }
);

/**
 * Command execution router
 *
 * Note: The function signature uses SafeCommandContext for TypeScript compatibility,
 * but the runtime value is always DeferredCommandContext when deferralMode is 'ephemeral'.
 */
async function execute(ctx: SafeCommandContext): Promise<void> {
  // Cast to the specific context type we expect for this deferralMode
  const context = ctx as DeferredCommandContext;
  const subcommandGroup = context.getSubcommandGroup();
  const subcommand = context.getSubcommand();

  if (subcommandGroup === 'focus') {
    await focusRouter(context);
  } else if (subcommandGroup === 'incognito') {
    await incognitoRouter(context);
  } else if (subcommand === 'stats') {
    await handleStats(context);
  } else if (subcommand === 'browse') {
    await handleBrowse(context);
  } else if (subcommand === 'search') {
    await handleSearch(context);
  } else if (subcommand === 'delete') {
    await handleBatchDelete(context);
  } else if (subcommand === 'purge') {
    await handlePurge(context);
  } else {
    logger.warn({ subcommandGroup, subcommand }, '[Memory] Unknown subcommand');
  }
}

/**
 * Autocomplete handler for personality options
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'personality') {
    await handlePersonalityAutocomplete(interaction);
  } else {
    await interaction.respond([]);
  }
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 *
 * deferralMode: 'ephemeral' means all subcommands receive DeferredCommandContext.
 */
export default defineCommand({
  deferralMode: 'ephemeral',
  data: new SlashCommandBuilder()
    .setName('memory')
    .setDescription('Manage your long-term memories')
    .addSubcommand(subcommand =>
      subcommand
        .setName('stats')
        .setDescription('View memory statistics')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to view stats for')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('browse')
        .setDescription('Browse your memories with pagination')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('Filter by personality (optional)')
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('search')
        .setDescription('Search your memories semantically')
        .addStringOption(option =>
          option
            .setName('query')
            .setDescription('What to search for (natural language)')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('Filter by personality (optional)')
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('Number of results (1-10, default 5)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Batch delete memories with filters (skips locked)')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to delete memories for')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('timeframe')
            .setDescription('Only delete memories from this time period (e.g., 7d, 30d, 1y)')
            .setRequired(false)
            .addChoices(
              { name: 'Last 24 hours', value: '24h' },
              { name: 'Last 7 days', value: '7d' },
              { name: 'Last 30 days', value: '30d' },
              { name: 'Last year', value: '1y' },
              { name: 'All time', value: 'all' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('purge')
        .setDescription('Delete ALL memories for a personality (requires typed confirmation)')
        .addStringOption(option =>
          option
            .setName('personality')
            .setDescription('The personality to purge all memories for')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('focus')
        .setDescription('Manage focus mode (disable LTM retrieval)')
        .addSubcommand(subcommand =>
          subcommand
            .setName('enable')
            .setDescription('Enable focus mode - stop retrieving long-term memories')
            .addStringOption(option =>
              option
                .setName('personality')
                .setDescription('The personality to enable focus mode for')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('disable')
            .setDescription('Disable focus mode - resume retrieving long-term memories')
            .addStringOption(option =>
              option
                .setName('personality')
                .setDescription('The personality to disable focus mode for')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('status')
            .setDescription('Check current focus mode status')
            .addStringOption(option =>
              option
                .setName('personality')
                .setDescription('The personality to check status for')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('incognito')
        .setDescription('Manage incognito mode (disable memory saving)')
        .addSubcommand(subcommand =>
          subcommand
            .setName('enable')
            .setDescription('Enable incognito mode - new memories will NOT be saved')
            .addStringOption(option =>
              option
                .setName('personality')
                .setDescription('Personality or "all" for global incognito')
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption(option =>
              option
                .setName('duration')
                .setDescription('How long to stay in incognito mode')
                .setRequired(true)
                .addChoices(
                  { name: '30 minutes', value: '30m' },
                  { name: '1 hour', value: '1h' },
                  { name: '4 hours', value: '4h' },
                  { name: 'Until manually disabled', value: 'forever' }
                )
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('disable')
            .setDescription('Disable incognito mode - resume saving memories')
            .addStringOption(option =>
              option
                .setName('personality')
                .setDescription('Personality or "all" to disable global incognito')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand.setName('status').setDescription('Check current incognito mode status')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('forget')
            .setDescription('Retroactively delete recent memories')
            .addStringOption(option =>
              option
                .setName('personality')
                .setDescription('Personality or "all" for all personalities')
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption(option =>
              option
                .setName('timeframe')
                .setDescription('How far back to delete memories')
                .setRequired(true)
                .addChoices(
                  { name: 'Last 5 minutes', value: '5m' },
                  { name: 'Last 15 minutes', value: '15m' },
                  { name: 'Last hour', value: '1h' }
                )
            )
        )
    ),
  execute,
  autocomplete,
  handleButton,
  handleModal,
  handleSelectMenu,
  componentPrefixes: [
    BROWSE_PAGINATION_CONFIG.prefix,
    SEARCH_PAGINATION_CONFIG.prefix,
    MEMORY_DETAIL_PREFIX,
  ],
});
