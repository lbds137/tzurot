/**
 * Memory Command
 * Manage long-term memories (LTM)
 *
 * Commands:
 * - /memory stats <personality> - View memory statistics
 * - /memory list [personality] - Browse memories with pagination
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

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { handleStats } from './stats.js';
import { handleList, LIST_PAGINATION_CONFIG } from './list.js';
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
import {
  MEMORY_DETAIL_PREFIX,
  parseMemoryActionId,
  handleEditButton,
  handleEditTruncatedButton,
  handleCancelEditButton,
  handleEditModalSubmit,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  handleViewFullButton,
} from './detail.js';
import { hasActiveCollector } from '../../utils/activeCollectorRegistry.js';

const logger = createLogger('memory-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
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
      .setName('list')
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
  );

/**
 * Focus subcommand router
 */
const focusRouter = createSubcommandRouter(
  {
    enable: handleFocusEnable,
    disable: handleFocusDisable,
    status: handleFocusStatus,
  },
  { logger, logPrefix: '[Memory/Focus]' }
);

/**
 * Incognito subcommand router
 */
const incognitoRouter = createSubcommandRouter(
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
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'focus') {
    await focusRouter(interaction);
  } else if (subcommandGroup === 'incognito') {
    await incognitoRouter(interaction);
  } else if (subcommand === 'stats') {
    await handleStats(interaction);
  } else if (subcommand === 'list') {
    await handleList(interaction);
  } else if (subcommand === 'search') {
    await handleSearch(interaction);
  } else if (subcommand === 'delete') {
    await handleBatchDelete(interaction);
  } else if (subcommand === 'purge') {
    await handlePurge(interaction);
  } else {
    logger.warn({ subcommandGroup, subcommand }, '[Memory] Unknown subcommand');
  }
}

/**
 * Autocomplete handler for personality options
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'personality') {
    await handlePersonalityAutocomplete(interaction);
  } else {
    await interaction.respond([]);
  }
}

/**
 * Category for this command
 */
export const category = 'Memory';

/**
 * Component prefixes for button routing
 * Aggregated from subcommand pagination configs for standardization
 */
export const componentPrefixes = [
  LIST_PAGINATION_CONFIG.prefix,
  SEARCH_PAGINATION_CONFIG.prefix,
  MEMORY_DETAIL_PREFIX,
];

/**
 * Handle button interactions for memory detail actions
 * Routes edit, lock, delete, and back actions to appropriate handlers
 *
 * Uses the active collector registry to avoid race conditions:
 * - If a collector is active for this message, ignore the interaction (collector handles it)
 * - If no collector active, this is an expired interaction - show message
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const messageId = interaction.message?.id;

  // Check if an active collector is handling this message
  // If so, ignore - the collector will handle this interaction
  if (messageId !== undefined && hasActiveCollector(messageId)) {
    logger.debug(
      { customId: interaction.customId, messageId },
      '[Memory] Ignoring button - active collector will handle'
    );
    return;
  }

  // No active collector - this interaction is from an expired/orphaned message
  const parsed = parseMemoryActionId(interaction.customId);

  // Pagination button without active collector = expired
  if (parsed === null) {
    logger.debug({ customId: interaction.customId }, '[Memory] Handling expired pagination button');
    await interaction.reply({
      content: '⏰ This interaction has expired. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { action, memoryId } = parsed;

  switch (action) {
    case 'edit':
      if (memoryId !== undefined) {
        await handleEditButton(interaction, memoryId);
      }
      break;
    case 'edit-truncated':
      if (memoryId !== undefined) {
        await handleEditTruncatedButton(interaction, memoryId);
      }
      break;
    case 'cancel-edit':
      await handleCancelEditButton(interaction);
      break;
    case 'lock':
      if (memoryId !== undefined) {
        await handleLockButton(interaction, memoryId);
      }
      break;
    case 'delete':
      if (memoryId !== undefined) {
        await handleDeleteButton(interaction, memoryId);
      }
      break;
    case 'confirm-delete':
      if (memoryId !== undefined) {
        const success = await handleDeleteConfirm(interaction, memoryId);
        if (success) {
          await interaction.editReply({
            embeds: [],
            components: [],
            content: '✅ Memory deleted successfully.',
          });
        }
      }
      break;
    case 'view-full':
      if (memoryId !== undefined) {
        await handleViewFullButton(interaction, memoryId);
      }
      break;
    case 'back':
      // Back button needs to return to list/search - but without collector context,
      // we can only show an expired message
      await interaction.reply({
        content:
          '⏰ This interaction has expired. Please run the command again to return to the list.',
        flags: MessageFlags.Ephemeral,
      });
      break;
    default:
      logger.warn({ action, customId: interaction.customId }, '[Memory] Unknown detail action');
      await interaction.reply({
        content: '❌ Unknown action.',
        flags: MessageFlags.Ephemeral,
      });
  }
}

/**
 * Handle modal submit interactions for memory editing
 */
export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseMemoryActionId(interaction.customId);

  if (parsed?.action !== 'edit') {
    logger.warn({ customId: interaction.customId }, '[Memory] Unknown modal');
    return;
  }

  if (parsed.memoryId !== undefined) {
    await handleEditModalSubmit(interaction, parsed.memoryId);
  }
}

/**
 * Handle select menu interactions for memory detail
 *
 * Select menus are primarily handled by collectors in list.ts and search.ts.
 * This handler catches orphaned interactions when:
 * - The collector has timed out
 * - The original message no longer has an active collector
 *
 * In those cases, we show an "expired" message since we don't have the
 * necessary context (page, personality filter, search query) to proceed.
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const messageId = interaction.message?.id;

  // Check if an active collector is handling this message
  // If so, ignore - the collector will handle this interaction
  if (messageId !== undefined && hasActiveCollector(messageId)) {
    logger.debug(
      { customId: interaction.customId, messageId },
      '[Memory] Ignoring select menu - active collector will handle'
    );
    return;
  }

  // No active collector - this interaction is from an expired/orphaned message
  logger.debug({ customId: interaction.customId }, '[Memory] Handling expired select menu');
  await interaction.reply({
    content: '⏰ This interaction has expired. Please run the command again.',
    flags: MessageFlags.Ephemeral,
  });
}
